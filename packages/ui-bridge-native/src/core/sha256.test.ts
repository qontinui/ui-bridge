import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { sha256Hex } from './sha256';

/** Node's SHA-256 of the same UTF-8 bytes — the reference this must equal. */
function reference(input: string): string {
  return createHash('sha256')
    .update(Buffer.from(new TextEncoder().encode(input)))
    .digest('hex');
}

describe('sha256Hex', () => {
  it('matches the FIPS 180-2 test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'
    );
  });

  it('matches the reference across every padding boundary', () => {
    // 55 bytes fits the length in one block; 56 forces a second; 64 is exact.
    for (const n of [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000]) {
      expect(sha256Hex('a'.repeat(n))).toBe(reference('a'.repeat(n)));
    }
  });

  it('hashes UTF-8 bytes, including astral characters', () => {
    for (const s of ['café', '“deploy”', '😎', 'ü/日本/😎?q=ß']) {
      expect(sha256Hex(s)).toBe(reference(s));
    }
  });

  it('encodes a lone surrogate as U+FFFD, exactly as TextEncoder does', () => {
    for (const s of ['\ud800', 'a\ud800b', '\udc00', 'x\udfff', '\ud83d']) {
      expect(sha256Hex(s)).toBe(reference(s));
    }
  });

  it('agrees with the reference on random strings', () => {
    let seed = 0x5eed;
    const next = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed;
    };
    for (let i = 0; i < 300; i++) {
      const len = next() % 200;
      let s = '';
      for (let j = 0; j < len; j++) s += String.fromCharCode(next() % 0x10000);
      expect(sha256Hex(s)).toBe(reference(s));
    }
  });
});
