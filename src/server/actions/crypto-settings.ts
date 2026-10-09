'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/db/client';
import { bitcoinProvider } from '@/integrations/chains/bitcoin';
import { checkBlockscoutKey, evmProvider } from '@/integrations/chains/evm';
import { NETWORKS } from '@/integrations/chains/networks';
import { authedAction } from '../action';
import { logger } from '../logger';
import { removeServiceKey, setServiceKey } from '../service-keys';
import { updateSettings } from '../settings';

/** «Спам и мелкие остатки» (FR-CRY-4, FR-SET-5). */
export const saveCryptoSettings = authedAction(
  z.object({
    dustThresholdRub: z.coerce.number().min(0).max(1_000_000),
    hideUnpriced: z.boolean(),
    excludeHidden: z.boolean(),
  }),
  async (crypto, session) => {
    updateSettings(db(), session.user.id, { crypto });
    revalidatePath('/', 'layout');
    return { ok: true, data: null };
  },
);

export interface NodeHealth {
  id: string;
  name: string;
  state: 'ok' | 'down' | 'off';
  latencyMs: number | null;
}

/** «Проверить все» (FR-CRY-7): each network's public endpoints, with the first that answers. */
export const checkNodes = authedAction(z.null(), async () => {
  const btc = bitcoinProvider();
  const evm = evmProvider();
  const data: NodeHealth[] = await Promise.all(
    NETWORKS.map(async (n): Promise<NodeHealth> => {
      if (n.disabled) return { id: n.id, name: n.name, state: 'off', latencyMs: null };
      const h = await (n.family === 'bitcoin' ? btc : evm).health(n.id);
      return { id: n.id, name: n.name, state: h.ok ? 'ok' : 'down', latencyMs: h.ok ? h.latencyMs : null };
    }),
  );
  return { ok: true, data };
});

/** The Blockscout key: checked with one call while it is still in plain text here, then stored encrypted. */
export const saveBlockscoutKey = authedAction(
  z.object({ key: z.string().trim().min(8).max(200) }),
  async ({ key }) => {
    try {
      if (!(await checkBlockscoutKey(key))) return { ok: false, code: 'REFUSED' };
    } catch (err) {
      logger('chains').warn({ err }, 'Blockscout key check failed');
      return { ok: false, code: 'UNREACHABLE' };
    }
    setServiceKey(db(), 'blockscout', key);
    logger('chains').info('Blockscout key saved');
    revalidatePath('/settings/crypto');
    return { ok: true, data: null };
  },
);

export const removeBlockscoutKey = authedAction(z.null(), async () => {
  removeServiceKey(db(), 'blockscout');
  logger('chains').info('Blockscout key removed');
  revalidatePath('/settings/crypto');
  return { ok: true, data: null };
});
