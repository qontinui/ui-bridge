/**
 * The React Native hook's component-action shapes must be the SAME types the
 * executor takes, not a private copy.
 *
 * Post-merge follow-up to qontinui/ui-bridge#164. `react/useUIBridge.ts`
 * declared its own `ComponentActionRequest` — a fifth and sixth copy of a shape
 * `control/types.ts` already owned — and the copy had drifted: no `requestId`,
 * and crucially no `timeoutMs`. So a React Native caller reaching an action
 * through this hook could not express a timeout even though
 * `DefaultNativeActionExecutor` has honoured one since Phase 3 of plan
 * `2026-08-20-ui-bridge-action-declaration-shape`. `timeoutMs` is the ONLY
 * cancellation this seam can carry: the hook does not forward the executor's
 * in-process `{ signal }` bag, and an `AbortSignal` is not JSON-serializable.
 *
 * That is the plan's own defect class — a declared capability with no route to
 * the caller — and its stated remedy is "collapse before you extend", because
 * eight copies drift and two already had.
 *
 * Checked as SOURCE, with comments stripped so a name appearing only in prose
 * does not satisfy it: the hook module reaches `react-native`, whose
 * Flow-annotated entry point the test transformer cannot parse, and this
 * subtree's `.d.ts` output is disabled, so there is no compiled artifact to
 * introspect either.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const HOOK_PATH = 'src/native/react/useUIBridge.ts';
const CONTROL_PATH = 'src/native/control/types.ts';

function hookSourceWithoutComments(): string {
  return readFileSync(resolve(process.cwd(), HOOK_PATH), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('useUIBridge component-action shapes', () => {
  const source = hookSourceWithoutComments();

  it('re-exports the control types instead of re-declaring them', () => {
    expect(source).toMatch(/export type \{[\s\S]*?ComponentActionRequest[\s\S]*?\} from '\.\.\/control\/types'/);
    expect(source).toMatch(/export type \{[\s\S]*?ComponentActionResponse[\s\S]*?\} from '\.\.\/control\/types'/);
  });

  it('declares no local copy of either interface', () => {
    // A local `interface ComponentActionRequest {` here is the regression:
    // it type-checks, it looks harmless, and it silently withdraws `timeoutMs`
    // from every caller of this hook.
    expect(source).not.toMatch(/interface ComponentActionRequest\b/);
    expect(source).not.toMatch(/interface ComponentActionResponse\b/);
  });
});

describe('the control types the hook now re-exports', () => {
  const controlSource = readFileSync(resolve(process.cwd(), CONTROL_PATH), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  it('carry the wire-reachable timeout and the correlation id', () => {
    const request = controlSource.match(/interface ComponentActionRequest \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(request).toContain('timeoutMs?: number;');
    expect(request).toContain('requestId?: string;');
  });
});
