/**
 * Remediation coverage for the manual-test finding "P3 — `POST /control/key`
 * defaults `target=window`, so document-level handlers never fire".
 *
 * The finding is about the RUNNER's route (`POST /ui-bridge/control/key`,
 * implemented in `qontinui-runner/src-tauri/src/mcp/ui_bridge/keyboard.rs` +
 * `src/hooks/ui-bridge-events/useControlEvents.ts`), which is not editable
 * from this repo. What IS fixable here is the thing that made the two sibling
 * routes able to disagree in the first place: each one owned a private copy of
 * the target vocabulary, the default, and the resolution switch.
 *
 * `core/key-events.ts` now owns all three, and these tests pin the two claims
 * the runner wireup depends on:
 *
 *   1. THE ASYMMETRY IS REAL. A `document` dispatch reaches BOTH `document`
 *      and `window` listeners; a `window` dispatch reaches `window` ONLY. That
 *      is the whole bug — and it is also the proof that flipping a default from
 *      `window` to `document` cannot break a caller who wanted `window`.
 *   2. AN UNKNOWN TARGET IS REJECTED BY NAME, never coerced to the default.
 *      A typo that silently "succeeds" while reaching nothing is precisely the
 *      failure this endpoint family exists to avoid.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  KEY_DISPATCH_TARGETS,
  DEFAULT_KEY_DISPATCH_TARGET,
  resolveKeyTarget,
  dispatchKeySequence,
} from './key-events';

const offs: Array<() => void> = [];

/** Register a `keydown` listener on a target and collect the events it sees. */
function collectKeydown(target: EventTarget): KeyboardEvent[] {
  const seen: KeyboardEvent[] = [];
  const fn = (e: Event) => seen.push(e as KeyboardEvent);
  target.addEventListener('keydown', fn);
  offs.push(() => target.removeEventListener('keydown', fn));
  return seen;
}

afterEach(() => {
  for (const off of offs.splice(0)) off();
});

describe('key dispatch targets — shared vocabulary', () => {
  it('defaults to `document`, and an omitted target takes that default', () => {
    expect(DEFAULT_KEY_DISPATCH_TARGET).toBe('document');

    const resolved = resolveKeyTarget(undefined);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.target).toBe('document');
    expect(resolved.node).toBe(document);
  });

  it('accepts every canonical target and resolves each to the right node', () => {
    expect([...KEY_DISPATCH_TARGETS].sort()).toEqual(
      ['activeElement', 'body', 'document', 'window'].sort()
    );

    const nodes = KEY_DISPATCH_TARGETS.map((t) => {
      const r = resolveKeyTarget(t);
      expect(r.ok).toBe(true);
      return r.ok ? r.node : null;
    });
    expect(nodes).toEqual([document, document.body, window, document.activeElement ?? document.body]);
  });

  it('REJECTS an unknown target by name rather than falling back to the default', () => {
    const r = resolveKeyTarget('docuemnt');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('unknown-target');
    // The message must name both the bad value and the valid set, so the caller
    // can fix the typo without reading source.
    expect(r.error).toContain('docuemnt');
    expect(r.error).toContain('document');
  });

  it('rejects a non-string target instead of coercing it', () => {
    for (const bad of [42, true, {}, []]) {
      const r = resolveKeyTarget(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('unknown-target');
    }
  });
});

describe('key dispatch targets — why `document` is the default, not `window`', () => {
  it('a `document` dispatch reaches document AND window listeners', async () => {
    const onDocument = collectKeydown(document);
    const onWindow = collectKeydown(window);

    const resolved = resolveKeyTarget(undefined);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    await dispatchKeySequence(resolved.node, [{ key: 'Escape' }]);

    expect(onDocument.map((e) => e.key)).toEqual(['Escape']);
    // Bubbling carries it up to window, so nothing a `window` caller wanted is
    // lost by defaulting to `document`.
    expect(onWindow.map((e) => e.key)).toEqual(['Escape']);
  });

  it('a `window` dispatch reaches window ONLY — the document listener never fires', async () => {
    const onDocument = collectKeydown(document);
    const onWindow = collectKeydown(window);

    const resolved = resolveKeyTarget('window');
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    await dispatchKeySequence(resolved.node, [{ key: 'Escape' }]);

    expect(onWindow.map((e) => e.key)).toEqual(['Escape']);
    // THE BUG, pinned: window is not an ancestor of document, so an
    // Escape-to-close panel whose only close path is a `document` keydown
    // listener is unreachable through a `window`-defaulted endpoint. The
    // request still reports success.
    expect(onDocument).toHaveLength(0);
  });

  it('`document` delivery is a strict superset of `window` delivery', async () => {
    const reach = async (target: string): Promise<string[]> => {
      const hits: string[] = [];
      const onDoc = () => hits.push('document');
      const onWin = () => hits.push('window');
      document.addEventListener('keydown', onDoc);
      window.addEventListener('keydown', onWin);
      try {
        const r = resolveKeyTarget(target);
        if (!r.ok) throw new Error(r.error);
        await dispatchKeySequence(r.node, [{ key: 'Escape' }]);
      } finally {
        document.removeEventListener('keydown', onDoc);
        window.removeEventListener('keydown', onWin);
      }
      return hits;
    };

    const viaWindow = new Set(await reach('window'));
    const viaDocument = new Set(await reach('document'));

    for (const listener of viaWindow) {
      expect(viaDocument.has(listener)).toBe(true);
    }
    expect(viaDocument.size).toBeGreaterThan(viaWindow.size);
  });
});
