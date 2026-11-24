/**
 * Toast announcement budget store
 *
 * Holds each captured element's announcement budget (see the header comment
 * of `toast-capture.ts`). A budget is found by NODE first. A NEW node with a
 * stable key (its `id` or `data-testid`) inherits that key's budget when the
 * budget's last holder is disconnected and the budget is still warm: that is
 * a re-keyed node (React `key={count}` replaces the node on every tick), and
 * inheriting keeps the per-window bound and any suppression across nodes. A
 * connected holder means a sibling on the same key, which gets its own
 * budget; a cold budget is not inherited, so a one-off remount after quiet
 * starts fresh. An element with no stable key is keyed by node only.
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

/** A key's budget and the node that last held it. */
interface KeyedBudget {
  budget: AnnouncementBudget;
  holder: Element;
}

export class AnnouncementBudgets {
  private byNode: WeakMap<Element, AnnouncementBudget> = new WeakMap();
  /**
   * At most one entry per stable key, kept while it is warm or its holder is
   * connected; `prune` drops the rest.
   */
  private idBudgets: Map<string, KeyedBudget> = new Map();

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

  /** The budget linked to `el`, if any. */
  get(el: Element): AnnouncementBudget | undefined {
    return this.byNode.get(el);
  }

  /**
   * The budget `el` reads: its own (node hit); else, for a non-empty `key`, the
   * key's budget when its holder is disconnected and the budget is warm (`el`
   * is linked to it and becomes the holder); else a fresh budget, registered
   * under `key` unless a connected holder still owns the key.
   */
  getOrCreate(el: Element, key: string, now: number): AnnouncementBudget {
    const own = this.byNode.get(el);
    if (own) {
      if (key && !this.idBudgets.has(key)) this.idBudgets.set(key, { budget: own, holder: el });
      return own;
    }

    const keyed = key ? this.idBudgets.get(key) : undefined;
    if (keyed && !keyed.holder.isConnected && this.isWarm(keyed.budget, now)) {
      this.byNode.set(el, keyed.budget);
      keyed.holder = el;
      return keyed.budget;
    }

    const budget: AnnouncementBudget = { captures: [], suppressed: false, lastChangedAt: now };
    this.byNode.set(el, budget);
    if (key && !(keyed && keyed.holder.isConnected)) {
      this.idBudgets.set(key, { budget, holder: el });
    }
    return budget;
  }

  /**
   * Drop every key entry that is cold: none of them can be inherited, and
   * dropping one releases its holder reference. A connected holder keeps its
   * budget by node, and re-registers the key on its next capture.
   */
  prune(now: number): void {
    for (const [key, keyed] of this.idBudgets) {
      if (!this.isWarm(keyed.budget, now)) this.idBudgets.delete(key);
    }
  }

  /** Forget every budget, so every element starts fresh (`uninstall`). */
  clear(): void {
    this.byNode = new WeakMap();
    this.idBudgets.clear();
  }
}
