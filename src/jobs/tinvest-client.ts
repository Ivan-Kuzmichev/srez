import { TinvestClient } from '@/integrations/tinvest/client';
import { nodeTransport } from '@/integrations/tinvest/transport';
import { env } from '@/server/env';

/** The client for a plain token: the mock in tests (TINVEST_API_URL), the proxy if configured. */
export function tinvestClient(token: string): TinvestClient {
  const { TINVEST_API_URL, TINVEST_PROXY_URL } = env();
  return new TinvestClient(token, { baseUrl: TINVEST_API_URL, transport: nodeTransport(TINVEST_PROXY_URL) });
}
