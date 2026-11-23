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

  // 12
  it('a read made by a synchronous listener during a scan does not capture one element twice', async () => {
    capture = new ToastCapture({ pollInterval: 500, maxToastAgeMs: 1_000 });
    let reading = false;
    capture.install((data) => {
      events.push(data);
      // A host listener that reads the snapshot inside the event, as a
      // registry `onEvent` hook may.
      if (data.action === 'appeared' && !reading) {
        reading = true;
        capture.getSnapshot();
        reading = false;
      }
    });
    const a = addStatus('a', 'A1');
    await flushAndScan();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(capture.getActive()).toHaveLength(0); // A is parked by max-age
    const eventsBefore = events.length;

    // A's text changes in place (no scan), then B is inserted BEFORE A (a
    // scan). The scan captures B first; B's listener reads, which reconciles
    // and captures A; the scan must then skip A.
    setTextInPlace(a, 'A2');
    const b = document.createElement('div');
    b.setAttribute('role', 'status');
    b.setAttribute('data-testid', 'b');
    b.textContent = 'B1';
    document.body.insertBefore(b, a);
    await flushAndScan();

    const appeared = events.slice(eventsBefore).filter((e) => e.action === 'appeared');
    expect(appeared.map((e) => e.toast.id).sort()).toEqual(['a', 'b']);
    expect(
      capture
        .getActive()
        .map((t) => t.id)
        .sort()
    ).toEqual(['a', 'b']);
  });

  // 13
  it('an element hidden and shown again is a new announcement, whatever its text', async () => {
    install({ pollInterval: 500 });
    const el = addStatus('saved', 'Saved');
    await flushAndScan();
    expect(capture.getActive().map((t) => t.message)).toEqual(['Saved']);

    el.style.display = 'none';
    expect(capture.getActive()).toHaveLength(0);

    el.style.display = '';
    const active = capture.getActive();
    expect(active.map((t) => [t.id, t.message])).toEqual([['saved', 'Saved']]);
    expect(capture.getSnapshot().totalCaptured).toBe(2);
    expect(events.map((e) => e.action)).toEqual(['appeared', 'dismissed', 'appeared']);
  });

  // 14
  it('an element parked by max-age, hidden and shown again with the same text, is a new announcement', async () => {
    install({ pollInterval: 500, maxToastAgeMs: 1_000 });
    const el = addStatus('status', 'Idle');
    await flushAndScan();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(capture.getActive()).toHaveLength(0); // parked by max-age

    el.style.display = 'none';
    await vi.advanceTimersByTimeAsync(500);
    el.style.display = '';
    await vi.advanceTimersByTimeAsync(500);

    expect(capture.getActive().map((t) => [t.id, t.message])).toEqual([['status', 'Idle']]);
    expect(capture.getSnapshot().totalCaptured).toBe(2);
  });

  // 15
  it('reads after uninstall leave the captured state as it was', async () => {
    install();
    const el = addStatus('health', 'One');
    await flushAndScan();
    capture.uninstall();

    setTextInPlace(el, 'Two');
    const snap = capture.getSnapshot();

    expect(snap.totalCaptured).toBe(1);
    expect(snap.active.map((t) => t.message)).toEqual(['One']);
    expect(capture.getActive().map((t) => t.message)).toEqual(['One']);
    expect(capture.getRecent()).toHaveLength(0);
  });

  // 16
  it('a childList text change on an active element is captured exactly once by scan plus poll', async () => {
    install({ pollInterval: 500 });
    const el = addStatus('health', 'No sessions match this filter');
    await flushAndScan();

    el.textContent = '38 sessions'; // replaces the text node: a scan runs too
    await flushAndScan();
    await vi.advanceTimersByTimeAsync(500);

    expect(capture.getSnapshot().totalCaptured).toBe(2);
    expect(capture.getActive().map((t) => [t.id, t.message])).toEqual([['health', '38 sessions']]);
    expect(events.map((e) => e.action)).toEqual(['appeared', 'dismissed', 'appeared']);
  });

  // 17
  it('an element parked by max-age, emptied and refilled with the same text, is a new announcement', async () => {
    install({ pollInterval: 500, maxToastAgeMs: 1_000 });
    const el = addStatus('saved', 'Saved');
    await flushAndScan();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(capture.getActive()).toHaveLength(0); // parked by max-age

    setTextInPlace(el, '');
    await vi.advanceTimersByTimeAsync(500);
    setTextInPlace(el, 'Saved');
    await vi.advanceTimersByTimeAsync(500);

    expect(capture.getActive().map((t) => [t.id, t.message])).toEqual([['saved', 'Saved']]);
    expect(capture.getSnapshot().totalCaptured).toBe(2);
  });

  // 18
  it('a listener that reads during an id collision neither drops nor duplicates an announcement', async () => {
    capture = new ToastCapture({ pollInterval: 500 });
    let reading = false;
    capture.install((data) => {
      events.push(data);
      if (!reading) {
        reading = true;
        capture.getSnapshot();
        reading = false;
      }
    });
    const e1 = addStatus('x', 'one');
    const e2 = addStatus('x', 'two');
    await flushAndScan();
    expect(
      capture
        .getActive()
        .map((t) => t.id)
        .sort()
    ).toEqual(['x', 'x#2']);

    // E2 is emptied (dismissed and parked with ''), then refilled in place.
    setTextInPlace(e2, '');
    await vi.advanceTimersByTimeAsync(500);
    setTextInPlace(e2, 'two again');
    // E1 is hidden, and E3 is inserted before E2: the scan meets E3 first,
    // whose id collision dismisses E1 (a 'dismissed' event, whose listener
    // reads) before E3 is inserted.
    e1.style.display = 'none';
    const e3 = document.createElement('div');
    e3.setAttribute('role', 'status');
    e3.setAttribute('data-testid', 'x');
    e3.textContent = 'three';
    document.body.insertBefore(e3, e2);
    await flushAndScan();

    const appeared = events.filter((e) => e.action === 'appeared').map((e) => e.toast.message);
    expect(appeared.sort()).toEqual(['one', 'three', 'two', 'two again']);
    expect(capture.getSnapshot().totalCaptured).toBe(4);
    expect(
      capture
        .getActive()
        .map((t) => t.message)
        .sort()
    ).toEqual(['three', 'two again']);
  });
});
