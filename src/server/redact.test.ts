import { describe, expect, it } from 'vitest';
import { REDACTED, redact } from './redact';

describe('redact', () => {
  it('replaces secret fields at any depth', () => {
    const input = {
      user: 'admin',
      password: 'p',
      nested: { deeper: [{ accessToken: 't', apiKey: 'k', value: 1 }] },
      headers: { Authorization: 'Bearer x', cookie: 'c', 'set-cookie': 'c2', 'x-api-key': 'k2' },
      client_secret: 's',
    };
    expect(redact(input)).toEqual({
      user: 'admin',
      password: REDACTED,
      nested: { deeper: [{ accessToken: REDACTED, apiKey: REDACTED, value: 1 }] },
      headers: { Authorization: REDACTED, cookie: REDACTED, 'set-cookie': REDACTED, 'x-api-key': REDACTED },
      client_secret: REDACTED,
    });
  });

  it('does not mutate the input and survives cycles', () => {
    const input: Record<string, unknown> = { token: 't' };
    input.self = input;
    const out = redact(input) as Record<string, unknown>;
    expect(input.token).toBe('t');
    expect(out).toEqual({ token: REDACTED, self: '[circular]' });
  });

  it('keeps error details but redacts secret properties on them', () => {
    const err = Object.assign(new Error('failed'), { token: 't', status: 401 });
    const out = redact({ err }) as { err: Record<string, unknown> };
    expect(out.err).toMatchObject({ type: 'Error', message: 'failed', token: REDACTED, status: 401 });
    expect(typeof out.err.stack).toBe('string');
  });
});
