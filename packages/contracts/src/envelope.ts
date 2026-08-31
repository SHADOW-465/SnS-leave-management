import { z } from 'zod';

export const errorEnvelopeSchema = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
      requestId: z.string(),
    }),
  })
  .strict();

export const successEnvelopeSchema = z
  .object({
    data: z.unknown(),
    meta: z
      .object({
        requestId: z.string(),
        page: z
          .object({
            cursor: z.string().nullable(),
            limit: z.number(),
          })
          .optional(),
      })
      .passthrough(),
  })
  .strict();

export function ok<T>(data: T, requestId: string, page?: { cursor: string | null; limit: number }) {
  return { data, meta: { requestId, ...(page ? { page } : {}) } };
}

export function fail(
  requestId: string,
  code: string,
  message: string,
  details?: { path: string; message: string }[],
) {
  return { error: { code, message, details, requestId } };
}
