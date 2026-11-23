/**
 * Toast Capture — live-region text is live state
 *
 * A `role="status"` live region announces by changing its text in place.
 * These tests pin that `ToastCapture` re-reads a captured element's text on
 * the poll AND at read time, treats a changed text as a new announcement
 * (dismiss the old entry into `recent`, capture a new one), re-captures an
 * element dismissed by age or emptied text once its text changes, and keeps
 * one id per element in `active`.
 *
 * Plan: 2026-11-23-ui-bridge-toast-capture-rereads-live-region-text (Phase 1).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ToastCapture } from '../toast-capture';
import type { ToastEventData } from '../types';
import { REDACTED_VALUE } from '../../core/redaction';

/**
 * Flush pending microtasks (MutationObserver callbacks) and advance fake
 * timers past the debounced scan. Same shape as `toast-capture.test.ts`.
 */
async function flushAndScan(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(50);
}

/** Append a `role="status"` element carrying `data-testid` and one text node. */
function addStatus(testid: string, text: string, parent: Element = document.body): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('role', 'status');
  el.setAttribute('data-testid', testid);
  el.appendChild(document.createTextNode(text));
  parent.appendChild(el);
  return el;
}

/**
 * Change the element's text the way React does for an in-place update: mutate
 * the existing text node's `data` (a characterData mutation, which the
 * capture's childList observer does not see).
 */
function setTextInPlace(el: Element, text: string): void {
  (el.firstChild as Text).data = text;
}

describe('ToastCapture live-region text', () => {
  let capture: ToastCapture;
  let events: ToastEventData[];

  beforeEach(() => {
    vi.useFakeTimers();
    events = [];
  });

  afterEach(() => {
    capture?.uninstall();
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  function install(config?: ConstructorParameters<typeof ToastCapture>[0]): void {
    capture = new ToastCapture(config);
    capture.install((data) => events.push(data));
  }

  // 1
  it('serves the current text when the text changes in place and is read before the next poll', async () => {
    install();
    const el = addStatus('health', 'No sessions match this filter');
    await flushAndScan();
    expect(capture.getActive().map((t) => t.message)).toEqual(['No sessions match this filter']);

    setTextInPlace(el, '38 sessions');
    const ctx = capture.getSnapshotToastContext();

    expect(ctx.active).toHaveLength(1);
    expect(ctx.active[0].id).toBe('health');
    expect(ctx.active[0].message).toBe('38 sessions');
    expect(ctx.recent[0].message).toBe('No sessions match this filter');
    expect(ctx.recent[0].dismissedAt).toBeDefined();
    expect(capture.getRecent()[0].message).toBe('No sessions match this filter');
  });

  // 2
  it('re-reads on the poll and emits dismissed (old text) then appeared (new text)', async () => {
    install({ pollInterval: 500 });
    const el = addStatus('health', 'No sessions match this filter');
    await flushAndScan();

    setTextInPlace(el, '38 sessions');
    await vi.advanceTimersByTimeAsync(500);

    expect(events.map((e) => [e.action, e.toast.message])).toEqual([
      ['appeared', 'No sessions match this filter'],
      ['dismissed', 'No sessions match this filter'],
      ['appeared', '38 sessions'],
    ]);

    const ctx = capture.getSnapshotToastContext();
    expect(ctx.active).toHaveLength(1);
    expect(ctx.active[0].id).toBe('health');
    expect(ctx.active[0].message).toBe('38 sessions');
    expect(ctx.recent[0].message).toBe('No sessions match this filter');
    expect(ctx.recent[0].dismissedAt).toBeDefined();
  });

  // 3
  it('does not re-announce an unchanged text across many polls', async () => {
    install({ pollInterval: 500 });
    addStatus('health', 'Steady text');
    await flushAndScan();

    await vi.advanceTimersByTimeAsync(5_000);
    capture.getSnapshot();
    capture.getActive();

    expect(events.map((e) => e.action)).toEqual(['appeared']);
    expect(capture.getSnapshot().totalCaptured).toBe(1);
    expect(capture.getActive().map((t) => t.message)).toEqual(['Steady text']);
  });

  // 4
  it('records each of two successive text changes as its own announcement', async () => {
    install({ pollInterval: 500 });
    const el = addStatus('health', 'Text A');
    await flushAndScan();

    setTextInPlace(el, 'Text B');
    await vi.advanceTimersByTimeAsync(500);
    setTextInPlace(el, 'Text C');
    await vi.advanceTimersByTimeAsync(500);

    const snap = capture.getSnapshot();
    expect(snap.active.map((t) => t.message)).toEqual(['Text C']);
    expect(snap.recent.map((t) => t.message)).toEqual(['Text B', 'Text A']);
    expect(snap.totalCaptured).toBe(3);
  });

  // 5
  it('dismisses on emptied text and captures again when the text returns', async () => {
    install({ pollInterval: 500 });
    const el = addStatus('health', 'Loading 3 rows');
    await flushAndScan();

    setTextInPlace(el, '');
    await vi.advanceTimersByTimeAsync(500);
    expect(capture.getActive()).toHaveLength(0);
    expect(capture.getRecent().map((t) => t.message)).toEqual(['Loading 3 rows']);

    setTextInPlace(el, 'Loaded 3 rows');
    await vi.advanceTimersByTimeAsync(500);
    expect(capture.getActive().map((t) => t.message)).toEqual(['Loaded 3 rows']);
    expect(capture.getSnapshot().totalCaptured).toBe(2);
  });

  // 6
  it('captures again after a max-age dismissal only once the text changes', async () => {
    install({ pollInterval: 500, maxToastAgeMs: 1_000 });
    const el = addStatus('health', 'Persistent headline');
    await flushAndScan();
    const firstAppearedAt = capture.getActive()[0].appearedAt;

    await vi.advanceTimersByTimeAsync(1_500);
    expect(capture.getActive()).toHaveLength(0);
    expect(capture.getRecent()[0].message).toBe('Persistent headline');

    // Unchanged text: several more polls, and a childList mutation elsewhere
    // that schedules a scan — still not recaptured.
    await vi.advanceTimersByTimeAsync(2_000);
    document.body.appendChild(document.createElement('span'));
    await flushAndScan();
    expect(capture.getActive()).toHaveLength(0);
    expect(capture.getSnapshot().totalCaptured).toBe(1);

    setTextInPlace(el, 'New headline');
    await vi.advanceTimersByTimeAsync(500);
    const active = capture.getActive();
    expect(active.map((t) => t.message)).toEqual(['New headline']);
    expect(active[0].appearedAt).toBeGreaterThan(firstAppearedAt);
    expect(capture.getSnapshot().totalCaptured).toBe(2);
  });

  // 7
  it('applies the max-age guard at read time when the poll has not run', async () => {
    install({ pollInterval: 500, maxToastAgeMs: 1_000 });
    addStatus('health', 'Backgrounded tab text');
    await flushAndScan();
    expect(capture.getActive()).toHaveLength(1);

    // Move the clock past max-age WITHOUT firing the interval (throttled tab).
    vi.setSystemTime(Date.now() + 1_001);

    const snap = capture.getSnapshot();
    expect(snap.active).toHaveLength(0);
    expect(snap.recent.map((t) => t.message)).toEqual(['Backgrounded tab text']);
  });

  // 8
  it('applies visibility at read time when the poll has not run', async () => {
    install({ pollInterval: 500 });
    const el = addStatus('health', 'About to hide');
    await flushAndScan();
    expect(capture.getActive()).toHaveLength(1);

    el.style.display = 'none';

    const snap = capture.getSnapshot();
    expect(snap.active).toHaveLength(0);
    expect(snap.recent.map((t) => t.message)).toEqual(['About to hide']);
  });

  // 9
  it('a remounted element with the same data-testid dismisses the old entry; two visible ones get health#2', async () => {
    install({ pollInterval: 500 });
    const oldEl = addStatus('health', 'Old node text');
    await flushAndScan();

    // Remount: old removed and new appended in one tick; the scan runs before
    // the poll (flushAndScan advances 50ms, under the 500ms interval).
    oldEl.remove();
    addStatus('health', 'New node text');
    await flushAndScan();

    let snap = capture.getSnapshot();
    expect(snap.active.map((t) => [t.id, t.message])).toEqual([['health', 'New node text']]);
    expect(snap.recent.map((t) => [t.id, t.message])).toEqual([['health', 'Old node text']]);

    // A second visible element on the same testid gets a suffixed id.
    addStatus('health', 'Sibling node text');
    await flushAndScan();

    snap = capture.getSnapshot();
    const byId = Object.fromEntries(snap.active.map((t) => [t.id, t.message]));
    expect(byId).toEqual({ health: 'New node text', 'health#2': 'Sibling node text' });
  });

  // 10
  it('a re-read inside a redaction boundary stays the sentinel and announces nothing new', async () => {
    install({ pollInterval: 500 });
    const wrap = document.createElement('div');
    wrap.setAttribute('data-bridge-redact', 'true');
    document.body.appendChild(wrap);
    const el = addStatus('secret-status', 'Token sk-LIVE-777 issued', wrap);
    await flushAndScan();
    expect(capture.getActive().map((t) => t.message)).toEqual([REDACTED_VALUE]);

    setTextInPlace(el, 'Token sk-LIVE-888 issued');
    await vi.advanceTimersByTimeAsync(500);
    const snap = capture.getSnapshot();

    expect(snap.active.map((t) => t.message)).toEqual([REDACTED_VALUE]);
    expect(events.map((e) => e.action)).toEqual(['appeared']);
    expect(JSON.stringify(snap)).not.toContain('sk-LIVE');
  });

  // 11
  it('a parked element whose text changes is captured exactly once by scan then poll', async () => {
    install({ pollInterval: 500, maxToastAgeMs: 1_000 });
    const el = addStatus('health', 'Parked text');
    await flushAndScan();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(capture.getActive()).toHaveLength(0);
    const eventsBefore = events.length;

    // textContent replaces the text node: a childList mutation, so a scan runs.
    el.textContent = 'Fresh text';
    await flushAndScan();
    await vi.advanceTimersByTimeAsync(500);

    const appeared = events.slice(eventsBefore).filter((e) => e.action === 'appeared');
    expect(appeared.map((e) => [e.toast.id, e.toast.message])).toEqual([['health', 'Fresh text']]);
    expect(capture.getSnapshot().totalCaptured).toBe(2);
    expect(capture.getActive().map((t) => t.id)).toEqual(['health']);
  });
});
