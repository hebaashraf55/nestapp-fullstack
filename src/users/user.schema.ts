import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { Role, ROLES } from './role';

@Schema({ collection: 'users', timestamps: { createdAt: true, updatedAt: true } })
export class User {
  @Prop({ required: true, unique: true, lowercase: true, trim: true, maxlength: 254 })
  email!: string;

  @Prop({ required: true, trim: true, maxlength: 100 })
  name!: string;

  /** Excluded from queries by default; only the auth code path asks for it explicitly. */
  @Prop({ required: true, select: false })
  passwordHash!: string;

  @Prop({ required: true, enum: ROLES, default: Role.CUSTOMER })
  role!: Role;

  @Prop({ required: true, default: false, index: true })
  isDemo!: boolean;

  @Prop({ required: true, default: false })
  emailVerified!: boolean;

  @Prop({ required: true, default: 0 })
  tokenVersion!: number;
}

export type UserDocument = HydratedDocument<User>;
export const UserSchema = SchemaFactory.createForClass(User);
