import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export const ADDRESSES_PER_USER = 10;

@Schema({ collection: 'addresses', timestamps: true })
export class Address {
  @Prop({ required: true, index: true })
  userId!: string;
  @Prop({ default: '', maxlength: 40 })
  label!: string;
  @Prop({ required: true, maxlength: 80 })
  fullName!: string;
  @Prop({ required: true, maxlength: 120 })
  line1!: string;
  @Prop({ default: '', maxlength: 120 })
  line2!: string;
  @Prop({ required: true, maxlength: 80 })
  city!: string;
  @Prop({ required: true, maxlength: 20 })
  postalCode!: string;
  @Prop({ required: true, maxlength: 56 })
  country!: string;
  @Prop({ required: true, maxlength: 24 })
  phone!: string;
  @Prop({ required: true, default: false })
  isDefault!: boolean;
}
export type AddressDocument = HydratedDocument<Address>;
export const AddressSchema = SchemaFactory.createForClass(Address);
// At most one default per customer, enforced by the database.
AddressSchema.index(
  { userId: 1 },
  { unique: true, partialFilterExpression: { isDefault: true }, name: 'one_default_per_user' },
);
