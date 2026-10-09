import { z } from 'zod';
import { IntegrationError, type Fetch } from '../errors';
import { reportExternalRequest } from '../observe';

/** Telegram Bot API (docs/05-integrations.md, section 6): only sendMessage. */
const BASE = () => process.env.TELEGRAM_API_URL ?? 'https://api.telegram.org';
const Answer = z.object({
  ok: z.boolean(),
  description: z.string().optional(),
  error_code: z.number().optional(),
});

export const TELEGRAM_TOKEN_RE = /^\d{5,}:[A-Za-z0-9_-]{30,}$/;
export const TELEGRAM_CHAT_RE = /^(-?\d{3,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$/;

export type TelegramFailure = 'TOKEN' | 'CHAT' | 'NETWORK';

/**
 * Sends one message. The token is part of the URL, so the log line shows only the method. A refused
 * token is TOKEN, an unknown chat or a bot never started there is CHAT, anything else NETWORK.
 */
export async function sendTelegram(
  token: string,
  chatId: string,
  text: string,
  fetchFn: Fetch = fetch,
): Promise<void> {
  const started = Date.now();
  let status = 0;
  try {
    const res = await fetchFn(`${BASE()}/bot${token}/sendMessage`, {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    status = res.status;
    const body = Answer.safeParse(await res.json().catch(() => null));
    reportExternalRequest({
      integration: 'telegram',
      method: 'sendMessage',
      status,
      durationMs: Date.now() - started,
    });
    if (res.ok && body.success && body.data.ok) return;
    const code: TelegramFailure =
      status === 401 || status === 404 ? 'TOKEN' : status === 400 || status === 403 ? 'CHAT' : 'NETWORK';
    throw new IntegrationError('telegram', 'HTTP', code, status);
  } catch (err) {
    if (err instanceof IntegrationError) throw err;
    reportExternalRequest({
      integration: 'telegram',
      method: 'sendMessage',
      status: 0,
      durationMs: Date.now() - started,
      error: String(err),
    });
    throw new IntegrationError('telegram', 'NETWORK', 'NETWORK');
  }
}

export function telegramFailure(err: unknown): TelegramFailure {
  const m = err instanceof IntegrationError ? err.message : '';
  return m === 'TOKEN' || m === 'CHAT' ? m : 'NETWORK';
}
