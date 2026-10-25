import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthenticatedUser } from './auth.types';
import { AuthService } from './auth.service';
import { CurrentUser, Public } from './decorators';
import {
  EmailOnlyDto,
  emailOnlySchema,
  LoginDto,
  loginSchema,
  RefreshDto,
  refreshSchema,
  ResetPasswordDto,
  resetPasswordSchema,
  SignupDto,
  signupSchema,
  VerifyEmailDto,
  verifyEmailSchema,
  ZodBodyPipe,
} from './dto';

const ipOf = (req: Request): string => req.ip ?? 'unknown';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('signup')
  @HttpCode(202)
  signup(@Body(new ZodBodyPipe(signupSchema)) dto: SignupDto, @Req() req: Request) {
    return this.auth.signup(dto, ipOf(req));
  }

  @Public()
  @Post('verify-email')
  @HttpCode(200)
  verifyEmail(@Body(new ZodBodyPipe(verifyEmailSchema)) dto: VerifyEmailDto, @Req() req: Request) {
    return this.auth.verifyEmail(dto, ipOf(req));
  }

  @Public()
  @Post('resend-otp')
  @HttpCode(202)
  resendOtp(@Body(new ZodBodyPipe(emailOnlySchema)) dto: EmailOnlyDto, @Req() req: Request) {
    return this.auth.resendCode(dto.email, ipOf(req));
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body(new ZodBodyPipe(loginSchema)) dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto, ipOf(req));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body(new ZodBodyPipe(refreshSchema)) dto: RefreshDto, @Req() req: Request) {
    return this.auth.refresh(dto.refreshToken, ipOf(req));
  }

  /**
   * Public on purpose: it acts only on the refresh token presented, so a demo viewer (blocked from
   * every other write) can still end their own session, and it grants nothing else.
   */
  @Public()
  @Post('logout')
  @HttpCode(200)
  logout(@Body(new ZodBodyPipe(refreshSchema)) dto: RefreshDto, @Req() req: Request) {
    return this.auth.logout(dto.refreshToken, ipOf(req));
  }

  /** A normal authenticated write: the DemoReadOnlyGuard blocks it for demo viewers. */
  @Post('logout-all')
  @HttpCode(200)
  logoutAll(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.logoutAll(user.id);
  }

  @Get('profile')
  profile(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.profile(user.id);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(202)
  forgotPassword(@Body(new ZodBodyPipe(emailOnlySchema)) dto: EmailOnlyDto, @Req() req: Request) {
    return this.auth.forgotPassword(dto.email, ipOf(req));
  }

  @Public()
  @Post('reset-password')
  @HttpCode(200)
  resetPassword(
    @Body(new ZodBodyPipe(resetPasswordSchema)) dto: ResetPasswordDto,
    @Req() req: Request,
  ) {
    return this.auth.resetPassword(dto, ipOf(req));
  }
}
