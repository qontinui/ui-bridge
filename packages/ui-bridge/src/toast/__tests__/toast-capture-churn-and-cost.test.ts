/**
 * Toast Capture — re-announce churn budget and the mutation re-read gate
 *
 * A: a live region whose text changes often (a timer, a progress count) is
 *    held to a per-element announcement budget (4 per 10 s by default). Over
 *    the budget the element is suppressed: its entry leaves `active`, its
 *    changes are absorbed silently, and once it has been quiet for the window
 *    its settled text is announced once (the trailing announcement).
 * B: a tracked (active or parked) element is re-read through `extractMessage`
 *    (a deep clone) only when its own subtree mutated, or when one of the two
 *    inputs outside the subtree — visibility and the ancestor redaction
 *    boundary — flipped. `cloneNode` on the element counts the re-reads.
 *
 * Plan: 2026-11-23-ui-bridge-toast-capture-churn-and-reread-cost (Phase 1).
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

/** Change the element's text in place (a characterData mutation, as React does). */
function setTextInPlace(el: Element, text: string): void {
  (el.firstChild as Text).data = text;
}

describe('ToastCapture churn budget and re-read gate', () => {
  let capture: ToastCapture;
  let events: ToastEventData[];

  beforeEach(() => {
    vi.useFakeTimers();
    events = [];
  });

  afterEach(() => {
    capture?.uninstall();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function install(config?: ConstructorParameters<typeof ToastCapture>[0]): void {
    capture = new ToastCapture(config);
    capture.install((data) => events.push(data));
  }

  function appearedFor(id: string): ToastEventData[] {
    return events.filter((e) => e.action === 'appeared' && e.toast.id === id);
  }

  /**
   * A `timer` status ticking once per 500 ms poll: `0:00` captured by the
   * scan, then `0:01` … `0:<ticks>` set in place, one poll per tick.
   */
  async function tick(el: Element, from: number, to: number): Promise<void> {
    for (let i = from; i <= to; i++) {
      setTextInPlace(el, `0:${String(i).padStart(2, '0')}`);
      await vi.advanceTimersByTimeAsync(500);
    }
  }

  // ==========================================================================
  // A — churn (follow-up 803da49d)
  // ==========================================================================

  describe('A: announcement budget', () => {
    // A1
    it('a ticker beside a real toast announces 4 times and leaves the real toast in recent', async () => {
      install({ pollInterval: 500 });
      const saved = document.createElement('div');
      saved.setAttribute('data-sonner-toast', '');
      saved.textContent = 'Saved';
      document.body.appendChild(saved);
      await flushAndScan();
      saved.remove();
      await vi.advanceTimersByTimeAsync(500);
      expect(capture.getRecent().some((t) => t.message === 'Saved')).toBe(true);

      const timer = addStatus('timer', '0:00');
      await flushAndScan();
      await tick(timer, 1, 40);

      expect(capture.getRecent().some((t) => t.message === 'Saved')).toBe(true);
      expect(appearedFor('timer')).toHaveLength(4);
    });

    // A2
    it('after the ticker stops and stays quiet for the window, its settled text is announced once', async () => {
      install({ pollInterval: 500 });
      const timer = addStatus('timer', '0:00');
      await flushAndScan();
      await tick(timer, 1, 40);
      expect(appearedFor('timer')).toHaveLength(4);

      await vi.advanceTimersByTimeAsync(10_000);
      await vi.advanceTimersByTimeAsync(500);

      const appeared = appearedFor('timer');
      expect(appeared).toHaveLength(5);
      expect(appeared[4].toast.message).toBe('0:40');
      expect(capture.getActive().map((t) => [t.id, t.message])).toEqual([['timer', '0:40']]);
    });

    // A3
    it('at the budget every change is announced; the change over it is withheld and leaves active', async () => {
      install({ pollInterval: 500, announcementWindowMs: 10_000 });
      const timer = addStatus('timer', 'a0');
      await flushAndScan();
      for (const text of ['a1', 'a2', 'a3']) {
        setTextInPlace(timer, text);
        await vi.advanceTimersByTimeAsync(500);
      }
      expect(appearedFor('timer').map((e) => e.toast.message)).toEqual(['a0', 'a1', 'a2', 'a3']);

      setTextInPlace(timer, 'a4');
      await vi.advanceTimersByTimeAsync(500);

      expect(appearedFor('timer')).toHaveLength(4);
      expect(capture.getActive().filter((t) => t.id === 'timer')).toEqual([]);
    });

    // A4
    it('a toast lifecycle under the budget announces every state', async () => {
      install({ pollInterval: 500 });
      const el = document.createElement('div');
      el.setAttribute('data-sonner-toast', '');
      el.setAttribute('data-testid', 'upload');
      el.appendChild(document.createTextNode('Uploading…'));
      document.body.appendChild(el);
      await flushAndScan();

      setTextInPlace(el, 'Uploaded');
      await vi.advanceTimersByTimeAsync(500);

      expect(events.filter((e) => e.action === 'appeared')).toHaveLength(2);
      expect(events.filter((e) => e.action === 'dismissed')).toHaveLength(1);
      expect(capture.getActive().map((t) => [t.id, t.message])).toEqual([['upload', 'Uploaded']]);
    });

    // A5
    it('a status changing every 15 s is never suppressed', async () => {
      install({ pollInterval: 500 });
      const el = addStatus('slow', 's0');
      await flushAndScan();
      for (let i = 1; i <= 5; i++) {
        await vi.advanceTimersByTimeAsync(15_000);
        setTextInPlace(el, `s${i}`);
        await vi.advanceTimersByTimeAsync(500);
      }

      expect(appearedFor('slow').map((e) => e.toast.message)).toEqual([
        's0',
        's1',
        's2',
        's3',
        's4',
        's5',
      ]);
    });

    // A6
    it('a region that empties and refills each tick is throttled like a ticker', async () => {
      install({ pollInterval: 500 });
      const el = addStatus('blink', 'v0');
      await flushAndScan();
      for (let i = 1; i <= 20; i++) {
        setTextInPlace(el, '');
        await vi.advanceTimersByTimeAsync(500);
        setTextInPlace(el, `v${i}`);
        await vi.advanceTimersByTimeAsync(500);
      }

      expect(appearedFor('blink')).toHaveLength(4);
    });

    // A7
    it('the budget applies to public reads with no poll in between', async () => {
      install({ pollInterval: 60_000 });
      const el = addStatus('timer', 'r0');
      await flushAndScan();
      for (let i = 1; i <= 20; i++) {
        setTextInPlace(el, `r${i}`);
        vi.advanceTimersByTime(100);
        capture.getSnapshot();
      }

      expect(appearedFor('timer')).toHaveLength(4);
    });

    // A8
    it('a childList change inside a suppressed element does not bypass suppression through the scan', async () => {
      install({ pollInterval: 500 });
      const timer = addStatus('timer', '0:00');
      await flushAndScan();
      await tick(timer, 1, 6);
      const before = appearedFor('timer').length;

      // No poll falls inside the scan's 50 ms, so the one re-read below is the
      // scan handing the parked element to the parked-reconcile step.
      const clone = vi.spyOn(timer, 'cloneNode');
      timer.replaceChild(document.createTextNode('swapped'), timer.firstChild as Node);
      await flushAndScan();

      expect(appearedFor('timer')).toHaveLength(before);
      expect(clone).toHaveBeenCalledTimes(1);
    });

    // A9
    it('a remounted node with the same data-testid starts with a fresh budget', async () => {
      install({ pollInterval: 500 });
      const timer = addStatus('timer', '0:00');
      await flushAndScan();
      await tick(timer, 1, 6);

      timer.remove();
      addStatus('timer', 'fresh');
      await flushAndScan();

      expect(appearedFor('timer').some((e) => e.toast.message === 'fresh')).toBe(true);
      expect(capture.getActive().map((t) => [t.id, t.message])).toEqual([['timer', 'fresh']]);
    });
  });

  // ==========================================================================
  // B — re-read cost (follow-up 62e5f6f0)
  // ==========================================================================

  describe('B: re-read gate', () => {
    // B1
    it('a max-age-parked unchanged element is not cloned by polls or reads', async () => {
      install({ pollInterval: 500, maxToastAgeMs: 1_000 });
      const el = addStatus('bar', 'Connected');
      await flushAndScan();
      await vi.advanceTimersByTimeAsync(2_000);
      expect(capture.getActive()).toHaveLength(0); // parked by max-age

      const clone = vi.spyOn(el, 'cloneNode');
      await vi.advanceTimersByTimeAsync(10_000); // 20 polls
      for (let i = 0; i < 5; i++) capture.getSnapshot();

      expect(clone).toHaveBeenCalledTimes(0);
    });

    // B2
    it('an active unchanged element is not cloned by polls or reads', async () => {
      install({ pollInterval: 500 });
      const el = addStatus('bar', 'Connected');
      await flushAndScan();

      const clone = vi.spyOn(el, 'cloneNode');
      await vi.advanceTimersByTimeAsync(5_000); // 10 polls
      for (let i = 0; i < 5; i++) capture.getSnapshot();

      expect(clone).toHaveBeenCalledTimes(0);
      expect(capture.getActive().map((t) => t.message)).toEqual(['Connected']);
    });

    // B3
    it('a read in the same tick as an in-place change sees the change, with exactly one clone', async () => {
      install({ pollInterval: 500, maxToastAgeMs: 1_000 });
      const el = addStatus('bar', 'Connected');
      await flushAndScan();
      await vi.advanceTimersByTimeAsync(2_000);
      expect(capture.getActive()).toHaveLength(0); // parked by max-age
      await vi.advanceTimersByTimeAsync(10_000);

      const clone = vi.spyOn(el, 'cloneNode');
      setTextInPlace(el, 'new');
      const active = capture.getActive();

      expect(active.map((t) => [t.id, t.message])).toEqual([['bar', 'new']]);
      expect(clone).toHaveBeenCalledTimes(1);
    });

    // B4
    it('a redaction boundary added inside the element is honored with no text change', async () => {
      install({ pollInterval: 500 });
      const el = document.createElement('div');
      el.setAttribute('role', 'status');
      el.setAttribute('data-testid', 'otp');
      el.innerHTML = 'Code <span>123456</span>';
      document.body.appendChild(el);
      await flushAndScan();
      expect(capture.getActive().map((t) => t.message)).toEqual(['Code 123456']);

      (el.querySelector('span') as HTMLElement).setAttribute('data-bridge-redact', 'true');
      const messages = capture.getActive().map((t) => t.message);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain(REDACTED_VALUE);
      expect(messages[0]).not.toContain('123456');
    });

    // B5
    it('a redaction boundary added on an ancestor is honored', async () => {
      install({ pollInterval: 500 });
      const parent = document.createElement('div');
      document.body.appendChild(parent);
      addStatus('otp', 'Code 123456', parent);
      await flushAndScan();
      expect(capture.getActive().map((t) => t.message)).toEqual(['Code 123456']);

      parent.setAttribute('data-bridge-redact', 'true');

      expect(capture.getActive().map((t) => t.message)).toEqual([REDACTED_VALUE]);
    });

    // B6
    it('unrelated childList mutations do not clone a parked unchanged element through the scan', async () => {
      install({ pollInterval: 500, maxToastAgeMs: 1_000 });
      const el = addStatus('bar', 'Connected');
      await flushAndScan();
      await vi.advanceTimersByTimeAsync(2_000);
      expect(capture.getActive()).toHaveLength(0); // parked by max-age

      const clone = vi.spyOn(el, 'cloneNode');
      for (let i = 0; i < 10; i++) {
        document.body.appendChild(document.createElement('span'));
        await flushAndScan();
      }

      expect(clone).toHaveBeenCalledTimes(0);
    });

    // B7
    it('every per-element observer is disconnected when its element disconnects or at uninstall', async () => {
      install({ pollInterval: 500, maxToastAgeMs: 1_000 });
      const parkedGone = addStatus('parked-gone', 'P1');
      addStatus('parked-kept', 'P2');
      await flushAndScan();
      await vi.advanceTimersByTimeAsync(2_000);
      expect(capture.getActive()).toHaveLength(0); // both parked by max-age
      const activeGone = addStatus('active-gone', 'A1');
      addStatus('active-kept', 'A2');
      await flushAndScan();
      expect(
        capture
          .getActive()
          .map((t) => t.id)
          .sort()
      ).toEqual(['active-gone', 'active-kept']);

      const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
      parkedGone.remove();
      activeGone.remove();
      await vi.advanceTimersByTimeAsync(500);
      expect(disconnect).toHaveBeenCalledTimes(2);

      capture.uninstall();
      // Two still-tracked elements plus the document observer.
      expect(disconnect.mock.calls.length - 2).toBe(3);
    });

    // B8
    it('a parked element whose ancestor is hidden and shown again is announced again', async () => {
      install({ pollInterval: 500, maxToastAgeMs: 1_000 });
      const parent = document.createElement('div');
      document.body.appendChild(parent);
      addStatus('bar', 'Connected', parent);
      await flushAndScan();
      await vi.advanceTimersByTimeAsync(2_000);
      expect(capture.getActive()).toHaveLength(0); // parked by max-age

      parent.style.visibility = 'hidden';
      await vi.advanceTimersByTimeAsync(500);
      parent.style.visibility = '';
      await vi.advanceTimersByTimeAsync(500);

      expect(appearedFor('bar').map((e) => e.toast.message)).toEqual(['Connected', 'Connected']);
      expect(capture.getActive().map((t) => [t.id, t.message])).toEqual([['bar', 'Connected']]);
    });

    // B9
    it('an ancestor redaction boundary removed serves the real text again', async () => {
      install({ pollInterval: 500 });
      const parent = document.createElement('div');
      parent.setAttribute('data-bridge-redact', 'true');
      document.body.appendChild(parent);
      addStatus('otp', 'Code 123456', parent);
      await flushAndScan();
      expect(capture.getActive().map((t) => t.message)).toEqual([REDACTED_VALUE]);

      parent.removeAttribute('data-bridge-redact');

      expect(capture.getActive().map((t) => t.message)).toEqual(['Code 123456']);
    });
  });

  // ==========================================================================
  // Review round 1
  // ==========================================================================

  describe('review round 1', () => {
    // R1 (A1)
    it('a scan debounced before uninstall does not run, attach an observer or capture after it', async () => {
      install({ pollInterval: 500 });
      addStatus('late', 'Late');
      await Promise.resolve(); // the document observer's callback queues the scan
      capture.uninstall();

      const observe = vi.spyOn(MutationObserver.prototype, 'observe');
      await flushAndScan();
      await vi.advanceTimersByTimeAsync(1_000);

      expect(observe).toHaveBeenCalledTimes(0);
      expect(capture.getActive()).toEqual([]);
      expect(events).toEqual([]);
    });

    // R2 (A2)
    it('a region that flaps and settles on its last announced text is announced again on release', async () => {
      install({ pollInterval: 500 });
      const el = addStatus('net', 'Online');
      await flushAndScan();
      for (const text of ['Offline', 'Online', 'Offline', 'Online', 'Offline']) {
        setTextInPlace(el, text);
        await vi.advanceTimersByTimeAsync(500);
      }
      expect(appearedFor('net').map((e) => e.toast.message)).toEqual([
        'Online',
        'Offline',
        'Online',
        'Offline',
      ]);
      expect(capture.getActive()).toEqual([]); // suppressed

      await vi.advanceTimersByTimeAsync(10_000);
      await vi.advanceTimersByTimeAsync(500);

      expect(appearedFor('net')).toHaveLength(5);
      expect(capture.getActive().map((t) => [t.id, t.message])).toEqual([['net', 'Offline']]);
    });

    // R3 (A3)
    it('a budget below 1 is clamped to 1 and a window below 1 ms falls back to the default', async () => {
      install({ pollInterval: 500, maxAnnouncementsPerWindow: 0 });
      const one = addStatus('one', 'First');
      await flushAndScan();
      expect(capture.getActive().map((t) => [t.id, t.message])).toEqual([['one', 'First']]);
      // Clamped to exactly 1 (not the default 4): further changes are withheld.
      await tick(one, 1, 3);
      expect(appearedFor('one')).toHaveLength(1);
      capture.uninstall();
      document.body.innerHTML = '';
      events = [];

      // A fraction floors (1.9 -> 1); a non-finite value means the default 4.
      install({ pollInterval: 500, maxAnnouncementsPerWindow: 1.9 });
      const frac = addStatus('frac', '0:00');
      await flushAndScan();
      await tick(frac, 1, 3);
      expect(appearedFor('frac')).toHaveLength(1);
      capture.uninstall();
      document.body.innerHTML = '';
      events = [];

      install({ pollInterval: 500, maxAnnouncementsPerWindow: Infinity });
      const inf = addStatus('inf', '0:00');
      await flushAndScan();
      await tick(inf, 1, 10);
      expect(appearedFor('inf')).toHaveLength(4);
      capture.uninstall();
      document.body.innerHTML = '';
      events = [];

      install({ pollInterval: 500, announcementWindowMs: 0 });
      const timer = addStatus('timer', '0:00');
      await flushAndScan();
      await tick(timer, 1, 10);
      expect(appearedFor('timer')).toHaveLength(4);
    });

    // R5 (A5)
    it('an attribute no re-read depends on does not clone a tracked element', async () => {
      install({ pollInterval: 500 });
      const el = document.createElement('div');
      el.setAttribute('role', 'status');
      el.setAttribute('data-testid', 'bar');
      el.innerHTML = 'Build <b>green</b>';
      document.body.appendChild(el);
      await flushAndScan();
      expect(capture.getActive().map((t) => t.message)).toEqual(['Build green']);

      const clone = vi.spyOn(el, 'cloneNode');
      for (let i = 0; i < 5; i++) {
        el.setAttribute('data-foo', String(i));
        el.className = `pulse-${i}`;
        (el.querySelector('b') as HTMLElement).className = `tone-${i}`;
        await vi.advanceTimersByTimeAsync(500);
        capture.getSnapshot();
      }

      expect(clone).toHaveBeenCalledTimes(0);
      expect(capture.getActive().map((t) => t.message)).toEqual(['Build green']);
    });
  });

  // ==========================================================================
  // Review round 2 — each attribute in the per-element attributeFilter, and
  // the debounced-scan handle across uninstall → install
  // ==========================================================================

  describe('review round 2', () => {
    /** Capture `<div role="status" data-testid="x">` holding `html`; returns it. */
    async function captureHtml(html: string): Promise<HTMLElement> {
      install({ pollInterval: 500 });
      const el = document.createElement('div');
      el.setAttribute('role', 'status');
      el.setAttribute('data-testid', 'x');
      el.innerHTML = html;
      document.body.appendChild(el);
      await flushAndScan();
      return el;
    }

    // R6
    it('`hidden` set on a descendant drops its text from the message', async () => {
      const el = await captureHtml('Saved <span>just now</span>');
      expect(capture.getActive().map((t) => t.message)).toEqual(['Saved just now']);

      (el.querySelector('span') as HTMLElement).setAttribute('hidden', '');

      expect(capture.getActive().map((t) => t.message)).toEqual(['Saved']);
    });

    // R7
    it('inline display:none on a descendant drops its text from the message', async () => {
      const el = await captureHtml('Saved <span>just now</span>');
      expect(capture.getActive().map((t) => t.message)).toEqual(['Saved just now']);

      (el.querySelector('span') as HTMLElement).style.display = 'none';

      expect(capture.getActive().map((t) => t.message)).toEqual(['Saved']);
    });

    // R8
    it('aria-label="close" set on a button strips the button from the message', async () => {
      const el = await captureHtml('Upload failed <button>Retry</button>');
      expect(capture.getActive().map((t) => t.message)).toEqual(['Upload failed Retry']);

      (el.querySelector('button') as HTMLElement).setAttribute('aria-label', 'close');

      expect(capture.getActive().map((t) => t.message)).toEqual(['Upload failed']);
    });

    // R9
    it('role="button" set on a close-glyph span strips it from the message', async () => {
      const el = await captureHtml('Saved <span>\u00d7</span>');
      expect(capture.getActive().map((t) => t.message)).toEqual(['Saved \u00d7']);

      (el.querySelector('span') as HTMLElement).setAttribute('role', 'button');

      expect(capture.getActive().map((t) => t.message)).toEqual(['Saved']);
    });

    // R10
    it('a scan debounced before uninstall does not run under the next install', async () => {
      install({ pollInterval: 500 });
      addStatus('late', 'Late');
      await Promise.resolve(); // the document observer's callback queues the scan
      capture.uninstall();

      const query = vi.spyOn(document, 'querySelectorAll');
      capture.install((data) => events.push(data));
      await flushAndScan();

      // One scan: the install's own initial scan, not also the stale one.
      expect(query).toHaveBeenCalledTimes(1);
      expect(appearedFor('late')).toHaveLength(1);
      expect(capture.getActive().map((t) => [t.id, t.message])).toEqual([['late', 'Late']]);
    });
  });
});
