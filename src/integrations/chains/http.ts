import { IntegrationError, type Fetch } from '../errors';
import { reportExternalRequest, type ExternalRequest } from '../observe';

type Integration = Extract<ExternalRequest['integration'], 'bitcoin' | 'evm' | 'blockscout'>;

/**
 * One JSON request to the first endpoint that answers; the next is tried on a network error, a
 * timeout, HTTP 429 or 5xx, or a body the caller rejects. `method` is what the log shows: no address, no key.
 */
export async function requestJson<T>(
  integration: Integration,
  endpoints: readonly string[],
  path: string,
  options: {
    method: string;
    body?: unknown;
    headers?: Record<string, string>;
    fetchFn?: Fetch;
    timeoutMs?: number;
    /** Throws when the body is not usable: the next endpoint is tried. */
    parse: (body: unknown) => T;
  },
): Promise<T> {
  const fetchFn = options.fetchFn ?? fetch;
  let last: IntegrationError | null = null;
  for (const base of endpoints) {
    const started = Date.now();
    const report = (status: number, body?: string, error?: string) =>
      reportExternalRequest({
        integration,
        method: options.method,
        status,
        durationMs: Date.now() - started,
        body,
        error,
      });
    let res: Response;
    try {
      res = await fetchFn(base + path, {
        method: options.body === undefined ? 'GET' : 'POST',
        signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
        headers: {
          accept: 'application/json',
          ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
          ...options.headers,
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch (err) {
      const timeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      report(0, undefined, String(err));
      last = new IntegrationError(integration, timeout ? 'TIMEOUT' : 'NETWORK', String(err));
      continue;
    }
    const text = await res.text().catch(() => '');
    report(res.status, text);
    if (!res.ok) {
      last = new IntegrationError(integration, 'HTTP', `HTTP ${res.status}`, res.status);
      // A refused key or a bad request will not get better on another endpoint.
      if (res.status !== 429 && res.status < 500) throw last;
      continue;
    }
    try {
      return options.parse(JSON.parse(text));
    } catch (err) {
      last =
        err instanceof IntegrationError
          ? err
          : new IntegrationError(integration, 'BAD_RESPONSE', String(err));
    }
  }
  throw last ?? new IntegrationError(integration, 'NETWORK', 'No endpoints');
}
