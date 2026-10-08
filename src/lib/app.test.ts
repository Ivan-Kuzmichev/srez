import { describe, expect, it } from 'vitest';
import { APP_NAME } from './app';

describe('APP_NAME', () => {
  it('is Srez', () => {
    expect(APP_NAME).toBe('Srez');
  });
});
