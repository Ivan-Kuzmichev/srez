import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '@/db/client';
import { notificationsState, settings as settingsTable } from '@/db/schema';
import { transitions } from '@/domain/notify';
import type { Fetch } from '@/integrations/errors';
import { currentConditions } from '@/server/notify-rules';
import { getSettings } from '@/server/settings';
import { defineJob } from './runner';
import { sendToOwner } from './notify-send';

export const NOTIFY_CHECK_JOB = 'notify.check';

/**
 * FR-NTF-2, 3 for one user: sends what became true since the last check, forgets what stopped being
 * true. A message that did not go stays unsent and is tried at the next check.
 */
export async function checkNotifications(
  db: Db,
  userId: string,
  now = new Date(),
  fetchFn?: Fetch,
): Promise<{ sent: number; cleared: number }> {
  const settings = getSettings(db, userId);
  if (!settings.notify.telegram.enabled) return { sent: 0, cleared: 0 };
  const rows = db.select().from(notificationsState).where(eq(notificationsState.userId, userId)).all();
  const active = new Set(rows.filter((r) => r.active).map((r) => r.key));
  const { fire, cleared } = transitions(active, currentConditions(db, userId, settings, now));

  let sent = 0;
  for (const c of fire) {
    if (!(await sendToOwner(db, userId, c.text, fetchFn))) break;
    db.insert(notificationsState)
      .values({ userId, key: c.key, active: true, lastSentAt: now })
      .onConflictDoUpdate({
        target: [notificationsState.userId, notificationsState.key],
        set: { active: true, lastSentAt: now },
      })
      .run();
    sent++;
  }
  for (const key of cleared)
    db.update(notificationsState)
      .set({ active: false })
      .where(and(eq(notificationsState.userId, userId), eq(notificationsState.key, key)))
      .run();
  return { sent, cleared: cleared.length };
}

export const notifyCheckJob = defineJob({
  name: NOTIFY_CHECK_JOB,
  payload: z.null(),
  async handler({ db, log }) {
    for (const { userId } of db.select({ userId: settingsTable.userId }).from(settingsTable).all()) {
      try {
        const r = await checkNotifications(db, userId);
        if (r.sent || r.cleared) log.info(r, 'Notifications checked');
      } catch (err) {
        log.warn({ err }, 'Notification check failed');
      }
    }
  },
});
