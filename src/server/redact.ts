export const REDACTED = '[redacted]';

// Field names that carry secrets, matched case-insensitively at the end of the name
// so that accessToken, x-api-key, set-cookie and client_secret are all caught.
const SECRET_KEY = /(token|password|passwd|secret|authorization|cookie|key)$/i;

export function isSecretKey(key: string): boolean {
  return SECRET_KEY.test(key.replace(/[-_]/g, ''));
}

/** Deep copy with every secret-named field replaced, at any depth. Handles cycles and errors. */
export function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => redact(item, seen));

  const source: Record<string, unknown> =
    value instanceof Error
      ? { ...value, type: value.name, message: value.message, stack: value.stack }
      : (value as Record<string, unknown>);
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(source)) {
    out[key] = isSecretKey(key) ? REDACTED : redact(item, seen);
  }
  return out;
}
