/**
 * Every call to an external API is reported here: the server decides whether to log it
 * («Писать запросы к внешним API и их длительность») and, in debug mode, to keep the raw answer.
 * Integrations stay free of the logger and the database.
 */
export interface ExternalRequest {
  integration: 'tinvest' | 'moex' | 'cbr' | 'coingecko' | 'bitcoin' | 'evm' | 'blockscout' | 'telegram';
  /** «OperationsService/GetOperationsByCursor», «GET /iss/securities.json». Never a token or a query secret. */
  method: string;
  /** HTTP status; 0 when no answer came. */
  status: number;
  durationMs: number;
  /** The answer as received, for debug mode; may be absent. */
  body?: string;
  error?: string;
}

type Listener = (request: ExternalRequest) => void;
const listeners = new Set<Listener>();

export function onExternalRequest(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function reportExternalRequest(request: ExternalRequest): void {
  for (const listener of listeners) {
    try {
      listener(request);
    } catch {
      // Observing must never break the call itself.
    }
  }
}

/** Path only: query strings of these APIs carry no secrets, but they make log lines long. */
export function methodOf(url: string): string {
  try {
    const u = new URL(url);
    return `GET ${u.pathname}`;
  } catch {
    return 'GET';
  }
}
