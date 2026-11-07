import { z } from 'zod';

const plain = (max: number, min = 0) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    // eslint-disable-next-line no-control-regex
    .refine((s) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s), {
      error: 'must not contain control characters',
    });

export const moodboardCreateSchema = z.strictObject({
  name: plain(60, 1),
  note: plain(500).default(''),
});
export type MoodboardCreateDto = z.infer<typeof moodboardCreateSchema>;

export const moodboardUpdateSchema = z
  .strictObject({ name: plain(60, 1).optional(), note: plain(500).optional() })
  .refine((v) => Object.keys(v).length > 0, { error: 'provide at least one field to change' });
export type MoodboardUpdateDto = z.infer<typeof moodboardUpdateSchema>;
