import { createHash } from 'node:crypto';
import { keccak256 } from './keccak';

/** FR-CRY-1: address formats with their checksums, so a typo is caught before anything is asked. */
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest();

function base58check(address: string): Uint8Array | null {
  let n = 0n;
  for (const ch of address) {
    const v = BASE58.indexOf(ch);
    if (v < 0) return null;
    n = n * 58n + BigInt(v);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  for (const ch of address) {
    if (ch !== '1') break;
    bytes.unshift(0);
  }
  const raw = Uint8Array.from(bytes);
  if (raw.length !== 25) return null;
  const sum = sha256(sha256(raw.subarray(0, 21)));
  return sum.subarray(0, 4).equals(raw.subarray(21)) ? raw : null;
}

const BECH32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
function polymod(values: number[]): number {
  const gen = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= gen[i]!;
  }
  return chk >>> 0;
}

function segwit(address: string): boolean {
  const lower = address.toLowerCase();
  if (address !== lower && address !== address.toUpperCase()) return false;
  const sep = lower.lastIndexOf('1');
  if (lower.slice(0, sep) !== 'bc' || lower.length > 90) return false;
  const data = [...lower.slice(sep + 1)].map((c) => BECH32.indexOf(c));
  if (data.length < 7 || data.some((v) => v < 0)) return false;
  const hrp = [...'bc'].map((c) => c.charCodeAt(0));
  const check = polymod([...hrp.map((c) => c >> 5), 0, ...hrp.map((c) => c & 31), ...data]);
  const version = data[0]!;
  // Version 0 is bech32 (constant 1), later versions bech32m (BIP-350).
  if (check !== (version === 0 ? 1 : 0x2bc830a3)) return false;
  const program = data.slice(1, -6).length * 5;
  const bytes = Math.floor(program / 8);
  if (version === 0) return bytes === 20 || bytes === 32;
  return version <= 16 && bytes >= 2 && bytes <= 40;
}

/** Mainnet P2PKH (1…), P2SH (3…), SegWit and Taproot (bc1…). */
export function isBitcoinAddress(address: string): boolean {
  if (/^bc1/i.test(address)) return segwit(address);
  const raw = base58check(address);
  return raw !== null && (raw[0] === 0x00 || raw[0] === 0x05);
}

/** EIP-55: mixed case must match the checksum; all lower or all upper case carries none. */
export function isEvmAddress(address: string): boolean {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return false;
  const body = address.slice(2);
  if (body === body.toLowerCase() || body === body.toUpperCase()) return true;
  return address === toChecksumAddress(address);
}

export function toChecksumAddress(address: string): string {
  const body = address.slice(2).toLowerCase();
  const hash = keccak256(new TextEncoder().encode(body));
  let out = '0x';
  for (let i = 0; i < 40; i++) {
    const nibble = (hash[i >> 1]! >> (i % 2 ? 0 : 4)) & 0xf;
    out += nibble >= 8 ? body[i]!.toUpperCase() : body[i]!;
  }
  return out;
}
