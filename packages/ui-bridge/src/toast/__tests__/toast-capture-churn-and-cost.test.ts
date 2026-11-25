/**
 * Toast Capture — re-announce churn budget and the mutation re-read gate
 *
 * A: a live region whose text changes often (a timer, a progress count) is
 *    held to a per-element announcement budget (4 per 10 s by default). Over
 *    the budget the element is suppressed: its entry leaves `active`, its
 *    changes are absorbed silently, and once it has been quiet for the window
 *    its settled text is announced once (the trailing announcement). A
 *    re-keyed node (a new node on the same `id` / `data-testid`, first seen
 *    by the scan in the same mutation batch in which the node it replaces
 *    left) continues that node's budget while it is warm; any other node —
 *    a sibling, a node already present, one arriving in a later batch — has
 *    its own.
 * B: a tracked (active or parked) element is re-read through `extractMessage`
 *    (a deep clone) only when its own subtree mutated, or when one of the two
 *    inputs outside the subtree — visibility and the ancestor redaction
 *    boundary — flipped. `cloneNode` on the element counts the re-reads.
 * C: a visible element with no text is parked with `''`, so it is cloned only
 *    when its own subtree mutates, and an in-place fill reaches the poll. A
 *    hidden one is parked with `''` too (C5; section H).
 * H: a toast element the scan first sees hidden (own `opacity` / `display` /
 *    `visibility`, or an ancestor's `visibility`) is parked with `''` and
 *    tracked by its own observer, so a reveal by style alone — which no
 *    `childList` record announces — is captured by the next poll or read. It
 *    is not cloned while hidden; a re-keyed replacement mounted hidden keeps
 *    the re-key budget it inherited at its first sighting.
 *
 * Plans: 2026-11-23-ui-bridge-toast-capture-churn-and-reread-cost (Phase 1);
 * 2026-11-24-ui-bridge-toast-capture-rekey-churn-and-empty-element-parking
 * (Phase 1: A9a, A9b, A10-A15, C1-C5; A9c; review round 1: A9d, A16, A17,
 * C4 and C5 strengthened; review round 2: A18-A23);
 * 2026-11-25-ui-bridge-toast-capture-tracks-hidden-matches-until-shown
 * (Phase 1: H1-H11, H3b; C5 amended).
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

/** Replace `prev` with a new `timer` node holding `text` (a React `key={count}` re-key). */
function rekey(prev: Element, text: string): HTMLElement {
  prev.remove();
  return addStatus('timer', text);
}

/** Append an EMPTY `role="status"` element (no child node) carrying `data-testid`. */
function addEmptyStatus(testid: string): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('role', 'status');
  el.setAttribute('data-testid', testid);
  document.body.appendChild(el);
  return el;
}

/** Append a `role="status"` element with neither `id` nor `data-testid`. */
function addAnonymousStatus(text: string): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('role', 'status');
  el.appendChild(document.createTextNode(text));
  document.body.appendChild(el);
  return el;
}

/**
 * A `timer` ticker re-keyed once per tick: `0:00` captured by the scan, then
 * `0:01` … `0:<ticks>` each on a NEW node, one scan and one poll per tick.
 * Returns the last node.
 */
async function rekeyTicker(ticks: number): Promise<HTMLElement> {
  let node = addStatus('timer', '0:00');
  await flushAndScan();
  for (let i = 1; i <= ticks; i++) {
    node = rekey(node, `0:${String(i).padStart(2, '0')}`);
    await flushAndScan();
    await vi.advanceTimersByTimeAsync(450);
  }
  return node;
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

    // A9a
    it('a one-off remount under the budget is announced at once', async () => {
      install({ pollInterval: 500 });
      const timer = addStatus('timer', 'one');
      await flushAndScan();

      rekey(timer, 'two');
      await flushAndScan();

      expect(appearedFor('timer').map((e) => e.toast.message)).toEqual(['one', 'two']);
      expect(capture.getActive().map((t) => [t.id, t.message])).toEqual([['timer', 'two']]);
    });

    // A9b
    it('a remount of a churning element inherits its suppression; a remount after quiet starts fresh', async () => {
      install({ pollInterval: 500 });
      const timer = addStatus('timer', '0:00');
      await flushAndScan();
      await tick(timer, 1, 6); // suppressed
      expect(appearedFor('timer')).toHaveLength(4);

      const fresh = rekey(timer, 'fresh');
      await flushAndScan();
      expect(appearedFor('timer').some((e) => e.toast.message === 'fresh')).toBe(false);

      await vi.advanceTimersByTimeAsync(10_000);
      await vi.advanceTimersByTimeAsync(500);
      expect(appearedFor('timer')).toHaveLength(5);
      expect(appearedFor('timer')[4].toast.message).toBe('fresh');

      // Back into suppression inside one window, then removed with no
      // replacement while still suppressed. The removal's own scan runs
      // before `later` mounts, so the same-batch rule (not the budget going
      // cold) is what makes `later` start fresh; A9d pins the warmth term.
      await tick(fresh, 1, 6);
      expect(appearedFor('timer')).toHaveLength(8);
      fresh.remove();
      await vi.advanceTimersByTimeAsync(10_500);

      addStatus('timer', 'later');
      await flushAndScan();

      expect(appearedFor('timer').at(-1)?.toast.message).toBe('later');
      expect(capture.getActive().map((t) => [t.id, t.message])).toEqual([['timer', 'later']]);
    });

    // A9c — A9b's quiet-start step with no reconcile between the removal and
    // the remount, so no prune can drop the budget first. The removal's own
    // debounced scan still runs before the remount, and by the remount the
    // budget is also cold, so both the same-batch rule and warmth refuse here: this
    // pins only their conjunction. A16 isolates the same-batch rule and A9d
    // the warmth term.
    it('a remount after quiet starts fresh even when no reconcile ran in between', async () => {
      install({ pollInterval: 60_000 });
      const timer = addStatus('timer', 'r0');
      await flushAndScan();
      for (let i = 1; i <= 6; i++) {
        setTextInPlace(timer, `r${i}`);
        vi.advanceTimersByTime(100);
        capture.getSnapshot();
      }
      expect(appearedFor('timer')).toHaveLength(4); // suppressed

      timer.remove();
      await vi.advanceTimersByTimeAsync(10_500);
      addStatus('timer', 'later');
      await flushAndScan();

      expect(appearedFor('timer').at(-1)?.toast.message).toBe('later');
    });

    // A9d — the re-key happens in ONE batch, so only warmth can refuse the
    // inheritance: a suppressed budget gone cold with no reconcile to release
    // it is not inherited.
    it('a same-batch re-key of a cold suppressed budget starts fresh', async () => {
      install({ pollInterval: 60_000 });
      const timer = addStatus('timer', 'r0');
      await flushAndScan();
      for (let i = 1; i <= 6; i++) {
        setTextInPlace(timer, `r${i}`);
        vi.advanceTimersByTime(100);
        capture.getSnapshot();
      }
      expect(appearedFor('timer')).toHaveLength(4); // suppressed

      await vi.advanceTimersByTimeAsync(10_500); // cold; no reconcile ran
      rekey(timer, 'later');
      await flushAndScan();

      expect(appearedFor('timer').at(-1)?.toast.message).toBe('later');
    });

    // A16 (review round 1, A1) — the reviewer's probe: a node that vanished in
    // an EARLIER batch than the new node arrived in is not a re-key. Run with
    // the default poll, and with no reconcile between the batches (a 60 s
    // poll, no reads until the end), where no prune can drop the vanished
    // node's entry first and only the same-batch rule refuses inheritance.
    it('distinct sequential toasts on one data-testid are each announced and each reach recent', async () => {
      for (const pollInterval of [500, 60_000]) {
        install({ pollInterval });
        for (let i = 1; i <= 6; i++) {
          const el = addStatus('toast', `msg${i}`);
          await flushAndScan();
          await vi.advanceTimersByTimeAsync(950); // visible ~1 s
          el.remove();
          await flushAndScan();
          await vi.advanceTimersByTimeAsync(450); // ~0.5 s gap
        }
        await vi.advanceTimersByTimeAsync(500);

        const all = ['msg1', 'msg2', 'msg3', 'msg4', 'msg5', 'msg6'];
        const label = `pollInterval ${pollInterval}`;
        expect(
          appearedFor('toast').map((e) => e.toast.message),
          label
        ).toEqual(all);
        const recent = capture.getRecent().map((t) => t.message);
        for (const message of all) expect(recent, label).toContain(message);
        capture.uninstall();
        document.body.innerHTML = '';
        events = [];
      }
    });

    // A17 (review round 1, A2) — a static sibling holds the key while a second
    // element on it is re-keyed per tick: the churner's chain is still bounded.
    it('a re-keyed churner beside a static sibling on the same id is bounded', async () => {
      install({ pollInterval: 500 });
      addStatus('timer', 'static');
      await flushAndScan();
      await rekeyTicker(12);

      const churn = events.filter(
        (e) => e.action === 'appeared' && e.toast.message.startsWith('0:')
      );
      expect(churn).toHaveLength(4);
      expect(
        events.filter((e) => e.action === 'appeared' && e.toast.message === 'static')
      ).toHaveLength(1);
    });

    // A18 (review round 2, A1) — a node already connected (parked empty)
    // when a suppressed sibling on its id leaves is not that sibling's
    // replacement: its budget was decided at its first sighting.
    it('an empty node already present beside a suppressed sibling keeps its own budget when the sibling leaves', async () => {
      install({ pollInterval: 500 });
      const slot = addEmptyStatus('timer');
      const timer = addStatus('timer', '0:00');
      await flushAndScan();
      await tick(timer, 1, 6); // `timer` suppressed
      expect(appearedFor('timer')).toHaveLength(4);

      timer.remove();
      slot.appendChild(document.createTextNode('Saved'));
      await flushAndScan();

      expect(appearedFor('timer').at(-1)?.toast.message).toBe('Saved');
    });

    // A19 (review round 2, A4) — a re-keyed node that mounts EMPTY and gets its
    // text in the next batch is still the replacement: it inherits at its
    // empty first sighting.
    it('a re-keyed node mounting empty and filled in the next batch is bounded', async () => {
      install({ pollInterval: 500 });
      let node = addStatus('timer', '0:00');
      await flushAndScan();
      for (let i = 1; i <= 20; i++) {
        node.remove();
        node = addEmptyStatus('timer');
        await flushAndScan();
        node.appendChild(document.createTextNode(`0:${String(i).padStart(2, '0')}`));
        await flushAndScan();
        await vi.advanceTimersByTimeAsync(400);
      }

      expect(appearedFor('timer')).toHaveLength(4);
    });

    // A20 (review round 2, A2) — an unrelated childList scan between ticks:
    // the holder is still recorded as seen in it, so the next re-key inherits.
    it('a re-keyed ticker with an unrelated scan between ticks is bounded', async () => {
      install({ pollInterval: 500 });
      let node = addStatus('timer', '0:00');
      await flushAndScan();
      for (let i = 1; i <= 20; i++) {
        node = rekey(node, `0:${String(i).padStart(2, '0')}`);
        await flushAndScan();
        document.body.appendChild(document.createElement('span'));
        await flushAndScan();
        await vi.advanceTimersByTimeAsync(400);
      }

      expect(appearedFor('timer')).toHaveLength(4);
    });

    // A21 (review round 2, A2) — a public read between the framework commit
    // and the debounced scan reconciles (and prunes) while the replaced node
    // is gone but not yet seen gone by a scan: its entry must survive it.
    it('a read between a re-key commit and its scan does not unbound the ticker', async () => {
      install({ pollInterval: 500 });
      let node = addStatus('timer', '0:00');
      await flushAndScan();
      for (let i = 1; i <= 20; i++) {
        node = rekey(node, `0:${String(i).padStart(2, '0')}`);
        capture.getSnapshot();
        await flushAndScan();
        await vi.advanceTimersByTimeAsync(450);
      }

      expect(appearedFor('timer')).toHaveLength(4);
    });

    // A22 (review round 2, A3) — a connected holder whose entry was pruned
    // while it was quiet re-registers when it captures again, so a re-key
    // after it resumes continues its budget.
    it('a ticker that resumes after a quiet window and is then re-keyed stays bounded', async () => {
      install({ pollInterval: 500 });
      const timer = addStatus('timer', 'a0');
      await flushAndScan();
      await vi.advanceTimersByTimeAsync(11_000); // cold: its entry is pruned
      const before = appearedFor('timer').length;

      for (const text of ['a1', 'a2', 'a3']) {
        setTextInPlace(timer, text);
        await vi.advanceTimersByTimeAsync(500);
      }
      let node: HTMLElement = timer;
      for (let i = 1; i <= 10; i++) {
        node = rekey(node, `0:${String(i).padStart(2, '0')}`);
        await flushAndScan();
        await vi.advanceTimersByTimeAsync(450);
      }

      expect(appearedFor('timer').length - before).toBe(4);
    });

    // A23 (review round 2, C1) — the reviewer's prune probe: a suppressed
    // node leaves in its own batch, a poll runs, then an empty sibling present
    // all along is filled in place. The sibling's budget is its own.
    it('an empty sibling filled in place after a suppressed node left is announced', async () => {
      install({ pollInterval: 500 });
      const slot = addEmptyStatus('timer');
      slot.appendChild(document.createTextNode(''));
      const timer = addStatus('timer', '0:00');
      await flushAndScan();
      await tick(timer, 1, 6); // `timer` suppressed

      timer.remove();
      await flushAndScan();
      await vi.advanceTimersByTimeAsync(500);
      setTextInPlace(slot, 'Saved');
      await vi.advanceTimersByTimeAsync(500);

      expect(capture.getActive().map((t) => [t.id, t.message])).toEqual([['timer', 'Saved']]);
    });

    // A10
    it('per-tick re-keying is bounded', async () => {
      install({ pollInterval: 500 });
      await rekeyTicker(20);

      expect(appearedFor('timer')).toHaveLength(4);
    });

    // A11
    it('after re-keying stops and stays quiet for the window, its settled text is announced once', async () => {
      install({ pollInterval: 500 });
      await rekeyTicker(20);
      expect(appearedFor('timer')).toHaveLength(4);

      await vi.advanceTimersByTimeAsync(10_000);
      await vi.advanceTimersByTimeAsync(500);

      const appeared = appearedFor('timer');
      expect(appeared).toHaveLength(5);
      expect(appeared[4].toast.message).toBe('0:20');
      expect(capture.getActive().map((t) => [t.id, t.message])).toEqual([['timer', '0:20']]);
    });

    // A12
    it('a re-keyed ticker beside a real toast leaves the real toast in recent', async () => {
      install({ pollInterval: 500 });
      const saved = document.createElement('div');
      saved.setAttribute('data-sonner-toast', '');
      saved.textContent = 'Saved';
      document.body.appendChild(saved);
      await flushAndScan();
      saved.remove();
      await vi.advanceTimersByTimeAsync(500);
      expect(capture.getRecent().some((t) => t.message === 'Saved')).toBe(true);

      await rekeyTicker(20);

      expect(capture.getRecent().some((t) => t.message === 'Saved')).toBe(true);
    });

    // A13
    it('a second connected element on the same id keeps its own budget', async () => {
      install({ pollInterval: 500 });
      const timer = addStatus('timer', '0:00');
      await flushAndScan();
      await tick(timer, 1, 6); // suppressed, parked, no active entry
      expect(capture.getActive()).toEqual([]);

      addStatus('timer', 'sib');
      await flushAndScan();

      expect(appearedFor('timer').at(-1)?.toast.message).toBe('sib');
      expect(capture.getActive().map((t) => [t.id, t.message])).toEqual([['timer', 'sib']]);
    });

    // A14
    it('re-keyed nodes with neither id nor data-testid are each announced as a new toast', async () => {
      install({ pollInterval: 500 });
      let node = addAnonymousStatus('n0');
      await flushAndScan();
      for (let i = 1; i <= 5; i++) {
        node.remove();
        node = addAnonymousStatus(`n${i}`);
        await flushAndScan();
        await vi.advanceTimersByTimeAsync(450);
      }

      const appeared = events.filter((e) => e.action === 'appeared');
      expect(appeared.map((e) => e.toast.message)).toEqual(['n0', 'n1', 'n2', 'n3', 'n4', 'n5']);
      expect(appeared.every((e) => /^toast-\d+$/.test(e.toast.id))).toBe(true);
      expect(new Set(appeared.map((e) => e.toast.id)).size).toBe(6);
    });

    // A15
    it('a re-install starts a re-keyed id with a fresh budget', async () => {
      install({ pollInterval: 500 });
      const last = await rekeyTicker(5); // suppressed from the 5th capture on
      expect(appearedFor('timer')).toHaveLength(4);
      await vi.advanceTimersByTimeAsync(500);

      capture.uninstall();
      capture.install((data) => events.push(data));
      await flushAndScan();

      rekey(last, 'after');
      await flushAndScan();

      expect(appearedFor('timer').at(-1)?.toast.message).toBe('after');
      expect(capture.getActive().map((t) => [t.id, t.message])).toEqual([['timer', 'after']]);
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
  // C — a visible element with no text (follow-up 4c24166d)
  // ==========================================================================

  describe('C: visible empty element', () => {
    /** Append `<div role="status" data-testid="slot">` holding `children`. */
    function addSlot(...children: Node[]): HTMLElement {
      const el = document.createElement('div');
      el.setAttribute('role', 'status');
      el.setAttribute('data-testid', 'slot');
      for (const child of children) el.appendChild(child);
      document.body.appendChild(el);
      return el;
    }

    /** Ten unrelated `childList` mutations under body, each followed by its scan. */
    async function tenUnrelatedMutations(): Promise<void> {
      for (let i = 0; i < 10; i++) {
        document.body.appendChild(document.createElement('span'));
        await flushAndScan();
      }
    }

    // C1
    it('a visible empty toast element is not cloned by unrelated body mutations', async () => {
      install({ pollInterval: 500 });
      const el = addSlot();
      await flushAndScan();

      const clone = vi.spyOn(el, 'cloneNode');
      await tenUnrelatedMutations();

      expect(clone).toHaveBeenCalledTimes(0);
      expect(capture.getActive()).toEqual([]);
    });

    // C2
    it('a visible empty element filled by a childList change is announced with one clone', async () => {
      install({ pollInterval: 500 });
      const el = addSlot();
      await flushAndScan();
      const clone = vi.spyOn(el, 'cloneNode');
      await tenUnrelatedMutations();

      clone.mockClear();
      el.appendChild(document.createTextNode('Ready'));
      await flushAndScan();

      expect(
        events.filter((e) => e.action === 'appeared').map((e) => [e.toast.id, e.toast.message])
      ).toEqual([['slot', 'Ready']]);
      expect(clone).toHaveBeenCalledTimes(1);
    });

    // C3
    it('a visible empty element filled in place (characterData only) is announced by the poll', async () => {
      install({ pollInterval: 500 });
      const el = addSlot(document.createTextNode(''));
      await flushAndScan();

      setTextInPlace(el, 'Ready');
      await vi.advanceTimersByTimeAsync(500);

      expect(capture.getActive().map((t) => [t.id, t.message])).toEqual([['slot', 'Ready']]);
    });

    // C4
    it('a visible empty element that is removed is untracked', async () => {
      install({ pollInterval: 500 });
      const observe = vi.spyOn(MutationObserver.prototype, 'observe');
      const el = addSlot();
      await flushAndScan();
      const clone = vi.spyOn(el, 'cloneNode');
      // The observer `track` attached to THIS element.
      const calls = observe.mock.calls.flatMap((c, i) => (c[0] === el ? [i] : []));
      expect(calls).toHaveLength(1);
      const own = observe.mock.contexts[calls[0]];

      const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
      el.remove();
      await vi.advanceTimersByTimeAsync(500);
      expect(disconnect.mock.contexts).toContain(own);

      await tenUnrelatedMutations();
      expect(clone).toHaveBeenCalledTimes(0);
    });

    // C5 (amended by plan 2026-11-25-…-tracks-hidden-matches-until-shown: a
    // hidden element is parked and tracked, not left unobserved)
    it('a hidden empty element is not announced; shown and filled in one tick, it is', async () => {
      install({ pollInterval: 500 });
      const observe = vi.spyOn(MutationObserver.prototype, 'observe');
      const el = addSlot();
      el.style.display = 'none';
      await flushAndScan();
      await tenUnrelatedMutations();
      expect(events.filter((e) => e.action === 'appeared')).toEqual([]);
      // Hidden, it is parked with '' and tracked by exactly one observer of its
      // own (so a style-only reveal reaches the poll — section H), and the
      // unrelated mutations never clone it.
      expect(observe.mock.calls.filter((c) => c[0] === el)).toHaveLength(1);
      const clone = vi.spyOn(el, 'cloneNode');
      await tenUnrelatedMutations();
      expect(clone).toHaveBeenCalledTimes(0);
      expect(events.filter((e) => e.action === 'appeared')).toEqual([]);
      clone.mockRestore();

      el.style.display = '';
      el.appendChild(document.createTextNode('Ready'));
      await flushAndScan();

      expect(
        events.filter((e) => e.action === 'appeared').map((e) => [e.toast.id, e.toast.message])
      ).toEqual([['slot', 'Ready']]);
    });
  });

  // ==========================================================================
  // H — a toast element first seen hidden (follow-up 5caa1bf5)
  // ==========================================================================

  describe('H: hidden toast element', () => {
    /**
     * Append a `role="status"` element carrying `data-testid` and one text
     * node, with `style` applied BEFORE it is attached (mounted hidden).
     */
    function addHiddenStatus(
      testid: string,
      text: string,
      style: Partial<Pick<CSSStyleDeclaration, 'opacity' | 'display' | 'visibility'>>,
      parent: Element = document.body
    ): HTMLElement {
      const el = document.createElement('div');
      el.setAttribute('role', 'status');
      el.setAttribute('data-testid', testid);
      el.appendChild(document.createTextNode(text));
      Object.assign(el.style, style);
      parent.appendChild(el);
      return el;
    }

    /** `rekey`, but the new `timer` node mounts at `opacity: 0`. */
    function rekeyHidden(prev: Element, text: string): HTMLElement {
      prev.remove();
      return addHiddenStatus('timer', text, { opacity: '0' });
    }

    /**
     * A `timer` ticker whose replacements mount hidden: `0:00` visible and
     * captured by the scan, then `0:01` … `0:<ticks>` each on a NEW node
     * mounted at opacity 0 and faded in by style, one scan and one poll per
     * tick. Returns the last node.
     */
    async function hiddenRekeyTicker(ticks: number): Promise<HTMLElement> {
      let node = addStatus('timer', '0:00');
      await flushAndScan();
      for (let i = 1; i <= ticks; i++) {
        node = rekeyHidden(node, `0:${String(i).padStart(2, '0')}`);
        await flushAndScan();
        node.style.opacity = '1';
        await vi.advanceTimersByTimeAsync(450);
      }
      return node;
    }

    function appeared(): ToastEventData[] {
      return events.filter((e) => e.action === 'appeared');
    }

    // H1
    it('a toast mounted at opacity 0 and faded in by style alone is announced by the poll', async () => {
      install({ pollInterval: 500 });
      const el = addHiddenStatus('saved', 'Saved', { opacity: '0' });
      await flushAndScan();
      expect(appeared()).toEqual([]);

      el.style.opacity = '1';
      // No public read yet and no poll yet: nothing may have announced it.
      expect(appeared()).toEqual([]);
      await vi.advanceTimersByTimeAsync(500);

      // The poll announced it — asserted BEFORE any public read, which would
      // reconcile and announce on its own.
      expect(appearedFor('saved')).toHaveLength(1);
      expect(capture.getActive().map((t) => [t.id, t.message])).toEqual([['saved', 'Saved']]);
    });

    // H2
    it('a public read sees a style-only reveal with no poll', async () => {
      install({ pollInterval: 500 });
      const el = addHiddenStatus('saved', 'Saved', { display: 'none' });
      await flushAndScan();
      expect(appeared()).toEqual([]);

      el.style.display = '';

      expect(capture.getActive().map((t) => [t.id, t.message])).toEqual([['saved', 'Saved']]);
    });

    // H3
    it('a toast under an ancestor hidden by visibility is announced when the ancestor is shown by style', async () => {
      install({ pollInterval: 500 });
      const parent = document.createElement('div');
      parent.style.visibility = 'hidden';
      document.body.appendChild(parent);
      addStatus('bar', 'Connected', parent);
      await flushAndScan();
      expect(appeared()).toEqual([]);

      parent.style.visibility = '';
      await vi.advanceTimersByTimeAsync(500);

      expect(capture.getActive().map((t) => [t.id, t.message])).toEqual([['bar', 'Connected']]);
    });

    // H3b
    it('a toast mounted with visibility hidden and shown by style alone is announced by the poll', async () => {
      install({ pollInterval: 500 });
      const el = addHiddenStatus('bar', 'Connected', { visibility: 'hidden' });
      await flushAndScan();
      expect(appeared()).toEqual([]);

      el.style.visibility = '';
      expect(appeared()).toEqual([]);
      await vi.advanceTimersByTimeAsync(500);

      // Announced by the poll, asserted before any public read.
      expect(appearedFor('bar')).toHaveLength(1);
      expect(capture.getActive().map((t) => [t.id, t.message])).toEqual([['bar', 'Connected']]);
    });

    // H4
    it('a re-keyed ticker whose replacements mount hidden is held to 4 announcements', async () => {
      install({ pollInterval: 500 });
      await hiddenRekeyTicker(20);

      expect(appearedFor('timer')).toHaveLength(4);
    });

    // H5
    it('a hidden-mounted re-keyed ticker that stops announces its settled text once', async () => {
      install({ pollInterval: 500 });
      await hiddenRekeyTicker(20);
      expect(appearedFor('timer')).toHaveLength(4);

      await vi.advanceTimersByTimeAsync(10_000);
      await vi.advanceTimersByTimeAsync(500);

      expect(appearedFor('timer')).toHaveLength(5);
      expect(appearedFor('timer').at(-1)?.toast.message).toBe('0:20');
      expect(capture.getActive().map((t) => [t.id, t.message])).toEqual([['timer', '0:20']]);
    });

    // H6
    it('a hidden toast with text costs one observer and no clone across scans, polls and reads', async () => {
      install({ pollInterval: 500 });
      const observe = vi.spyOn(MutationObserver.prototype, 'observe');
      // Hidden through an ancestor's (inherited) visibility, not its own inline
      // style, which isElementVisible answers without getComputedStyle — so
      // each check reaches getComputedStyle, the cost this case pins.
      const parent = document.createElement('div');
      parent.style.visibility = 'hidden';
      document.body.appendChild(parent);
      const el = addStatus('saved', 'Saved', parent);
      await flushAndScan();
      const clone = vi.spyOn(el, 'cloneNode');

      for (let i = 0; i < 10; i++) {
        document.body.appendChild(document.createElement('span'));
        await flushAndScan();
      }
      const style = vi.spyOn(globalThis, 'getComputedStyle');
      await vi.advanceTimersByTimeAsync(5_000);
      // The per-poll cost of a hidden match is its one visibility check: ten
      // polls, ten getComputedStyle calls on it, and nothing else.
      expect(style.mock.calls.filter((c) => c[0] === el)).toHaveLength(10);
      style.mockRestore();
      for (let i = 0; i < 10; i++) capture.getActive();

      expect(observe.mock.calls.filter((c) => c[0] === el)).toHaveLength(1);
      expect(clone).toHaveBeenCalledTimes(0);
      expect(appeared()).toEqual([]);
    });

    // H7
    it('a hidden toast whose text ticks is not cloned; shown, it is cloned once', async () => {
      install({ pollInterval: 500 });
      const el = addHiddenStatus('timer', '0:00', { display: 'none' });
      await flushAndScan();
      const clone = vi.spyOn(el, 'cloneNode');

      await tick(el, 1, 6);
      expect(clone).toHaveBeenCalledTimes(0);
      expect(appeared()).toEqual([]);

      el.style.display = '';
      await vi.advanceTimersByTimeAsync(500);

      expect(appearedFor('timer').map((e) => e.toast.message)).toEqual(['0:06']);
      expect(clone).toHaveBeenCalledTimes(1);
    });

    // H8
    it('a hidden toast that is removed while hidden is untracked', async () => {
      install({ pollInterval: 500 });
      const observe = vi.spyOn(MutationObserver.prototype, 'observe');
      const el = addHiddenStatus('saved', 'Saved', { display: 'none' });
      await flushAndScan();
      // The observer `track` attached to THIS element.
      const calls = observe.mock.calls.flatMap((c, i) => (c[0] === el ? [i] : []));
      expect(calls).toHaveLength(1);
      const own = observe.mock.contexts[calls[0]];

      const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
      el.remove();
      await vi.advanceTimersByTimeAsync(500);

      expect(disconnect.mock.contexts).toContain(own);
    });

    // H9
    it('a hidden toast shown, re-hidden and shown again is announced twice', async () => {
      install({ pollInterval: 500 });
      const el = addHiddenStatus('saved', 'Saved', { display: 'none' });
      await flushAndScan();

      el.style.display = '';
      await vi.advanceTimersByTimeAsync(500);
      expect(appearedFor('saved')).toHaveLength(1);

      el.style.display = 'none';
      await vi.advanceTimersByTimeAsync(500);
      expect(events.filter((e) => e.action === 'dismissed' && e.toast.id === 'saved')).toHaveLength(
        1
      );

      el.style.display = '';
      await vi.advanceTimersByTimeAsync(500);

      expect(appearedFor('saved').map((e) => e.toast.message)).toEqual(['Saved', 'Saved']);
    });

    // H10
    it('a hidden toast inside a redaction boundary, shown by style, reports only the sentinel', async () => {
      install({ pollInterval: 500 });
      const parent = document.createElement('div');
      parent.setAttribute('data-bridge-redact', 'true');
      document.body.appendChild(parent);
      const el = addHiddenStatus('otp', 'Code 123456', { display: 'none' }, parent);
      await flushAndScan();

      el.style.display = '';

      expect(capture.getActive().map((t) => t.message)).toEqual([REDACTED_VALUE]);
      expect(events.some((e) => e.toast.message.includes('123456'))).toBe(false);
    });

    // H11
    it('a hidden toast is parked again by a re-install of the same instance', async () => {
      install({ pollInterval: 500 });
      const el = addHiddenStatus('saved', 'Saved', { display: 'none' });
      await flushAndScan();

      capture.uninstall();
      capture.install((d) => events.push(d));
      el.style.display = '';
      await vi.advanceTimersByTimeAsync(500);

      expect(appearedFor('saved').map((e) => e.toast.message)).toEqual(['Saved']);
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
    it('the budget clamps below 1 to 1, floors fractions, and maps non-finite values to the default; a window below 1 ms or non-finite means the default', async () => {
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

      for (const budget of [Infinity, NaN]) {
        install({ pollInterval: 500, maxAnnouncementsPerWindow: budget });
        const el = addStatus('nonfinite', '0:00');
        await flushAndScan();
        await tick(el, 1, 10);
        expect(appearedFor('nonfinite'), `budget ${budget}`).toHaveLength(4);
        capture.uninstall();
        document.body.innerHTML = '';
        events = [];
      }

      // A window of 0 would disable the budget, Infinity would never release
      // and NaN would empty it: each means the default 10 s, so a ticker is
      // held to 4 and its settled text is released after 10 s of quiet.
      for (const window of [0, Infinity, NaN]) {
        install({ pollInterval: 500, announcementWindowMs: window });
        const timer = addStatus('timer', '0:00');
        await flushAndScan();
        await tick(timer, 1, 10);
        expect(appearedFor('timer'), `window ${window}`).toHaveLength(4);
        // The last change is seen ~5 s in; pin the 10 s boundary from both sides.
        await vi.advanceTimersByTimeAsync(9_500);
        expect(appearedFor('timer'), `window ${window} still held`).toHaveLength(4);
        await vi.advanceTimersByTimeAsync(500);
        expect(appearedFor('timer'), `window ${window} release`).toHaveLength(5);
        expect(appearedFor('timer').at(-1)?.toast.message).toBe('0:10');
        capture.uninstall();
        document.body.innerHTML = '';
        events = [];
      }
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
