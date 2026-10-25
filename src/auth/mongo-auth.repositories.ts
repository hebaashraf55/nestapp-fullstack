import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import { Otp, RefreshToken } from './auth-storage.schemas';
import { NewOtp, OtpPurpose, OtpRecord, OtpRepository } from './otp.repository';
import {
  NewRefreshToken,
  RefreshTokenRecord,
  RefreshTokenRepository,
} from './refresh-token.repository';

@Injectable()
export class MongoOtpRepository extends OtpRepository {
  constructor(@InjectModel(Otp.name) private readonly model: Model<Otp>) {
    super();
  }

  private static toRecord(doc: Otp & { id: string }): OtpRecord {
    return {
      id: doc.id,
      userId: doc.userId,
      purpose: doc.purpose as OtpPurpose,
      codeHash: doc.codeHash,
      expiresAt: doc.expiresAt,
      attempts: doc.attempts,
      sentAt: doc.sentAt,
    };
  }

  async replace(otp: NewOtp): Promise<OtpRecord> {
    const doc = await this.model
      .findOneAndUpdate(
        { userId: { $eq: otp.userId }, purpose: { $eq: otp.purpose } },
        { $set: { ...otp, attempts: 0 } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    return MongoOtpRepository.toRecord(doc as Otp & { id: string });
  }

  async find(userId: string, purpose: OtpPurpose): Promise<OtpRecord | null> {
    const doc = await this.model
      .findOne({ userId: { $eq: userId }, purpose: { $eq: purpose } })
      .exec();
    return doc ? MongoOtpRepository.toRecord(doc as Otp & { id: string }) : null;
  }

  async addAttempt(id: string): Promise<number> {
    if (!isValidObjectId(id)) return Number.MAX_SAFE_INTEGER;
    const doc = await this.model
      .findOneAndUpdate({ _id: id }, { $inc: { attempts: 1 } }, { new: true })
      .exec();
    return doc ? doc.attempts : Number.MAX_SAFE_INTEGER;
  }

  async consume(id: string): Promise<boolean> {
    if (!isValidObjectId(id)) return false;
    const result = await this.model.deleteOne({ _id: id }).exec();
    return result.deletedCount === 1;
  }

  async deleteForUser(userId: string): Promise<void> {
    await this.model.deleteMany({ userId: { $eq: userId } }).exec();
  }
}

@Injectable()
export class MongoRefreshTokenRepository extends RefreshTokenRepository {
  constructor(@InjectModel(RefreshToken.name) private readonly model: Model<RefreshToken>) {
    super();
  }

  private static toRecord(doc: RefreshToken & { id: string; createdAt: Date }): RefreshTokenRecord {
    return {
      id: doc.id,
      userId: doc.userId,
      familyId: doc.familyId,
      tokenHash: doc.tokenHash,
      expiresAt: doc.expiresAt,
      revokedAt: doc.revokedAt ?? null,
      createdAt: doc.createdAt,
    };
  }

  async create(token: NewRefreshToken): Promise<RefreshTokenRecord> {
    const doc = await this.model.create(token);
    return MongoRefreshTokenRepository.toRecord(
      doc as unknown as RefreshToken & { id: string; createdAt: Date },
    );
  }

  async findByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    const doc = await this.model.findOne({ tokenHash: { $eq: tokenHash } }).exec();
    return doc
      ? MongoRefreshTokenRepository.toRecord(
          doc as unknown as RefreshToken & { id: string; createdAt: Date },
        )
      : null;
  }

  async revoke(id: string): Promise<boolean> {
    if (!isValidObjectId(id)) return false;
    const result = await this.model
      .updateOne({ _id: id, revokedAt: null }, { $set: { revokedAt: new Date() } })
      .exec();
    return result.modifiedCount === 1;
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.model
      .updateMany(
        { familyId: { $eq: familyId }, revokedAt: null },
        { $set: { revokedAt: new Date() } },
      )
      .exec();
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.model
      .updateMany({ userId: { $eq: userId }, revokedAt: null }, { $set: { revokedAt: new Date() } })
      .exec();
  }
}
