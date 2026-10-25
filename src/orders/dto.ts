import { z } from 'zod';
import { ADMIN_STATUS_TARGETS } from './order-status';

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
export const createOrderSchema = z.strictObject({
  address: z
    .string()
    .trim()
    .min(5)
    .max(200)
    .refine((v) => !containsCardNumber(v), { error: 'must not contain a card number' }),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9][0-9 ()-]{5,18}[0-9]$/, { error: 'must be a valid phone number' })
    .refine((v) => v.replace(/\D/g, '').length <= 15, { error: 'must be a valid phone number' }),
});

/** simulate-payment and refund take no body at all: anything sent is refused. */
export const emptyBodySchema = z.strictObject({});

export const orderStatusSchema = z.strictObject({ status: z.enum(ADMIN_STATUS_TARGETS) });

export type CreateOrderDto = z.infer<typeof createOrderSchema>;
export type OrderStatusDto = z.infer<typeof orderStatusSchema>;
