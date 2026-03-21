/**
 * Artifact Hashing
 *
 * Content-addressing via SHA-256 of canonical (deterministic) JSON.
 * Works in both browser (crypto.subtle) and Node.js (node:crypto) environments.
 */

/**
 * Compute a SHA-256 hex digest of the given data object.
 * Uses canonical JSON (sorted keys) for deterministic hashing.
 */
export async function computeHash(data: unknown): Promise<string> {
  const canonical = canonicalJson(data);
  const bytes = new TextEncoder().encode(canonical);

  // Browser environment
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
    return bufferToHex(hashBuffer);
  }

  // Node.js environment
  try {
    const nodeCrypto = await import('node:crypto');
    return nodeCrypto.createHash('sha256').update(bytes).digest('hex');
  } catch {
    // Fallback: simple FNV-1a hash (not cryptographic, but functional)
    return fnv1aFallback(canonical);
  }
}

/**
 * Produce canonical (deterministic) JSON with sorted keys.
 */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      return Object.keys(val)
        .sort()
        .reduce<Record<string, unknown>>((sorted, key) => {
          sorted[key] = (val as Record<string, unknown>)[key];
          return sorted;
        }, {});
    }
    return val;
  });
}

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * FNV-1a fallback for environments without crypto.
 * Returns a 16-char hex string (64-bit). Not cryptographic.
 */
function fnv1aFallback(str: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x01000193);
    h2 = Math.imul(h2 ^ (ch >>> 8), 0x01000193);
  }
  const hex1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const hex2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return hex1 + hex2;
}
