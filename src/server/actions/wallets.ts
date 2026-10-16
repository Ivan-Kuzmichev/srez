'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/db/client';
import { sources } from '@/db/schema';
import { isBitcoinAddress, isEvmAddress, isTronAddress } from '@/integrations/chains/address';
import { EVM_NETWORKS } from '@/integrations/chains/networks';
import { enqueueWalletSync } from '@/jobs/wallet-sync';
import { authedAction } from '../action';
import { logger } from '../logger';
import { addWallet, previewWallet, rebuildWalletHistory, type WalletPreview } from '../wallets';

const EVM_IDS = EVM_NETWORKS.map((n) => n.id) as [string, ...string[]];
const FAMILIES = ['bitcoin', 'evm', 'tron'] as const;
const validAddress = (family: (typeof FAMILIES)[number], address: string) =>
  family === 'bitcoin'
    ? isBitcoinAddress(address)
    : family === 'tron'
      ? isTronAddress(address)
      : isEvmAddress(address);
const Target = z
  .object({
    family: z.enum(FAMILIES),
    address: z.string().trim().min(10).max(100),
    networks: z.array(z.enum(EVM_IDS)).max(EVM_IDS.length).default([]),
  })
  .refine((t) => validAddress(t.family, t.address), {
    path: ['address'],
    message: 'BAD_ADDRESS',
  })
  .refine((t) => t.family !== 'evm' || t.networks.length > 0, {
    path: ['networks'],
    message: 'NO_NETWORKS',
  });

/** FR-CRY-1, 2: checks the address and asks public nodes what it holds; nothing is saved. */
export const previewWalletAction = authedAction(Target, async (target, session) => {
  try {
    const data: WalletPreview = await previewWallet(db(), session.user.id, {
      ...target,
      networks: target.family === 'evm' ? target.networks : [target.family],
    });
    return { ok: true, data };
  } catch (err) {
    logger('chains').warn({ err, family: target.family }, 'Wallet preview failed');
    return { ok: false, code: 'NODES' };
  }
});

/** FR-CRY-1…5: saves the wallet and queues its first sync. */
export const addWalletAction = authedAction(
  z.object({
    family: z.enum(FAMILIES),
    address: z.string().trim().min(10).max(100),
    networks: z.array(z.enum(EVM_IDS)).max(EVM_IDS.length),
    name: z.string().trim().min(1).max(60),
    accountId: z.string().max(64).nullable(),
    mode: z.enum(['history', 'balances']),
    hideSpam: z.boolean(),
    replace: z.array(z.object({ accountId: z.string().max(64), coingeckoId: z.string().max(100) })).max(50),
  }),
  async (input, session) => {
    if (!validAddress(input.family, input.address)) return { ok: false, code: 'BAD_ADDRESS' };
    if (input.family === 'evm' && input.networks.length === 0) return { ok: false, code: 'INVALID_INPUT' };
    const r = addWallet(db(), session.user.id, input);
    if (!r.ok) return { ok: false, code: r.code };
    enqueueWalletSync(db(), r.sourceId, 'manual');
    return { ok: true, data: { accountId: r.accountId } };
  },
);

/** «Синхронизировать» on a wallet card. */
export const syncWalletNow = authedAction(
  z.object({ sourceId: z.string().min(1).max(64) }),
  async ({ sourceId }, session) => {
    const own = db()
      .select({ id: sources.id })
      .from(sources)
      .where(and(eq(sources.id, sourceId), eq(sources.userId, session.user.id), eq(sources.kind, 'wallet')))
      .get();
    if (!own) return { ok: false, code: 'NOT_FOUND' };
    enqueueWalletSync(db(), sourceId, 'manual');
    revalidatePath('/sources');
    return { ok: true, data: null };
  },
);

/** «Пересобрать историю» on a wallet card: the chain's operations go, a full sync reads them again. */
export const rebuildWallet = authedAction(
  z.object({ sourceId: z.string().min(1).max(64) }),
  async ({ sourceId }, session) => {
    if (!rebuildWalletHistory(db(), session.user.id, sourceId)) return { ok: false, code: 'NOT_FOUND' };
    logger('chains').info({ sourceId }, 'Wallet history rebuild queued');
    enqueueWalletSync(db(), sourceId, 'manual');
    revalidatePath('/', 'layout');
    return { ok: true, data: null };
  },
);
