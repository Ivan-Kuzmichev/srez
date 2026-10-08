'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/db/client';
import { createManualAccount, createTag as insertTag } from '@/db/mutations/accounts';
import { ACCOUNT_KINDS } from '@/db/schema';
import { authedAction } from '../action';
import { logger } from '../logger';

const optionalId = z.preprocess((v) => (v === '' || v === 'none' ? null : v), z.string().max(64).nullable());

export const createAccount = authedAction(
  z.object({
    name: z.string().trim().min(1).max(64),
    kind: z.enum(ACCOUNT_KINDS),
    currency: z.string().regex(/^[A-Z]{3}$/),
    defaultTagId: optionalId.optional().default(null),
  }),
  async (input, session) => {
    const id = createManualAccount(db(), session.user.id, input);
    logger('web').info({ accountId: id, kind: input.kind }, 'Manual account created');
    revalidatePath('/sources');
    revalidatePath('/operations');
    return { ok: true, data: { id } };
  },
);

export const createTag = authedAction(
  z.object({ name: z.string().trim().min(1).max(40) }),
  async ({ name }, session) => {
    const tag = insertTag(db(), session.user.id, name);
    return { ok: true, data: tag };
  },
);
