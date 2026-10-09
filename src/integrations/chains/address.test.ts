import { describe, expect, it } from 'vitest';
import { isBitcoinAddress, isEvmAddress, toChecksumAddress } from './address';
import { keccak256 } from './keccak';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

describe('keccak-256', () => {
  it('known vectors', () => {
    expect(hex(keccak256(new Uint8Array()))).toBe(
      'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
    );
    expect(hex(keccak256(new TextEncoder().encode('abc')))).toBe(
      '4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45',
    );
    // Longer than one 136-byte block.
    expect(hex(keccak256(new Uint8Array(200).fill(0x61)))).toHaveLength(64);
    expect(hex(keccak256(new TextEncoder().encode('balanceOf(address)'))).slice(0, 8)).toBe('70a08231');
  });
});

describe('addresses', () => {
  it('bitcoin: legacy, script, segwit and taproot, with checksums', () => {
    expect(isBitcoinAddress('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')).toBe(true);
    expect(isBitcoinAddress('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb')).toBe(false);
    expect(isBitcoinAddress('3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy')).toBe(true);
    expect(isBitcoinAddress('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq')).toBe(true);
    expect(isBitcoinAddress('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdx')).toBe(false);
    expect(isBitcoinAddress('bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297')).toBe(true);
    expect(isBitcoinAddress('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx')).toBe(false);
    expect(isBitcoinAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')).toBe(false);
  });

  it('evm: EIP-55 checksum when the case is mixed', () => {
    expect(isEvmAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')).toBe(true);
    expect(isEvmAddress('0xd8da6bf26964af9d7eed9e03e53415d37aa96045')).toBe(true);
    expect(isEvmAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96046')).toBe(false);
    expect(isEvmAddress('0xd8DA6BF26964aF9D7eEd9e03E53415D37aA96045')).toBe(false);
    expect(isEvmAddress('d8da6bf26964af9d7eed9e03e53415d37aa96045')).toBe(false);
    expect(toChecksumAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')).toBe(
      '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
    );
  });
});
