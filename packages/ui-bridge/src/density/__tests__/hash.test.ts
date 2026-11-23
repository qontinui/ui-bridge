// @vitest-environment node
/**
 * hash.ts: SHA-256 against published vectors, and the RFC 8785 form against
 * the RFC's own examples. Every expected value is a literal.
 */
import { describe, expect, it } from 'vitest';
import {
  DensityHashError,
  canonicalDensityJson,
  densityAsksHash,
  hashDensityCanonical,
  sha256DensityHex,
} from '../hash';
import { parseDensityTargets } from '../schema';

describe('density hash', () => {
  it('runs with no DOM', () => {
    expect(typeof document).toBe('undefined');
  });

  it('SHA-256 of the empty string is the FIPS 180-4 vector', () => {
    expect(sha256DensityHex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });

  it('SHA-256 of "abc" is the FIPS 180-4 vector', () => {
    expect(sha256DensityHex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  it('SHA-256 of the two-block FIPS 180-4 message', () => {
    expect(sha256DensityHex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'
    );
  });

  it('SHA-256 encodes as UTF-8: two-, three- and four-byte characters', () => {
    expect(sha256DensityHex('é')).toBe(
      '4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c'
    );
    expect(sha256DensityHex('€😀')).toBe(
      'aa6ac38b88868c15ec32bf6cca0dda3ffa2595bdf3e1ae98c328b799f889b9ac'
    );
  });

  it('SHA-256 of a 1000-byte message (many blocks)', () => {
    expect(sha256DensityHex('a'.repeat(1000))).toBe(
      '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3'
    );
  });

  it('refuses a lone surrogate rather than hash it like another string', () => {
    expect(() => sha256DensityHex('\ud800')).toThrow(DensityHashError);
    expect(() => sha256DensityHex('a\udc00')).toThrow(DensityHashError);
  });

  it('canonical JSON is the RFC 8785 serialization of the RFC example', () => {
    // RFC 8785 section 3.2.2. Built from code points so no source escaping is in doubt.
    const cp = (...codes: number[]) => String.fromCodePoint(...codes);
    const BS = cp(92);
    const QUOTE = cp(34);
    const input = {
      // Parsed, as the RFC's input is: 333333333.33333329 is not representable as a literal.
      numbers: JSON.parse(
        '[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001]'
      ) as number[],
      // EURO SIGN, $, U+000F, LF, A, ', B, ", backslash, backslash, ", /
      string: cp(0x20ac, 0x24, 0x0f, 0x0a, 0x41, 0x27, 0x42, 0x22, 0x5c, 0x5c, 0x22, 0x2f),
      literals: [null, true, false],
    };
    const expected =
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"' +
      cp(0x20ac) +
      '$' +
      BS +
      'u000f' +
      BS +
      'n' +
      "A'B" +
      BS +
      QUOTE +
      BS +
      BS +
      BS +
      BS +
      BS +
      QUOTE +
      '/"}';
    expect(canonicalDensityJson(input)).toBe(expected);
  });

  it('canonical JSON orders keys by UTF-16 code units (RFC 8785 section 3.2.3)', () => {
    const cp = (...codes: number[]) => String.fromCodePoint(...codes);
    const input: Record<string, string> = {};
    input[cp(0x20ac)] = 'Euro Sign';
    input[cp(0x0d)] = 'Carriage Return';
    input[cp(0xfb33)] = 'Hebrew Letter Dalet With Dagesh';
    input['1'] = 'One';
    input[cp(0x1f600)] = 'Emoji: Grinning Face';
    input[cp(0x80)] = 'Control';
    input[cp(0xf6)] = 'Latin Small Letter O With Diaeresis';
    const expected =
      '{"' +
      cp(92) +
      'r":"Carriage Return","1":"One","' +
      cp(0x80) +
      '":"Control","' +
      cp(0xf6) +
      '":"Latin Small Letter O With Diaeresis","' +
      cp(0x20ac) +
      '":"Euro Sign","' +
      cp(0x1f600) +
      '":"Emoji: Grinning Face","' +
      cp(0xfb33) +
      '":"Hebrew Letter Dalet With Dagesh"}';
    expect(canonicalDensityJson(input)).toBe(expected);
  });

  it('canonical JSON writes -0 as 0, sorts nested keys, and keeps array order', () => {
    expect(canonicalDensityJson({ b: [-0, 1.5, { d: 1, c: null }], a: 'x' })).toBe(
      '{"a":"x","b":[0,1.5,{"c":null,"d":1}]}'
    );
  });

  it('canonical JSON refuses what has no JSON form', () => {
    expect(() => canonicalDensityJson(Number.NaN)).toThrow(DensityHashError);
    expect(() => canonicalDensityJson({ a: Infinity })).toThrow(DensityHashError);
    expect(() => canonicalDensityJson([undefined])).toThrow(DensityHashError);
    expect(() => canonicalDensityJson({ s: 'x\ud800' })).toThrow(DensityHashError);
    expect(() => canonicalDensityJson(() => 1)).toThrow(DensityHashError);
  });

  it('canonical JSON refuses what JSON.parse cannot produce: cycles, holes, non-plain objects', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalDensityJson(cyclic)).toThrow(DensityHashError);
    // eslint-disable-next-line no-sparse-arrays
    expect(() => canonicalDensityJson([1, , 3])).toThrow(DensityHashError);
    expect(() => canonicalDensityJson({ at: new Date(0) })).toThrow(DensityHashError);
    expect(() => canonicalDensityJson(new Map())).toThrow(DensityHashError);
    // A shared (non-cyclic) reference is fine.
    const shared = { a: 1 };
    expect(canonicalDensityJson({ x: shared, y: shared })).toBe('{"x":{"a":1},"y":{"a":1}}');
    expect(canonicalDensityJson(Object.create(null) as object)).toBe('{}');
  });

  it('a hash does not depend on key order', () => {
    expect(hashDensityCanonical({ a: 1, b: 2 })).toBe(hashDensityCanonical({ b: 2, a: 1 }));
    expect(hashDensityCanonical({ a: 1, b: 2 })).toBe(sha256DensityHex('{"a":1,"b":2}'));
  });

  it('asksHash is the hash of each role and its parsed asks', () => {
    const parsed = parseDensityTargets({
      schema: 'ui-bridge/density-targets@1',
      surface: '/',
      profile: 'audience_profile/synthetic@1',
      roles: [
        {
          role: 'buyer',
          asks: [
            {
              id: 'B1',
              rank: 1,
              weight: 5,
              kind: 'state',
              question: 'Which orders need action?',
              source: { doc: 'audience_profile/synthetic@1', quote: 'Buyers check orders.' },
              answer: { idPrefix: 'app.orders.' },
            },
          ],
        },
      ],
    });
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.problems));
    expect(densityAsksHash(parsed.value)).toBe(
      sha256DensityHex(
        '[{"asks":[{"answer":{"idPrefix":"app.orders."},"findChars":0,"form":null,"id":"B1","kind":"state",' +
          '"need":"any","question":"Which orders need action?","rank":1,' +
          '"source":{"doc":"audience_profile/synthetic@1","quote":"Buyers check orders."},"via":[],"weight":5}],' +
          '"role":"buyer"}]'
      )
    );
  });
});
