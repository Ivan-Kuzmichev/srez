import { describe, expect, it } from 'vitest';
import { generateBackupCodes, normalizeBackupCode, totpSecretFromUri } from './two-factor';

describe('backup codes', () => {
  it('are ten distinct readable codes', () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
  });

  it('normalize what people type', () => {
    expect(normalizeBackupCode(' 4f7k 92qd ')).toBe('4F7K-92QD');
    expect(normalizeBackupCode('4F7K92QD')).toBe('4F7K-92QD');
    expect(normalizeBackupCode('4F7K-92QD')).toBe('4F7K-92QD');
  });
});

describe('totpSecretFromUri', () => {
  it('groups the secret by four', () => {
    expect(totpSecretFromUri('otpauth://totp/Srez:owner?secret=JBSWY3DPEHPK3PXP&issuer=Srez')).toBe(
      'JBSW Y3DP EHPK 3PXP',
    );
  });
});
