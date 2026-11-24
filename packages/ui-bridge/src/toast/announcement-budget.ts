/**
 * Toast announcement budget store
 *
 * Holds each captured element's announcement budget (see the header comment
 * of `toast-capture.ts`). A node's budget is decided ONCE, at its first
 * sighting by the scan (`sight`) — before it has any text, so a node mounted
 * empty is decided the same way as one mounted with text. From then on the
 * budget is found by node. At that first sighting a node with a stable key
 * (its `id` or `data-testid`) inherits a budget on that key only when it is a
 * REPLACEMENT: the budget's holder is disconnected now, it was seen connected
 * at the end of the immediately preceding scan (so it vanished in the same
 * mutation batch the new node arrived in — React swaps a `key={count}` node
 * in one commit), and the budget is still warm. That keeps the per-window
 * bound and any suppression across a re-keyed ticker's nodes. Everything
 * else gets a fresh budget:
 *  - a node first seen in an EARLIER scan (a sibling already present, e.g.
 *    an empty slot, when another node on its key leaves);
 *  - a node that arrived in a later batch than its predecessor left (a
 *    distinct toast that reuses the test id after the previous one left);
 *  - a cold budget (a one-off remount after quiet);
 *  - an element with no stable key (keyed by node only).
 * A connected holder is never inherited from (it is a sibling). Only the scan
 * sights; every other path (`getOrCreate`) reads the node's own budget, or
 * creates a fresh one for a node no scan has sighted.
 * A key holds a small list of entries, one per chain of nodes, so a churner's
 * replacement chain inherits from its own vanished predecessor even while a
 * static sibling holds the same key.
 *
 * The admit/suppress/park decision stays in `ToastCapture.admitCapture`; this
 * module only decides WHICH budget object an element reads.
 */

/** Per-element announcement budget state (see `toast-capture.ts`). */
export interface AnnouncementBudget {
  /** Capture timestamps inside the current window. */
  captures: number[];
  /** True while the element's changes are absorbed with no announcement. */
  suppressed: boolean;
  /** When a suppressed element's observed text last changed. */
  lastChangedAt: number;
}

/** One chain of nodes on a key: its budget, current node, and last sighting. */
interface KeyedBudget {
  budget: AnnouncementBudget;
  holder: Element;
  /** The last scan generation at whose end `holder` was connected. */
  seenGen: number;
}

export class AnnouncementBudgets {
  private byNode: WeakMap<Element, AnnouncementBudget> = new WeakMap();
  /**
   * Per stable key, one entry per chain of nodes. `prune` keeps an entry
   * while its budget is warm AND either its holder is connected or the holder
   * was still connected at the end of the latest scan (so the next scan may
   * yet sight its replacement). Every entry it drops is one `sight` would
   * refuse anyway, except a connected holder's cold entry, which comes back
   * through `register` when that holder next reads its budget.
   */
  private byKey: Map<string, KeyedBudget[]> = new Map();
  /** Scan generation: incremented by `beginScan`. */
  private generation = 0;

  /** @param windowMs `announcementWindowMs` as used (already validated). */
  constructor(private readonly windowMs: number) {}

  /**
   * Warm: a capture inside the window, or suppressed and changed within the
   * window (still absorbing changes). Only a warm budget is inherited.
   */
  isWarm(budget: AnnouncementBudget, now: number): boolean {
    if (budget.captures.some((t) => now - t < this.windowMs)) return true;
    return budget.suppressed && now - budget.lastChangedAt < this.windowMs;
  }

  /** Start a scan: one generation per debounced mutation batch. */
  beginScan(): void {
    this.generation++;
  }

  /** End a scan: record every still-connected holder as seen in it. */
  endScan(): void {
    for (const entries of this.byKey.values()) {
      for (const entry of entries) {
        if (entry.holder.isConnected) entry.seenGen = this.generation;
      }
    }
  }

  /** The budget linked to `el`, if any. */
  get(el: Element): AnnouncementBudget | undefined {
    return this.byNode.get(el);
  }

  /**
   * The scan's sighting of `el` (its first, or a later one of a node that is
   * neither active nor parked): its own budget if it has one; else, for a
   * non-empty `key`, the budget of an entry whose holder `el` replaces
   * (disconnected, seen at the end of the preceding scan, warm) — `el` is
   * linked to it and becomes its holder; else a fresh budget.
   */
  sight(el: Element, key: string, now: number): AnnouncementBudget {
    if (key && !this.byNode.has(el)) {
      const replaced = this.byKey
        .get(key)
        ?.find(
          (e) =>
            !e.holder.isConnected && e.seenGen === this.generation - 1 && this.isWarm(e.budget, now)
        );
      if (replaced) {
        this.byNode.set(el, replaced.budget);
        replaced.holder = el;
        replaced.seenGen = this.generation;
        return replaced.budget;
      }
    }
    return this.getOrCreate(el, key, now);
  }

  /**
   * The budget `el` reads on every path but the scan's sighting: its own
   * (re-registered on `key` if `prune` dropped its entry while it was cold),
   * or, for a node no scan has sighted, a fresh one. Never inherits.
   */
  getOrCreate(el: Element, key: string, now: number): AnnouncementBudget {
    const own = this.byNode.get(el);
    if (own) {
      if (key) this.register(key, own, el);
      return own;
    }
    const budget: AnnouncementBudget = { captures: [], suppressed: false, lastChangedAt: now };
    this.byNode.set(el, budget);
    if (key) this.register(key, budget, el);
    return budget;
  }

  /** Add an entry for `el` on `key` unless it already holds one there. */
  private register(key: string, budget: AnnouncementBudget, el: Element): void {
    const entries = this.byKey.get(key);
    const entry = { budget, holder: el, seenGen: this.generation };
    if (!entries) this.byKey.set(key, [entry]);
    else if (!entries.some((e) => e.holder === el)) entries.push(entry);
  }

  /**
   * Drop every entry that can no longer be inherited (see `byKey`). It bounds
   * memory and has no other effect: `sight` refuses each dropped entry on its
   * own conditions, and a connected holder dropped while cold re-registers
   * when it next reads its budget. It must NOT drop more: an entry whose
   * holder left after the latest scan is the one the next scan's sighting of
   * its replacement inherits, and a read can run between a framework commit
   * and that scan.
   */
  prune(now: number): void {
    for (const [key, entries] of this.byKey) {
      const kept = entries.filter(
        (e) => this.isWarm(e.budget, now) && (e.holder.isConnected || e.seenGen === this.generation)
      );
      if (kept.length === 0) this.byKey.delete(key);
      else if (kept.length !== entries.length) this.byKey.set(key, kept);
    }
  }

  /** Forget every budget, so every element starts fresh (`uninstall`). */
  clear(): void {
    this.byNode = new WeakMap();
    this.byKey.clear();
  }
}
