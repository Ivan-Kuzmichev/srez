import { methodOf, reportExternalRequest, type ExternalRequest } from './observe';

/** A failed call to an external service, with a code the interface can turn into a readable message. */
export class IntegrationError extends Error {
  override name = 'IntegrationError';
  constructor(
    readonly integration: string,
    readonly code: 'TIMEOUT' | 'HTTP' | 'BAD_RESPONSE' | 'NETWORK',
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const observed = (integration: string): integration is ExternalRequest['integration'] =>
  integration === 'moex' || integration === 'cbr' || integration === 'coingecko' || integration === 'tinvest';

/** GET JSON with a timeout; any failure becomes an IntegrationError. */
export async function getJson(
  integration: string,
  url: string,
  fetchFn: Fetch,
  timeoutMs = 8000,
): Promise<unknown> {
  const started = Date.now();
  const report = (status: number, body?: string, error?: string) => {
    if (observed(integration))
      reportExternalRequest({
        integration,
        method: methodOf(url),
        status,
        durationMs: Date.now() - started,
        body,
        error,
      });
  };
  let res: Response;
  try {
    res = await fetchFn(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'application/json' },
    });
  } catch (err) {
    const timeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    report(0, undefined, String(err));
    throw new IntegrationError(integration, timeout ? 'TIMEOUT' : 'NETWORK', String(err));
  }
  const text = await res.text().catch(() => '');
  report(res.status, text);
  if (!res.ok) throw new IntegrationError(integration, 'HTTP', `HTTP ${res.status}`, res.status);
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new IntegrationError(integration, 'BAD_RESPONSE', String(err));
  }
}

/** GET raw bytes with the same error handling, for non-JSON sources (the CBR serves windows-1251 XML). */
export async function getBytes(
  integration: string,
  url: string,
  fetchFn: Fetch,
  timeoutMs = 8000,
): Promise<Uint8Array> {
  const started = Date.now();
  let res: Response;
  try {
    res = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const timeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    if (observed(integration))
      reportExternalRequest({
        integration,
        method: methodOf(url),
        status: 0,
        durationMs: Date.now() - started,
        error: String(err),
      });
    throw new IntegrationError(integration, timeout ? 'TIMEOUT' : 'NETWORK', String(err));
  }
  // Binary (windows-1251 XML): the raw copy is not kept, only the fact and the time.
  if (observed(integration))
    reportExternalRequest({
      integration,
      method: methodOf(url),
      status: res.status,
      durationMs: Date.now() - started,
    });
  if (!res.ok) throw new IntegrationError(integration, 'HTTP', `HTTP ${res.status}`, res.status);
  return new Uint8Array(await res.arrayBuffer());
}
