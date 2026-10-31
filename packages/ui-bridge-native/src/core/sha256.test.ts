import { describe, it, expect } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import {
  bytesToHex,
  constantTimeEqual,
  hmacSha256,
  sha256Bytes,
  sha256Hex,
  utf8Bytes,
} from './sha256';

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

describe('sha256Bytes', () => {
  it('is the bytes sha256Hex renders', () => {
    expect(bytesToHex(sha256Bytes(utf8Bytes('abc')))).toBe(sha256Hex('abc'));
    expect(sha256Bytes(new Uint8Array())).toHaveLength(32);
  });

  it('hashes bytes that are not valid UTF-8', () => {
    const bytes = new Uint8Array([0xff, 0x00, 0xfe, 0x80]);
    expect(bytesToHex(sha256Bytes(bytes))).toBe(
      createHash('sha256').update(Buffer.from(bytes)).digest('hex')
    );
  });
});

describe('hmacSha256', () => {
  const hex = (value: string): Uint8Array => new Uint8Array(Buffer.from(value, 'hex'));

  it('matches the RFC 4231 vectors', () => {
    expect(bytesToHex(hmacSha256(hex('0b'.repeat(20)), utf8Bytes('Hi There')))).toBe(
      'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7'
    );
    expect(
      bytesToHex(hmacSha256(utf8Bytes('Jefe'), utf8Bytes('what do ya want for nothing?')))
    ).toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
    // Case 6: a key longer than one block is hashed first.
    expect(
      bytesToHex(
        hmacSha256(
          hex('aa'.repeat(131)),
          utf8Bytes('Test Using Larger Than Block-Size Key - Hash Key First')
        )
      )
    ).toBe('60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54');
  });

  it('matches the reference across every key and message boundary', () => {
    for (const keyLength of [0, 1, 32, 63, 64, 65, 200]) {
      for (const messageLength of [0, 1, 55, 56, 64, 119, 1000]) {
        const key = new Uint8Array(keyLength).fill(0x5a);
        const message = new Uint8Array(messageLength).fill(0xc3);
        expect(bytesToHex(hmacSha256(key, message))).toBe(
          createHmac('sha256', Buffer.from(key)).update(Buffer.from(message)).digest('hex')
        );
      }
    }
  });
});

describe('constantTimeEqual', () => {
  it('compares whole strings wherever they differ', () => {
    expect(constantTimeEqual('abcdef', 'abcdef')).toBe(true);
    expect(constantTimeEqual('', '')).toBe(true);
    expect(constantTimeEqual('xbcdef', 'abcdef')).toBe(false);
    expect(constantTimeEqual('abcdex', 'abcdef')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
  });
});
