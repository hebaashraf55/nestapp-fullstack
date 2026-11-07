import { z } from 'zod';
import { ADMIN_STATUS_TARGETS, CARRIERS } from './order-status';

/** Luhn checksum: true for digit strings that look like a payment card number. */
export function passesLuhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Finds any 13–19 digit run (spaces and dashes allowed between digits) that is a valid card number. */
export function containsCardNumber(text: string): boolean {
  const runs = text.match(/\d(?:[ -]?\d){12,18}/g) ?? [];
  return runs.some((run) => passesLuhn(run.replace(/\D/g, '')));
}

/*
 * Orders only ever need a delivery address and a phone number. strictObject rejects every other field,
 * so card fields (cardNumber, cvv, expiry, ...) are a 400; a card number pasted into the address is too.
 */
const addressText = z
  .string()
  .trim()
  .min(5)
  .max(200)
  .refine((v) => !containsCardNumber(v), { error: 'must not contain a card number' });
const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9 ()-]{5,18}[0-9]$/, { error: 'must be a valid phone number' })
  .refine((v) => v.replace(/\D/g, '').length <= 15, { error: 'must be a valid phone number' });
const objectId = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, { error: 'must be a valid id' })
  .transform((s) => s.toLowerCase());

/** Either a typed address and phone, or one of the customer's saved addresses. */
export const createOrderSchema = z.union([
  z.strictObject({ address: addressText, phone }),
  z.strictObject({ addressId: objectId }),
]);

/** Guest checkout: the browser cart, a delivery address and an email for the confirmation. */
export const guestOrderSchema = z.strictObject({
  email: z.email().trim().toLowerCase().max(254),
  items: z
    .array(z.strictObject({ productId: objectId, quantity: z.number().int().min(1).max(99) }))
    .min(1)
    .max(50),
  address: addressText,
  phone,
});
export type GuestOrderDto = z.infer<typeof guestOrderSchema>;

/** A guest proves access with the order number and the tracking code from the confirmation. */
export const trackSchema = z.strictObject({
  orderId: objectId,
  token: z.string().regex(/^[0-9a-f]{32}$/, { error: 'must be a valid tracking code' }),
});
export type TrackDto = z.infer<typeof trackSchema>;

const plain = (max: number, min: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    // eslint-disable-next-line no-control-regex
    .refine((s) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s), {
      error: 'must not contain control characters',
    });

export const returnRequestSchema = z.strictObject({ reason: plain(500, 10) });
export type ReturnRequestDto = z.infer<typeof returnRequestSchema>;

export const returnDecisionSchema = z.strictObject({
  decision: z.enum(['APPROVED', 'REJECTED', 'RECEIVED']),
  note: plain(300, 1).optional(),
});
export type ReturnDecisionDto = z.infer<typeof returnDecisionSchema>;

export const returnsQuerySchema = z.strictObject({
  status: z.enum(['REQUESTED', 'APPROVED', 'REJECTED', 'RECEIVED']).optional(),
});
export type ReturnsQueryDto = z.infer<typeof returnsQuerySchema>;

/** simulate-payment and refund take no body at all: anything sent is refused. */
export const emptyBodySchema = z.strictObject({});

/** Shipping can name a (simulated) carrier and a tracking number; other statuses take neither. */
export const orderStatusSchema = z
  .strictObject({
    status: z.enum(ADMIN_STATUS_TARGETS),
    carrier: z.enum(CARRIERS).optional(),
    trackingNumber: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9-]{6,40}$/, { error: 'use 6–40 letters, digits or "-"' })
      .optional(),
  })
  .refine(
    (v) => v.status === 'SHIPPED' || (v.carrier === undefined && v.trackingNumber === undefined),
    {
      error: 'carrier and tracking number only apply when shipping',
    },
  );

export type CreateOrderDto = z.infer<typeof createOrderSchema>;
export type OrderStatusDto = z.infer<typeof orderStatusSchema>;
