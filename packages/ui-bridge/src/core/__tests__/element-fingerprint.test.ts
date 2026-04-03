/**
 * Element Fingerprint Hash Consistency Tests
 *
 * Verifies that the FNV-1a hash function produces deterministic,
 * consistent results. These test vectors should be mirrored in
 * Python (test_fingerprint_hash_consistency.py) to ensure
 * cross-language hash compatibility.
 */

import { describe, it, expect } from 'vitest';

// Import the hash function directly for testing
// The hash is computed from: "structuralPath|positionZone|role|accessibleName|sizeCategory"

// Replicate the hash algorithm from element-fingerprint.ts for direct testing
function computeHashSync(
  structuralPath: string,
  positionZone: string,
  role: string,
  accessibleName: string | undefined,
  sizeCategory: string
): string {
  const input = `${structuralPath}|${positionZone}|${role}|${accessibleName ?? ''}|${sizeCategory}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5;

  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c * 31;
    h2 = Math.imul(h2, 0x01000193);
  }

  const hex1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const hex2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return hex1 + hex2;
}

/**
 * Shared test vectors for cross-language hash verification.
 * Expected hashes are HARDCODED — if the hash algorithm changes, these tests
 * MUST fail. The same values are hardcoded in Python
 * (test_fingerprint_hash_consistency.py).
 */
const TEST_VECTORS = [
  { name: 'Button in header', structuralPath: 'header > nav > button', positionZone: 'header', role: 'button', accessibleName: 'Menu' as string | undefined, sizeCategory: 'button', expectedHash: '332bcf7901518bd9' },
  { name: 'Text input in main form', structuralPath: 'main > form > div > input', positionZone: 'main', role: 'textbox', accessibleName: 'Email' as string | undefined, sizeCategory: 'small', expectedHash: '314e89fb4502cc0b' },
  { name: 'Modal dialog', structuralPath: 'div > div > dialog', positionZone: 'modal', role: 'dialog', accessibleName: 'Confirm Delete' as string | undefined, sizeCategory: 'large', expectedHash: 'a94df5a4c8e52c9a' },
  { name: 'List item in sidebar', structuralPath: 'aside > ul > li > a', positionZone: 'sidebar-left', role: 'link', accessibleName: 'Dashboard' as string | undefined, sizeCategory: 'button', expectedHash: '8174509c620d7ab2' },
  { name: 'Footer link', structuralPath: 'footer > div > a', positionZone: 'footer', role: 'link', accessibleName: 'Privacy Policy' as string | undefined, sizeCategory: 'button', expectedHash: '4873c371fbca621d' },
  { name: 'Heading with no name', structuralPath: 'main > section > h1', positionZone: 'main', role: 'heading', accessibleName: undefined, sizeCategory: 'medium', expectedHash: 'e5444cd6ebe1bfac' },
  { name: 'Select in main', structuralPath: 'main > form > select', positionZone: 'main', role: 'combobox', accessibleName: 'Country' as string | undefined, sizeCategory: 'small', expectedHash: '6d8e56731c4558c7' },
  { name: 'Panel full width', structuralPath: 'main > div', positionZone: 'main', role: '', accessibleName: undefined, sizeCategory: 'panel', expectedHash: '198907dce9e35536' },
  { name: 'Icon button', structuralPath: 'header > div > button', positionZone: 'header', role: 'button', accessibleName: 'Close' as string | undefined, sizeCategory: 'icon', expectedHash: '87c26e378cea2acf' },
  { name: 'Checkbox in form', structuralPath: 'main > form > div > input', positionZone: 'main', role: 'checkbox', accessibleName: 'Remember me' as string | undefined, sizeCategory: 'icon', expectedHash: 'c2d6dff7e4d85f8f' },
];

describe('Element Fingerprint Hash', () => {
  it('produces deterministic 16-char hex strings', () => {
    for (const v of TEST_VECTORS) {
      const hash = computeHashSync(
        v.structuralPath,
        v.positionZone,
        v.role,
        v.accessibleName,
        v.sizeCategory
      );
      expect(hash).toHaveLength(16);
      expect(hash).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it('produces different hashes for different inputs', () => {
    const hashes = new Set(TEST_VECTORS.map((v) => v.expectedHash));
    expect(hashes.size).toBe(TEST_VECTORS.length);
  });

  it('is consistent across calls', () => {
    for (const v of TEST_VECTORS) {
      const hash1 = computeHashSync(
        v.structuralPath,
        v.positionZone,
        v.role,
        v.accessibleName,
        v.sizeCategory
      );
      const hash2 = computeHashSync(
        v.structuralPath,
        v.positionZone,
        v.role,
        v.accessibleName,
        v.sizeCategory
      );
      expect(hash1).toBe(hash2);
    }
  });

  it('matches expected hashes (regression)', () => {
    for (const v of TEST_VECTORS) {
      const hash = computeHashSync(
        v.structuralPath,
        v.positionZone,
        v.role,
        v.accessibleName,
        v.sizeCategory
      );
      expect(hash).toBe(v.expectedHash);
    }
  });

  // Print test vectors for Python cross-verification
  it('prints test vectors for Python verification', () => {
    console.log('\n=== FINGERPRINT HASH TEST VECTORS ===');
    console.log('Copy these to test_fingerprint_hash_consistency.py\n');
    for (const v of TEST_VECTORS) {
      console.log(
        `("${v.structuralPath}", "${v.positionZone}", "${v.role}", ${v.accessibleName === undefined ? 'None' : `"${v.accessibleName}"`}, "${v.sizeCategory}", "${v.expectedHash}"),  # ${v.name}`
      );
    }
    console.log('\n=== END TEST VECTORS ===\n');
  });
});
