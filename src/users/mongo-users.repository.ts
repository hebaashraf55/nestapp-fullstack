import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import { Role } from './role';
import { User, UserDocument } from './user.schema';
import {
  DuplicateEmailError,
  DuplicateGoogleAccountError,
  NewUser,
  UserPageFilter,
  UserRecord,
  UsersRepository,
} from './users.repository';

const MONGO_DUPLICATE_KEY = 11000;

function toRecord(doc: UserDocument): UserRecord {
  return {
    id: doc.id as string,
    email: doc.email,
    name: doc.name,
    passwordHash: doc.passwordHash,
    role: doc.role,
    isDemo: doc.isDemo,
    emailVerified: doc.emailVerified,
    tokenVersion: doc.tokenVersion,
    ...(doc.googleSub ? { googleSub: doc.googleSub } : {}),
    createdAt: (doc as unknown as { createdAt: Date }).createdAt,
  };
}

@Injectable()
export class MongoUsersRepository extends UsersRepository {
  constructor(@InjectModel(User.name) private readonly model: Model<User>) {
    super();
  }

  async findById(id: string): Promise<UserRecord | null> {
    // A malformed id can never match; answer "not found" instead of letting Mongoose throw a CastError.
    if (!isValidObjectId(id)) return null;
    const doc = await this.model.findById(id).select('+passwordHash').exec();
    return doc ? toRecord(doc) : null;
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    // A non-string (e.g. a JSON object) can never match a stored email; answer "not found" instead of a CastError.
    if (typeof email !== 'string') return null;
    // `$eq` stops an object such as {"$ne": ""} from being interpreted as a query operator.
    const doc = await this.model
      .findOne({ email: { $eq: email } })
      .select('+passwordHash')
      .exec();
    return doc ? toRecord(doc) : null;
  }

  async create(user: NewUser): Promise<UserRecord> {
    try {
      return toRecord(await this.model.create(user));
    } catch (error) {
      if ((error as { code?: number; keyPattern?: object }).code === MONGO_DUPLICATE_KEY) {
        if ('googleSub' in ((error as { keyPattern?: object }).keyPattern ?? {}))
          throw new DuplicateGoogleAccountError();
        throw new DuplicateEmailError();
      }
      throw error;
    }
  }

  async findPage(filter: UserPageFilter): Promise<{ items: UserRecord[]; total: number }> {
    const query: Record<string, unknown> = { role: { $in: filter.roles } };
    if (filter.demoOnly) query.isDemo = true;
    const [docs, total] = await Promise.all([
      this.model
        .find(query)
        .sort({ createdAt: -1 })
        .skip((filter.page - 1) * filter.limit)
        .limit(filter.limit)
        .exec(),
      this.model.countDocuments(query).exec(),
    ]);
    return { items: docs.map(toRecord), total };
  }

  async findByIds(ids: string[]): Promise<UserRecord[]> {
    const valid = ids.filter((id) => isValidObjectId(id));
    if (valid.length === 0) return [];
    const docs = await this.model.find({ _id: { $in: valid } }).exec();
    return docs.map(toRecord);
  }

  async updateRoleAndDemo(id: string, role: Role, isDemo: boolean): Promise<void> {
    if (!isValidObjectId(id)) return;
    await this.model.updateOne({ _id: id }, { $set: { role, isDemo } }).exec();
  }

  async markEmailVerified(id: string): Promise<void> {
    if (!isValidObjectId(id)) return;
    await this.model.updateOne({ _id: id }, { $set: { emailVerified: true } }).exec();
  }

  async resetPassword(id: string, passwordHash: string): Promise<void> {
    if (!isValidObjectId(id)) return;
    await this.model
      .updateOne(
        { _id: id },
        { $set: { passwordHash, emailVerified: true }, $inc: { tokenVersion: 1 } },
      )
      .exec();
  }

  async findByGoogleSub(sub: string): Promise<UserRecord | null> {
    if (typeof sub !== 'string' || sub === '') return null;
    const doc = await this.model
      .findOne({ googleSub: { $eq: sub } })
      .select('+passwordHash')
      .exec();
    return doc ? toRecord(doc) : null;
  }

  async linkGoogle(id: string, sub: string, replacePasswordHash?: string): Promise<boolean> {
    if (!isValidObjectId(id) || typeof sub !== 'string' || sub === '') return false;
    try {
      const result = await this.model
        .updateOne(
          { _id: id, googleSub: { $exists: false } },
          replacePasswordHash
            ? {
                $set: { googleSub: sub, emailVerified: true, passwordHash: replacePasswordHash },
                $inc: { tokenVersion: 1 },
              }
            : { $set: { googleSub: sub, emailVerified: true } },
        )
        .exec();
      return result.modifiedCount === 1;
    } catch (error) {
      if ((error as { code?: number }).code === MONGO_DUPLICATE_KEY)
        throw new DuplicateGoogleAccountError();
      throw error;
    }
  }

  async bumpTokenVersion(id: string): Promise<void> {
    if (!isValidObjectId(id)) return;
    await this.model.updateOne({ _id: id }, { $inc: { tokenVersion: 1 } }).exec();
  }
}
