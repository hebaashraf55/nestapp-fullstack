import {
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { ENV, Env } from '../config/env';
import { MailSender } from '../mail/mail-sender';
import { Role } from '../users/role';
import {
  DuplicateEmailError,
  DuplicateGoogleAccountError,
  UserRecord,
} from '../users/users.repository';
import { PublicUser, toPublicUser, UsersService } from '../users/users.service';
import type { GoogleSignInDto, LoginDto, ResetPasswordDto, SignupDto, VerifyEmailDto } from './dto';
import { GoogleIdTokenVerifier } from './google-id-token.verifier';
import { GoogleNonceService } from './google-nonce.service';
import { OtpPurpose, OtpRepository } from './otp.repository';
import { hashPassword, verifyPassword } from './password';
import { RateLimiter } from './rate-limiter';
import { RefreshTokenRepository } from './refresh-token.repository';
import { TokenService } from './token.service';
import { TooManyAttemptsException } from './too-many-attempts.exception';

export const OTP_TTL_MS = 10 * 60_000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_MS = 60_000;

const WINDOW_15_MIN = 15 * 60_000;
const WINDOW_1_HOUR = 60 * 60_000;
export const LIMITS = {
  loginPerAccount: 5,
  loginPerIp: 30,
  mailRequestsPerIp: 10,
  codeAttemptsPerIp: 20,
  refreshPerIp: 60,
  googlePerIp: 30,
} as const;

export const GENERIC_ACCEPTED = {
  message: 'If this request can be completed, an email with next steps has been sent.',
};

export interface Credentials {
  accessToken: string;
  refreshToken: string;
}

export interface LoginResult {
  /** Capitalised to match the original API's response shape. */
  Credentials: Credentials;
  user: PublicUser;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly secret: string;
  private readonly refreshTtlMs: number;
  private dummyHash: Promise<string> | undefined;

  constructor(
    @Inject(ENV) env: Env,
    private readonly users: UsersService,
    private readonly otps: OtpRepository,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly tokens: TokenService,
    private readonly mail: MailSender,
    private readonly limiter: RateLimiter,
    private readonly google: GoogleIdTokenVerifier,
    private readonly nonces: GoogleNonceService,
  ) {
    this.secret = env.JWT_SECRET ?? '';
    this.refreshTtlMs = env.REFRESH_TOKEN_TTL_DAYS * 86_400_000;
  }

  // ---------------------------------------------------------------- signup and email verification

  /**
   * Always answers the same way, so the response cannot be used to learn which emails are registered.
   * An existing account is never modified: otherwise someone could sign up with a victim's email,
   * choose the password, and wait for the victim to verify it ("pre-hijacking").
   */
  async signup(dto: SignupDto, ip: string): Promise<typeof GENERIC_ACCEPTED> {
    this.throttle(`mail:ip:${ip}`, LIMITS.mailRequestsPerIp, WINDOW_1_HOUR, true);
    // Hash even when the account exists, so response time does not reveal it.
    const passwordHash = await hashPassword(dto.password);
    let user = await this.users.findByEmail(dto.email);
    if (!user) {
      try {
        // Role and demo flag are fixed here and can never come from the request.
        user = await this.users.create({
          email: dto.email,
          name: dto.name,
          passwordHash,
          role: Role.CUSTOMER,
          isDemo: false,
          emailVerified: false,
        });
      } catch (error) {
        if (!(error instanceof DuplicateEmailError)) throw error;
        user = await this.users.findByEmail(dto.email);
      }
    }
    if (user && !user.emailVerified && !user.isDemo) await this.issueCode(user, 'verify-email');
    return GENERIC_ACCEPTED;
  }

  async resendCode(email: string, ip: string): Promise<typeof GENERIC_ACCEPTED> {
    this.throttle(`mail:ip:${ip}`, LIMITS.mailRequestsPerIp, WINDOW_1_HOUR, true);
    const user = await this.users.findByEmail(email);
    if (user && !user.emailVerified && !user.isDemo) await this.issueCode(user, 'verify-email');
    return GENERIC_ACCEPTED;
  }

  async verifyEmail(dto: VerifyEmailDto, ip: string): Promise<{ verified: true }> {
    this.throttle(`code:ip:${ip}`, LIMITS.codeAttemptsPerIp, WINDOW_15_MIN, false);
    const user = await this.users.findByEmail(dto.email);
    if (!user || user.isDemo || !(await this.checkCode(user, 'verify-email', dto.code))) {
      this.limiter.record(`code:ip:${ip}`, WINDOW_15_MIN);
      throw new BadRequestException('Invalid or expired code');
    }
    await this.users.markEmailVerified(user.id);
    return { verified: true };
  }

  // ---------------------------------------------------------------------------------------- login

  async login(dto: LoginDto, ip: string): Promise<LoginResult> {
    const ipKey = `login:ip:${ip}`;
    const accountKey = `login:account:${dto.email}`;
    this.throttle(ipKey, LIMITS.loginPerIp, WINDOW_15_MIN, false);
    this.throttle(accountKey, LIMITS.loginPerAccount, WINDOW_15_MIN, false);

    const user = await this.users.findByEmail(dto.email);
    // Unknown email: verify against a dummy hash so timing does not reveal whether the account exists.
    const valid = await verifyPassword(
      dto.password,
      user?.passwordHash ?? (await this.getDummyHash()),
    );
    if (!user || !valid) {
      this.limiter.record(ipKey, WINDOW_15_MIN);
      this.limiter.record(accountKey, WINDOW_15_MIN);
      throw new UnauthorizedException('Invalid email or password');
    }
    this.limiter.reset(accountKey);
    if (!user.emailVerified) throw new ForbiddenException('Email not verified');
    return { Credentials: await this.openSession(user), user: toPublicUser(user) };
  }

  /** Rotating refresh tokens: each use revokes the old token and issues a new one in the same family. */
  async refresh(refreshToken: string, ip: string): Promise<{ Credentials: Credentials }> {
    this.throttle(`refresh:ip:${ip}`, LIMITS.refreshPerIp, WINDOW_15_MIN, true);
    const record = await this.refreshTokens.findByHash(sha256(refreshToken));
    if (!record) throw new UnauthorizedException('Invalid refresh token');
    if (record.revokedAt) {
      // A used token came back: assume it was stolen and end the whole session family.
      await this.refreshTokens.revokeFamily(record.familyId);
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (record.expiresAt.getTime() <= Date.now())
      throw new UnauthorizedException('Invalid refresh token');
    const user = await this.users.findById(record.userId);
    if (!user || !user.emailVerified) throw new UnauthorizedException('Invalid refresh token');
    // Atomic: only one of several concurrent refreshes can win; the loser is treated as a replay.
    if (!(await this.refreshTokens.revoke(record.id))) {
      await this.refreshTokens.revokeFamily(record.familyId);
      throw new UnauthorizedException('Invalid refresh token');
    }
    return { Credentials: await this.issueTokens(user, record.familyId) };
  }

  /**
   * Ends one session. Needs only the refresh token, so it also works for demo viewers and for users
   * whose access token has expired. It can only revoke the family of the token presented.
   */
  async logout(refreshToken: string, ip: string): Promise<{ loggedOut: true }> {
    this.throttle(`refresh:ip:${ip}`, LIMITS.refreshPerIp, WINDOW_15_MIN, true);
    const record = await this.refreshTokens.findByHash(sha256(refreshToken));
    if (record) await this.refreshTokens.revokeFamily(record.familyId);
    return { loggedOut: true };
  }

  /** Ends every session of the user and invalidates all access tokens already issued. */
  async logoutAll(userId: string): Promise<{ loggedOut: true }> {
    await this.refreshTokens.revokeAllForUser(userId);
    await this.users.bumpTokenVersion(userId);
    return { loggedOut: true };
  }

  async profile(userId: string): Promise<PublicUser> {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException();
    return toPublicUser(user);
  }

  // ---------------------------------------------------------------------------- password recovery

  async forgotPassword(email: string, ip: string): Promise<typeof GENERIC_ACCEPTED> {
    this.throttle(`mail:ip:${ip}`, LIMITS.mailRequestsPerIp, WINDOW_1_HOUR, true);
    const user = await this.users.findByEmail(email);
    // Demo accounts have shared public credentials; their password can never be reset.
    if (user && !user.isDemo) await this.issueCode(user, 'reset-password');
    return GENERIC_ACCEPTED;
  }

  async resetPassword(dto: ResetPasswordDto, ip: string): Promise<{ passwordReset: true }> {
    this.throttle(`code:ip:${ip}`, LIMITS.codeAttemptsPerIp, WINDOW_15_MIN, false);
    const user = await this.users.findByEmail(dto.email);
    if (!user || user.isDemo || !(await this.checkCode(user, 'reset-password', dto.code))) {
      this.limiter.record(`code:ip:${ip}`, WINDOW_15_MIN);
      throw new BadRequestException('Invalid or expired code');
    }
    const passwordHash = await hashPassword(dto.newPassword);
    await this.users.resetPassword(user.id, passwordHash);
    await this.refreshTokens.revokeAllForUser(user.id);
    await this.otps.deleteForUser(user.id);
    return { passwordReset: true };
  }

  // --------------------------------------------------------------------------- Google sign-in

  /** A fresh nonce for the browser to pass to Google, and the signed ticket that proves we issued it. */
  googleNonce(): { nonce: string; nonceToken: string } {
    if (!this.google.configured)
      throw new ServiceUnavailableException('Google sign-in is not configured');
    return this.nonces.issue();
  }

  /**
   * Signs in (or up) with a Google ID token. Only verified claims are used; nothing about the user is
   * taken from the browser. Google can only ever reach CUSTOMER accounts: it never creates staff or
   * demo accounts and never signs in to one. Linking rules for an existing email:
   *  - verified customer: link (Google has proven control of the same mailbox);
   *  - unverified customer: link AND replace the password, revoking sessions, so whoever registered
   *    the address without proving it (a "pre-hijacking" attempt) loses access;
   *  - already linked to a different Google account: 409, never a second account for one email.
   */
  async googleSignIn(dto: GoogleSignInDto, ip: string): Promise<LoginResult> {
    this.throttle(`google:ip:${ip}`, LIMITS.googlePerIp, WINDOW_15_MIN, true);
    if (!this.google.configured)
      throw new ServiceUnavailableException('Google sign-in is not configured');
    const identity = await this.google.verify(dto.credential);
    if (!identity || !this.nonces.consume(dto.nonceToken, identity.nonce)) {
      throw new UnauthorizedException('Google sign-in could not be verified. Please try again.');
    }
    if (!identity.emailVerified) {
      throw new ForbiddenException('Your Google email address is not verified.');
    }
    const email = identity.email.trim().toLowerCase();
    let user = await this.users.findByGoogleSub(identity.sub);
    if (!user) user = await this.linkOrCreateGoogleUser(identity.sub, email, identity.name);
    if (user.role !== Role.CUSTOMER || user.isDemo) {
      throw new ForbiddenException('This account signs in with its email and password.');
    }
    return { Credentials: await this.openSession(user), user: toPublicUser(user) };
  }

  private async linkOrCreateGoogleUser(
    sub: string,
    email: string,
    name: string | undefined,
  ): Promise<UserRecord> {
    const existing = await this.users.findByEmail(email);
    if (existing) {
      if (existing.role !== Role.CUSTOMER || existing.isDemo) {
        throw new ForbiddenException('This account signs in with its email and password.');
      }
      if (existing.googleSub) {
        throw new ConflictException('This email is already linked to a different Google account.');
      }
      const replace = existing.emailVerified
        ? undefined
        : await hashPassword(randomBytes(32).toString('hex'));
      let linked: boolean;
      try {
        linked = await this.users.linkGoogle(existing.id, sub, replace);
      } catch (error) {
        if (error instanceof DuplicateGoogleAccountError) return this.userByGoogleSub(sub);
        throw error;
      }
      if (!linked)
        throw new ConflictException('This email is already linked to a different Google account.');
      if (replace) await this.refreshTokens.revokeAllForUser(existing.id);
      return (await this.users.findById(existing.id)) as UserRecord;
    }
    try {
      return await this.users.create({
        email,
        name: (name?.trim() || email.split('@')[0] || 'Customer').slice(0, 100),
        // Unusable random password: the account signs in with Google, or sets one via "Forgot password".
        passwordHash: await hashPassword(randomBytes(32).toString('hex')),
        role: Role.CUSTOMER,
        isDemo: false,
        emailVerified: true,
        googleSub: sub,
      });
    } catch (error) {
      // A concurrent first sign-in with the same Google account won the race: use that account.
      if (error instanceof DuplicateGoogleAccountError) return this.userByGoogleSub(sub);
      if (error instanceof DuplicateEmailError) {
        throw new ConflictException(
          'An account for this email was just created. Please try again.',
        );
      }
      throw error;
    }
  }

  private async userByGoogleSub(sub: string): Promise<UserRecord> {
    const user = await this.users.findByGoogleSub(sub);
    if (!user) throw new ConflictException('Please try again.');
    return user;
  }

  // ---------------------------------------------------------------------------------- internals

  private throttle(key: string, max: number, windowMs: number, countEveryCall: boolean): void {
    const status = this.limiter.status(key, max);
    if (status.blocked) throw new TooManyAttemptsException(status.retryAfterSeconds);
    if (countEveryCall) this.limiter.record(key, windowMs);
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
    return this.dummyHash;
  }

  private codeHash(userId: string, purpose: OtpPurpose, code: string): string {
    return createHmac('sha256', this.secret)
      .update(`otp:${userId}:${purpose}:${code}`)
      .digest('hex');
  }

  /** Creates and emails a code unless one was sent in the last minute. Mail failures are logged, not shown. */
  private async issueCode(user: UserRecord, purpose: OtpPurpose): Promise<void> {
    const existing = await this.otps.find(user.id, purpose);
    const now = Date.now();
    if (existing && now - existing.sentAt.getTime() < OTP_RESEND_COOLDOWN_MS) return;
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.otps.replace({
      userId: user.id,
      purpose,
      codeHash: this.codeHash(user.id, purpose, code),
      expiresAt: new Date(now + OTP_TTL_MS),
      sentAt: new Date(now),
    });
    const subject =
      purpose === 'verify-email' ? 'Your NOMA verification code' : 'Your NOMA password reset code';
    try {
      await this.mail.send({
        to: user.email,
        subject,
        text: `Your code is ${code}. It expires in ${OTP_TTL_MS / 60_000} minutes. If you did not ask for it, ignore this email.`,
      });
    } catch (error) {
      this.logger.error(
        `Could not send ${purpose} email: ${error instanceof Error ? error.name : 'unknown error'}`,
      );
    }
  }

  /** Expiry, attempt limit, constant-time compare and single use. Every failure looks identical. */
  private async checkCode(user: UserRecord, purpose: OtpPurpose, code: string): Promise<boolean> {
    const otp = await this.otps.find(user.id, purpose);
    if (!otp) return false;
    if (otp.expiresAt.getTime() <= Date.now() || otp.attempts >= OTP_MAX_ATTEMPTS) {
      await this.otps.consume(otp.id);
      return false;
    }
    const expected = Buffer.from(otp.codeHash, 'hex');
    const actual = Buffer.from(this.codeHash(user.id, purpose, code), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      if ((await this.otps.addAttempt(otp.id)) >= OTP_MAX_ATTEMPTS) await this.otps.consume(otp.id);
      return false;
    }
    return this.otps.consume(otp.id);
  }

  private async openSession(user: UserRecord): Promise<Credentials> {
    return this.issueTokens(user, randomBytes(16).toString('hex'));
  }

  private async issueTokens(user: UserRecord, familyId: string): Promise<Credentials> {
    const refreshToken = randomBytes(32).toString('base64url');
    await this.refreshTokens.create({
      userId: user.id,
      familyId,
      tokenHash: sha256(refreshToken),
      expiresAt: new Date(Date.now() + this.refreshTtlMs),
    });
    return { accessToken: this.tokens.sign(user.id, user.tokenVersion), refreshToken };
  }
}
