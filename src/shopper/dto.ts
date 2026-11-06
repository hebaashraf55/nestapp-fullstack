import { z } from 'zod';

const objectId = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, { error: 'must be a valid id' })
  .transform((s) => s.toLowerCase());

/** Guest lists merged at sign-in: at most 100 ids, newest first for recently viewed. */
export const mergeIdsSchema = z.strictObject({
  productIds: z.array(objectId).max(100),
});
export type MergeIdsDto = z.infer<typeof mergeIdsSchema>;
