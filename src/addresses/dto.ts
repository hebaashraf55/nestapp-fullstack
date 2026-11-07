import { z } from 'zod';
import { containsCardNumber } from '../orders/dto';

/** Plain text; card numbers and control characters are refused anywhere in an address. */
const text = (max: number, min = 1) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    // eslint-disable-next-line no-control-regex
    .refine((s) => !/[\u0000-\u001f\u007f]/.test(s), {
      error: 'must not contain control characters',
    })
    .refine((s) => !containsCardNumber(s), { error: 'must not contain a card number' });

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9 ()-]{5,18}[0-9]$/, { error: 'must be a valid phone number' })
  .refine((v) => v.replace(/\D/g, '').length <= 15, { error: 'must be a valid phone number' });

const fields = {
  label: text(40, 0).default(''),
  fullName: text(80),
  line1: text(120, 3),
  line2: text(120, 0).default(''),
  city: text(80),
  postalCode: text(20),
  country: text(56, 2),
  phone: phoneSchema,
};

export const addressCreateSchema = z.strictObject({
  ...fields,
  isDefault: z.boolean().default(false),
});
export type AddressCreateDto = z.infer<typeof addressCreateSchema>;

export const addressUpdateSchema = z
  .strictObject({
    label: fields.label.optional(),
    fullName: fields.fullName.optional(),
    line1: fields.line1.optional(),
    line2: fields.line2.optional(),
    city: fields.city.optional(),
    postalCode: fields.postalCode.optional(),
    country: fields.country.optional(),
    phone: fields.phone.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { error: 'provide at least one field to change' });
export type AddressUpdateDto = z.infer<typeof addressUpdateSchema>;
