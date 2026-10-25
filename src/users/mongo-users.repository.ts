import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import { Role } from './role';
import { User, UserDocument } from './user.schema';
import { DuplicateEmailError, NewUser, UserRecord, UsersRepository } from './users.repository';

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
      if ((error as { code?: number }).code === MONGO_DUPLICATE_KEY)
        throw new DuplicateEmailError();
      throw error;
    }
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

  async bumpTokenVersion(id: string): Promise<void> {
    if (!isValidObjectId(id)) return;
    await this.model.updateOne({ _id: id }, { $inc: { tokenVersion: 1 } }).exec();
  }
}
