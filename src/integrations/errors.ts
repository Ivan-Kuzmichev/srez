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

/** GET JSON with a timeout; any failure becomes an IntegrationError. */
export async function getJson(
  integration: string,
  url: string,
  fetchFn: Fetch,
  timeoutMs = 8000,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchFn(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'application/json' },
    });
  } catch (err) {
    const timeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    throw new IntegrationError(integration, timeout ? 'TIMEOUT' : 'NETWORK', String(err));
  }
  if (!res.ok) throw new IntegrationError(integration, 'HTTP', `HTTP ${res.status}`, res.status);
  try {
    return await res.json();
  } catch (err) {
    throw new IntegrationError(integration, 'BAD_RESPONSE', String(err));
  }
}
