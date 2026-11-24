/**
 * Toast announcement budget store
 *
 * Holds each captured element's announcement budget (see the header comment
 * of `toast-capture.ts`). A budget is found by NODE first. A NEW node with a
 * stable key (its `id` or `data-testid`) inherits a budget on that key only
 * when the node is a REPLACEMENT: the budget's holder is disconnected now, it
 * was seen connected at the end of the immediately preceding scan (so it
 * vanished in the same mutation batch the new node arrived in — React swaps
 * a `key={count}` node in one commit), and the budget is still warm. That
 * keeps the per-window bound and any suppression across a re-keyed ticker's
 * nodes. Everything else gets a fresh budget:
 *  - a node that vanished in an EARLIER batch than the new node arrived in
 *    (a distinct toast that reuses the test id after the previous one left);
 *  - a connected holder (a sibling on the same key);
 *  - a cold budget (a one-off remount after quiet);
 *  - an element with no stable key (keyed by node only).
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
   * Per stable key, one entry per chain of nodes. `prune` keeps an entry only
   * while its budget is warm AND either its holder is connected or the holder
   * was still connected at the end of the latest scan (so the next scan may
   * yet see its replacement); every other entry can no longer be inherited.
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
   * The budget `el` reads: its own (node hit); else, for a non-empty `key`, the
   * budget of an entry whose holder `el` replaces (disconnected, seen at the
   * end of the preceding scan, warm) — `el` is linked to it and becomes its
   * holder; else a fresh budget, registered as a new entry on `key`.
   */
  getOrCreate(el: Element, key: string, now: number): AnnouncementBudget {
    const own = this.byNode.get(el);
    if (own) {
      if (key) this.register(key, own, el);
      return own;
    }

    const replaced = key
      ? this.byKey
          .get(key)
          ?.find(
            (e) =>
              !e.holder.isConnected &&
              e.seenGen === this.generation - 1 &&
              this.isWarm(e.budget, now)
          )
      : undefined;
    if (replaced) {
      this.byNode.set(el, replaced.budget);
      replaced.holder = el;
      replaced.seenGen = this.generation;
      return replaced.budget;
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
   * Drop every entry that can no longer be inherited (see `byKey`). Memory
   * only: `getOrCreate` refuses each dropped entry on its own conditions, and
   * a connected holder dropped while cold re-registers on its next capture.
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
