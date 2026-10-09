// A local stand-in for the Telegram Bot API: accepts one token and numeric chats, records messages.
// Used by unit tests (startTelegramMock) and by e2e (`tsx tests/mock/telegram.ts <port>`).
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export const MOCK_TELEGRAM_TOKEN = '123456789:AAEmockTelegramBotTokenForTestsOnly_x';
export const MOCK_TELEGRAM_CHAT = '100200300';

export interface TelegramMock {
  url: string;
  messages: { chatId: string; text: string }[];
  close(): Promise<void>;
}

export async function startTelegramMock(opts: { port?: number } = {}): Promise<TelegramMock> {
  const messages: TelegramMock['messages'] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const json = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.url === '/messages') return json(200, messages);
      const m = /^\/bot([^/]+)\/sendMessage$/.exec(req.url ?? '');
      if (!m) return json(404, { ok: false, error_code: 404, description: 'Not Found' });
      if (m[1] !== MOCK_TELEGRAM_TOKEN)
        return json(401, { ok: false, error_code: 401, description: 'Unauthorized' });
      const body = JSON.parse(raw || '{}');
      if (String(body.chat_id) !== MOCK_TELEGRAM_CHAT)
        return json(400, { ok: false, error_code: 400, description: 'Bad Request: chat not found' });
      messages.push({ chatId: String(body.chat_id), text: String(body.text) });
      json(200, { ok: true, result: { message_id: messages.length } });
    });
  });
  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    messages,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const mock = await startTelegramMock({ port: Number(process.argv[2] ?? 3197) });
  console.log(`Telegram mock on ${mock.url}`);
}
