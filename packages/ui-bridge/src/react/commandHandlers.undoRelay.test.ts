/**
 * Relay `executeUndo` / `executeRedo` → the registered tracker.
 *
 * `POST /control/undo` and `/control/redo` are served two ways. The in-process
 * arm (`server/handlers.ts`) calls `undoTracker.executeUndo()` and answers
 * `{ executed }`, which is what `server/types.ts` declares for the handler.
 * The relay arm reaches the browser and lands in `executeCommand`, and it used
 * to do none of that: it dispatched a bare `new KeyboardEvent('keydown',
 * { key: 'z', ctrlKey: true, bubbles: true })` and returned
 * `{ success: true, method: 'keyboard' }` unconditionally.
 *
 * Four defects in that one statement, all of the "reports success while
 * reaching nothing" shape this module's `buildKeyboardEventInit` exists to
 * close:
 *
 *  1. the tracker was never consulted, so an app that declared `onUndo` — the
 *     documented way to wire undo — never had it called over the relay;
 *  2. the init carried no `keyCode`/`which`/`code`, so a handler written
 *     `if (e.ctrlKey && e.keyCode === 90)` saw 0 and no-opped;
 *  3. it was Ctrl-only, so it was dead on macOS, where the tracker's own
 *     fallback correctly sends Meta;
 *  4. it aimed at `document` rather than the focused element.
 *
 * These tests pin all four, plus the `{ executed }` shape parity with the
 * in-process arm.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { executeCommand, type BridgeAccess } from './commandHandlers';

const emptyBridge: BridgeAccess = {
  elements: [],
  getElement: () => undefined,
  components: [],
  workflows: [],
};

type UndoResult = {
  success: boolean;
  executed: boolean;
  method: string;
  defaultPrevented?: boolean;
};

function setTracker(tracker: unknown): void {
  (globalThis as unknown as { __UI_BRIDGE__?: unknown }).__UI_BRIDGE__ = tracker
    ? { undoTracker: tracker }
    : {};
}

describe('relay executeUndo/executeRedo', () => {
  let field: HTMLInputElement;

  beforeEach(() => {
    field = document.createElement('input');
    document.body.appendChild(field);
    field.focus();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    setTracker(null);
  });

  describe('with a registered tracker', () => {
    it('calls the tracker rather than hand-dispatching a keystroke', async () => {
      const executeUndo = vi.fn(() => true);
      const executeRedo = vi.fn(() => true);
      setTracker({ getState: () => ({}), executeUndo, executeRedo });

      const seen: KeyboardEvent[] = [];
      field.addEventListener('keydown', (e) => seen.push(e));

      const res = (await executeCommand('executeUndo', {}, emptyBridge)) as UndoResult;

      expect(executeUndo).toHaveBeenCalledTimes(1);
      expect(executeRedo).not.toHaveBeenCalled();
      expect(res.method).toBe('tracker');
      expect(res.executed).toBe(true);
      // The tracker owns the dispatch (or the app's declared handler); this
      // arm must not fire a second, hand-built one of its own.
      expect(seen).toHaveLength(0);
    });

    it('routes executeRedo to the tracker redo arm', async () => {
      const executeUndo = vi.fn(() => true);
      const executeRedo = vi.fn(() => true);
      setTracker({ getState: () => ({}), executeUndo, executeRedo });

      const res = (await executeCommand('executeRedo', {}, emptyBridge)) as UndoResult;

      expect(executeRedo).toHaveBeenCalledTimes(1);
      expect(executeUndo).not.toHaveBeenCalled();
      expect(res.method).toBe('tracker');
    });

    it('reports a tracker refusal honestly instead of success:true', async () => {
      // `UndoTracker.executeUndo()` returns false when there is no declared
      // handler AND no document to dispatch into — "nothing was available".
      setTracker({ getState: () => ({}), executeUndo: () => false });

      const res = (await executeCommand('executeUndo', {}, emptyBridge)) as UndoResult;

      expect(res.executed).toBe(false);
      expect(res.success).toBe(false);
    });
  });

  describe('with no tracker registered (keystroke fallback)', () => {
    beforeEach(() => setTracker(null));

    it('carries the legacy keyCode/which, and code, for Ctrl+Z', async () => {
      const seen: KeyboardEvent[] = [];
      field.addEventListener('keydown', (e) => seen.push(e));

      const res = (await executeCommand('executeUndo', {}, emptyBridge)) as UndoResult;

      expect(seen).toHaveLength(1);
      expect(seen[0].key).toBe('z');
      expect(seen[0].code).toBe('KeyZ');
      expect(seen[0].keyCode).toBe(90);
      expect(seen[0].which).toBe(90);
      expect(seen[0].shiftKey).toBe(false);
      expect(seen[0].ctrlKey || seen[0].metaKey).toBe(true);
      expect(res.method).toBe('keyboard');
      expect(res.executed).toBe(true);
    });

    it('adds shift for redo, still carrying keyCode 90', async () => {
      const seen: KeyboardEvent[] = [];
      field.addEventListener('keydown', (e) => seen.push(e));

      await executeCommand('executeRedo', {}, emptyBridge);

      expect(seen).toHaveLength(1);
      expect(seen[0].shiftKey).toBe(true);
      expect(seen[0].keyCode).toBe(90);
      expect(seen[0].ctrlKey || seen[0].metaKey).toBe(true);
    });

    it('dispatches at the focused element, not only at document', async () => {
      // The old arm called `document.dispatchEvent`, which never reaches a
      // listener bound to the focused control unless it also bubbles from it.
      const atField: KeyboardEvent[] = [];
      field.addEventListener('keydown', (e) => atField.push(e));

      await executeCommand('executeUndo', {}, emptyBridge);

      expect(atField).toHaveLength(1);
      expect(atField[0].target).toBe(field);
    });

    it('reports whether an app handler consumed the shortcut', async () => {
      field.addEventListener('keydown', (e) => e.preventDefault());

      const res = (await executeCommand('executeUndo', {}, emptyBridge)) as UndoResult;

      expect(res.defaultPrevented).toBe(true);
      // `executed` means "a trigger was dispatched" — it is NOT
      // `dispatchEvent`'s return, which is false exactly when a handler DID
      // take the shortcut.
      expect(res.executed).toBe(true);
    });
  });

  it('answers with the same `executed` field the in-process handler returns', async () => {
    // `server/types.ts` declares
    // `executeUndo: (context?) => Promise<APIResponse<{ executed: boolean }>>`
    // for BOTH arms of the same route. The relay arm used to return
    // `{ success, method, timestamp }` with no `executed` at all, so a caller
    // reading `data.executed` got a boolean in-process and `undefined` over
    // the relay.
    setTracker({ getState: () => ({}), executeUndo: () => true, executeRedo: () => true });

    for (const action of ['executeUndo', 'executeRedo']) {
      const res = (await executeCommand(action, {}, emptyBridge)) as UndoResult;
      expect(typeof res.executed).toBe('boolean');
    }
  });
});
