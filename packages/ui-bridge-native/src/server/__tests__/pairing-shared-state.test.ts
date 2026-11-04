/**
 * The build inlines `pairing.ts` into every entry point, CJS and ESM alike, so
 * a provider from one entry can drive a server from another. Two separately
 * loaded copies of the module must agree on the identity symbol and on which
 * stores a failed revoke left suspect.
 */
import { describe, it, expect, vi } from 'vitest';
import type { PairingStore } from '../pairing';

type PairingModule = typeof import('../pairing');

async function freshCopy(): Promise<PairingModule> {
  vi.resetModules();
  return import('../pairing');
}

function unreadableStore(): PairingStore & { readable: boolean } {
  const store = {
    readable: false,
    token: 'o'.repeat(64) as string | null,
    get(): string | null {
      if (!store.readable) throw new Error('not loaded');
      return store.token;
    },
    set(token: string) {
      store.token = token;
    },
    clear() {
      store.token = null;
    },
    randomBytes: (n: number) => new Uint8Array(n).fill(0x42),
  };
  return store;
}

describe('pairing state shared across module copies', () => {
  it('agrees on the identity symbol', async () => {
    const first = await freshCopy();
    const second = await freshCopy();
    expect(second.PairingAuthority).not.toBe(first.PairingAuthority);
    expect(second.PAIRING_STORE_IDENTITY).toBe(first.PAIRING_STORE_IDENTITY);
  });

  it('sees a suspicion one copy set, and clears it when the other revokes', async () => {
    const first = await freshCopy();
    const second = await freshCopy();
    const store = unreadableStore();

    await expect(new first.PairingAuthority(store).revoke()).rejects.toMatchObject({
      code: 'PAIRING_UNAVAILABLE',
    });
    store.readable = true;

    const other = new second.PairingAuthority(store);
    await expect(
      other.pair({ trustedLoopback: true, peer: undefined, body: undefined })
    ).resolves.toMatchObject({ ok: false, error: second.PAIRING_SUSPENDED_MESSAGE });

    await other.revoke();
    await expect(
      new first.PairingAuthority(store).pair({
        trustedLoopback: true,
        peer: undefined,
        body: undefined,
      })
    ).resolves.toMatchObject({ ok: true, token: '42'.repeat(32) });
  });
});
