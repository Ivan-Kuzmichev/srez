import { z } from 'zod';

/** Address bar of «Прибыль за год» and its CSV export. */
export const RealizedParams = z.object({
  portfolio: z.string().max(64).optional().catch(undefined),
  year: z
    .string()
    .regex(/^\d{4}$/)
    .optional()
    .catch(undefined),
  method: z.enum(['fifo', 'average']).catch('fifo'),
});
