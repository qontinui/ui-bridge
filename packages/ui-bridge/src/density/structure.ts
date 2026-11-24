/**
 * Structure of a capture: who contains whom, which items are leaves, what is
 * pinned to the viewport, and which leaves form a block.
 *
 * Two halves. {@link resolveDensityStructure} runs at CAPTURE time, because it
 * reads the snapshot's xpath and stable ref, which the capture does not keep:
 * it writes each item's `parent`, `path`, `structureBy`, `landmark`,
 * `ownChars` and `blockKey`. Everything else here reads the capture alone, so a
 * capture written to a file measures the same as the snapshot it came from.
 *
 * Ancestry comes from the xpath only (`generateXPath`,
 * `core/element-identifier.ts`): either `//*[@id="X"]` — the element has its
 * own id, and the xpath says nothing about its ancestors — or a chain of
 * `tag[n]` segments that starts at the nearest ancestor with an `id` or a
 * `data-testid`, or at the document root. The semantic path
 * (`stableRef.semanticPath`) stops after 8 levels, renders its anchor without
 * a tag and skips React-generated ids, so it contributes landmark hints and
 * never decides a parent.
 *
 * Plan: 2026-11-23-ui-bridge-measures-information-density-as-reach-per-role-and-plans-the-change (Phase 3).
 */

import { resolveDensityMatcher, type DensityUnresolvedReason } from './match';
import {
  DENSITY_MAX_COORDINATE_PX,
  type DensityCapture,
  type DensityItem,
  type DensityLandmark,
  type DensityRect,
  type DensityTargets,
} from './schema';

// ============================================================================
// Capture-time structure
// ============================================================================

/** What the snapshot row says about an item's place in the DOM, read once at capture time. */
export interface DensityStructureHint {
  /** `identifier.xpath`. */
  xpath: string | null;
  /** `identifier.htmlId`: the element's own `id` attribute. */
  htmlId: string | null;
  /** `identifier.testId`: the element's own `data-testid`. */
  testId: string | null;
  /** `stableRef.semanticPath`: landmark hints only. */
  semanticPath: string | null;
}

/** The tags that open a block by path (`by: path`). */
export const DENSITY_BLOCK_TAGS: readonly string[] = [
  'section',
  'article',
  'aside',
  'form',
  'fieldset',
  'table',
  'dialog',
];

const LANDMARK_ROLES: readonly DensityLandmark[] = [
  'banner',
  'navigation',
  'main',
  'contentinfo',
  'complementary',
];

/** Tags that scope a `header` / `footer` so it is no longer the page's banner / contentinfo (HTML-AAM). */
const SECTIONING_TAGS = new Set(['article', 'aside', 'main', 'nav', 'section']);

interface ParsedChain {
  /** Normalised key of each segment prefix: `keys[i]` names the element at depth `i` of the chain. */
  keys: string[];
  /** Tag of each segment (`*` when the xpath does not name it). */
  tags: string[];
}

/** One xpath segment: `div`, `div[2]`, `section[@id="x"]`, `div[@data-testid="y"]`. */
const SEGMENT = /^([^[\]/]+)(?:\[(\d+)\]|\[@(id|data-testid)="(.*)"\])?$/s;

/** Split on `/` outside brackets, so an id holding `/` stays one segment. */
function splitSegments(text: string): string[] | null {
  const out: string[] = [];
  let cur = '';
  let depth = 0;
  let quoted = false;
  for (const ch of text) {
    if (ch === '"' && depth > 0) quoted = !quoted;
    else if (!quoted && ch === '[') depth++;
    else if (!quoted && ch === ']') depth--;
    if (ch === '/' && depth === 0 && !quoted) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
    if (depth < 0) return null;
  }
  out.push(cur);
  return depth === 0 && !quoted ? out : null;
}

function anchorKey(kind: string, value: string): string {
  return kind === 'id' ? `@id=${value}` : `@testid=${value}`;
}

/**
 * The item's own key and, for a chain, the key of every prefix. `null` when the
 * xpath is not one `generateXPath` writes. An own-id xpath is a chain of one
 * whose ancestry is unknown (`ownId`).
 */
function parseXPath(xpath: string): (ParsedChain & { ownId: boolean }) | null {
  const own = /^\/\/\*\[@id="([^"]*)"\]$/.exec(xpath);
  if (own) return { keys: [anchorKey('id', own[1])], tags: ['*'], ownId: true };
  let rest: string;
  const keys: string[] = [];
  const tags: string[] = [];
  // `//*[@id="X"]/...` is not what generateXPath writes, but it names the same
  // anchor, so it is read as one.
  const anchored = /^\/\/\*\[@id="([^"]*)"\]\/(.+)$/s.exec(xpath);
  if (anchored) {
    keys.push(anchorKey('id', anchored[1]));
    tags.push('*');
    rest = anchored[2];
  } else if (xpath.startsWith('/') && !xpath.startsWith('//')) {
    rest = xpath.slice(1);
  } else {
    return null;
  }
  const segments = splitSegments(rest);
  if (segments === null || segments.some((s) => s === '')) return null;
  for (let i = 0; i < segments.length; i++) {
    const m = SEGMENT.exec(segments[i]);
    if (!m) return null;
    const tag = m[1].toLowerCase();
    tags.push(tag);
    if (m[3] !== undefined) {
      // An attribute anchor is only ever the chain's first segment.
      if (keys.length > 0) return null;
      keys.push(anchorKey(m[3] === 'id' ? 'id' : 'testid', m[4]));
    } else {
      const seg = m[2] !== undefined ? `${tag}[${m[2]}]` : tag;
      keys.push(keys.length === 0 ? `/${seg}` : `${keys[keys.length - 1]}/${seg}`);
    }
  }
  return { keys, tags, ownId: false };
}

function landmarkOfRole(role: string | null): DensityLandmark | null {
  return role !== null && (LANDMARK_ROLES as readonly string[]).includes(role)
    ? (role as DensityLandmark)
    : null;
}

/**
 * The landmark a tag opens, given the tags above it (outermost first) and
 * whether they are every ancestor. A `header` / `footer` is scoped by its
 * ancestors, so with an incomplete ancestry it is unknown, and answers `null`.
 */
function landmarkOfTag(
  tag: string,
  above: readonly string[] | null,
  complete: boolean
): DensityLandmark | null {
  switch (tag) {
    case 'nav':
      return 'navigation';
    case 'main':
      return 'main';
    case 'aside':
      return 'complementary';
    case 'header':
    case 'footer': {
      if (!complete || above === null || above.some((t) => SECTIONING_TAGS.has(t))) return null;
      return tag === 'header' ? 'banner' : 'contentinfo';
    }
    default:
      return null;
  }
}

/**
 * `[role="…"]` landmark hints of a semantic path, innermost first, each with
 * its distance above the item: `buildSemanticPath` (`core/stable-ref.ts`)
 * writes one part per DOM level, the item's own part last.
 */
function semanticRoleHintsByDistance(
  semanticPath: string | null
): Array<{ distance: number; landmark: DensityLandmark }> {
  if (semanticPath === null) return [];
  const out: Array<{ distance: number; landmark: DensityLandmark }> = [];
  const parts = semanticPath.split(' > ').reverse();
  parts.forEach((part, distance) => {
    const m = /\[role="([^"]*)"\]/.exec(part);
    const lm = m ? landmarkOfRole(m[1]) : null;
    if (lm !== null) out.push({ distance, landmark: lm });
  });
  return out;
}

function contains(outer: DensityRect, inner: DensityRect): boolean {
  return (
    outer.x <= inner.x &&
    outer.y <= inner.y &&
    outer.x + outer.w >= inner.x + inner.w &&
    outer.y + outer.h >= inner.y + inner.h
  );
}

/** The key of the chain's parent segment; see `siblingKey` below. */
function siblingKeyOf(p: (ParsedChain & { ownId: boolean }) | null): string | null {
  if (!p || p.ownId || p.keys.length < 2) return null;
  return p.keys[p.keys.length - 2];
}

/**
 * Resolve the structure of `items` in place of their unresolved fields, and
 * answer new items (the inputs are not mutated). `hints[i]` belongs to
 * `items[i]`.
 *
 * - **Keys.** Each item is addressable by its own chain key and by its own id
 *   and test id. A key that more than one item claims is AMBIGUOUS (repeated
 *   list rows that share a `data-testid` give every row's children one
 *   byte-identical chain) and resolves nothing: an item reached only through
 *   one takes its parent from geometry.
 * - **Parent by path.** The parent is the registered item whose chain is the
 *   longest proper segment-prefix of this item's chain. The first segment of a
 *   chain anchored at `tag[@id="X"]` (or `tag[@data-testid="T"]`) is the item
 *   whose own id (test id) is that value, so a chain with no longer registered
 *   prefix takes that item as its parent. A chain that reaches the document
 *   root with no registered prefix is a root. A link that would close a cycle
 *   is not taken. `structureBy: xpath`.
 * - **Parent by geometry.** Every other item with a rect — an own-id xpath,
 *   none at all, a chain anchored at an element nobody registered, or one that
 *   resolved only through an ambiguous key — takes the registered item with the
 *   smallest rect, of nonzero area, that contains its own (no cycle).
 *   `structureBy: geometry`. `path` keeps whatever ancestor tags the chain gave.
 * - **path.** The tags of the chain above the item, after the anchor's path
 *   when the chain is anchored at a registered item; `null` when the xpath
 *   gives no ancestor. `*` is an ancestor whose tag the xpath does not name.
 * - **landmark.** The item's own role or tag; else the innermost of — by
 *   distance above the item — the chain's tags between the item and its xpath
 *   parent, the parent's landmark (at the parent's distance), (with no xpath
 *   parent) the rest of `path`, and the `[role="…"]` hints of the semantic
 *   path, a role hint winning a tie. So an unregistered `div[role=navigation]`
 *   between an item and its parent in `main` makes the item navigation. A
 *   `header` / `footer` is the banner / contentinfo only when
 *   its whole ancestry is known (a chain from the document root) and holds no
 *   sectioning element; with unknown ancestry it is no landmark, never a
 *   default.
 * - **ownChars.** `chars` minus the registered children's `chars` and the
 *   collapsed separators between them, not below 0; `null` when any term is
 *   `null`. A child read from geometry is assumed to be a DOM descendant; the
 *   summary counts the items for which that assumption was made.
 * - **siblingKey.** The key of the chain's parent segment (the item's parent
 *   element, registered or not), so that items sharing it are DOM siblings;
 *   `null` for an own-id xpath, a one-segment chain, or a chain through an
 *   ambiguous key.
 * - **cousinKey.** The key of the repeated row position (`ul/li[*]`) of the
 *   deepest unregistered `li` / `tr` the chain passes through, for the
 *   registered item nearest that row: items inside repeated unregistered rows
 *   of one list share it, whatever their tags.
 * - **blockKey.** The key of the nearest block-tag ancestor-or-self in the
 *   chain, else (for a chain anchored at a registered item) that item's.
 *   `null` for a chain through an ambiguous key, and for a chain anchored at a
 *   `data-testid` no registered item carries (a test id may repeat, one per
 *   card, so no key below it says which card an item is in).
 */
export function resolveDensityStructure(
  items: readonly DensityItem[],
  hints: readonly DensityStructureHint[]
): DensityItem[] {
  const n = items.length;
  const parsed = hints.map((h) => (h.xpath ? parseXPath(h.xpath) : null));

  const AMBIGUOUS = -1;
  const byKey = new Map<string, number>();
  const claim = (key: string, i: number) => {
    const cur = byKey.get(key);
    if (cur === undefined) byKey.set(key, i);
    else if (cur !== i) byKey.set(key, AMBIGUOUS);
  };
  parsed.forEach((p, i) => {
    if (p) claim(p.keys[p.keys.length - 1], i);
  });
  hints.forEach((h, i) => {
    if (h.htmlId) claim(anchorKey('id', h.htmlId), i);
    if (h.testId) claim(anchorKey('testid', h.testId), i);
  });
  /** The one item a key names, or `null` (absent, or ambiguous). */
  const lookup = (key: string): number | null => {
    const j = byKey.get(key);
    return j === undefined || j === AMBIGUOUS ? null : j;
  };
  const ambiguous = (key: string): boolean => byKey.get(key) === AMBIGUOUS;

  const parent: Array<number | null> = new Array<number | null>(n).fill(null);
  const byXPath: boolean[] = new Array<boolean>(n).fill(false);
  /** Chain index of the xpath parent's segment (`-1` when there is none). */
  const parentDepth: number[] = new Array<number>(n).fill(-1);
  /** Index of the item the chain's first segment names, when it is registered. */
  const anchorOf: Array<number | null> = new Array<number | null>(n).fill(null);
  const needsGeometry: number[] = [];

  const reaches = (from: number, target: number): boolean => {
    const seen = new Set<number>();
    let cur: number | null = from;
    while (cur !== null && !seen.has(cur)) {
      if (cur === target) return true;
      seen.add(cur);
      cur = parent[cur];
    }
    return false;
  };

  for (let i = 0; i < n; i++) {
    const p = parsed[i];
    if (!p || p.ownId) {
      needsGeometry.push(i);
      continue;
    }
    let found: number | null = null;
    let depth = -1;
    // Any key of the chain, its own included, claimed by several items proves
    // the chain repeats (rows under one shared test id): then even a deeper
    // key that one row alone registered cannot say which row this item is in.
    const crossed = p.keys.some(ambiguous);
    for (let k = p.keys.length - 2; k >= 0 && !crossed; k--) {
      const j = lookup(p.keys[k]);
      if (j !== null && j !== i) {
        found = j;
        depth = k;
        break;
      }
    }
    if (found !== null && !reaches(found, i)) {
      parent[i] = found;
      parentDepth[i] = depth;
      byXPath[i] = true;
      const a = lookup(p.keys[0]);
      if (a !== null && a !== i) anchorOf[i] = a;
    } else if (found === null && !crossed && p.keys[0].startsWith('/')) {
      // The chain reaches the document root and nothing above the item is registered.
      byXPath[i] = true;
    } else {
      needsGeometry.push(i);
    }
  }

  for (const i of needsGeometry) {
    const rect = items[i].rect;
    if (rect === null) continue;
    let best: number | null = null;
    let bestArea = Infinity;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const r = items[j].rect;
      // A rect with no area contains nothing (an unlaid-out element is 0x0 at the origin).
      if (r === null || r.w <= 0 || r.h <= 0 || !contains(r, rect)) continue;
      const area = r.w * r.h;
      if (area >= bestArea) continue;
      // Two identical rects contain each other; the one that would close a cycle loses.
      if (reaches(j, i)) continue;
      best = j;
      bestArea = area;
    }
    parent[i] = best;
  }

  // ---- path, landmark and blockKey, parents first ----
  const path: Array<string[] | null | undefined> = new Array(n).fill(undefined);
  /** Whether `path` reaches the document root (every ancestor is known). */
  const complete: boolean[] = new Array<boolean>(n).fill(false);
  const landmark: Array<DensityLandmark | null | undefined> = new Array(n).fill(undefined);
  const blockKey: Array<string | null | undefined> = new Array(n).fill(undefined);
  const visiting = new Set<number>();

  const resolveOne = (i: number): void => {
    if (path[i] !== undefined || visiting.has(i)) return;
    visiting.add(i);
    const p = parsed[i];
    const item = items[i];
    const a = anchorOf[i];
    if (a !== null) resolveOne(a);
    const pa = parent[i];
    const viaParent = pa !== null && byXPath[i];
    if (pa !== null && viaParent) resolveOne(pa);

    // path: the chain's tags above the item, after the anchor's own path.
    let own: string[] | null = null;
    let full = false;
    if (p && !p.ownId) {
      const chainTags = p.tags.slice(0, -1);
      if (a !== null) {
        const anchorTag = items[a].tag !== '' ? items[a].tag : chainTags[0];
        own = [...(path[a] ?? []), anchorTag, ...chainTags.slice(1)];
        full = complete[a];
      } else if (chainTags.length > 0 || p.keys[0].startsWith('/')) {
        // A root chain knows every ancestor; an anchored one knows those below its anchor.
        own = chainTags;
        full = p.keys[0].startsWith('/');
      }
    }
    path[i] = own;
    complete[i] = full;

    // landmark: the innermost candidate wins, measured as the distance above
    // the item (0 is the item itself). At one distance a `[role="…"]` hint of
    // the semantic path beats a tag, because an explicit role overrides it.
    let lm: DensityLandmark | null = landmarkOfRole(item.role);
    if (lm === null && (item.role === null || item.role === 'generic')) {
      lm = landmarkOfTag(item.tag, own, full);
    }
    if (lm === null) {
      let bestDistance = Infinity;
      const consider = (distance: number, found: DensityLandmark | null): void => {
        if (found !== null && distance < bestDistance) {
          bestDistance = distance;
          lm = found;
        }
      };
      // Semantic-path hints: one part per DOM level, the item's own part last.
      for (const hint of semanticRoleHintsByDistance(hints[i].semanticPath)) {
        if (hint.distance > 0) consider(hint.distance, hint.landmark);
      }
      if (own !== null && p) {
        // The chain's own tags are the END of `own`; those after the parent's
        // segment are deeper than the parent, the rest are the parent's to answer.
        const offset = own.length - (p.tags.length - 1);
        const stop = viaParent ? offset + parentDepth[i] + 1 : 0;
        for (let k = own.length - 1; k >= stop; k--) {
          consider(own.length - k, landmarkOfTag(own[k], own.slice(0, k), full));
        }
        // The xpath parent answers for itself and everything above it, at its own distance.
        if (pa !== null && viaParent) {
          consider(p.tags.length - 1 - parentDepth[i], landmark[pa] ?? null);
        }
      }
    }
    landmark[i] = lm;

    // blockKey: the nearest block tag in the chain, self included.
    let bk: string | null = null;
    // A chain with any ambiguous key repeats (rows under one shared test id):
    // its block key would be the same string in every row and merge them all
    // into one block, so it has none.
    // A chain anchored at a `data-testid` that no registered item carries
    // has no block key either: unlike an `id`, a test id may repeat (one per
    // card), and with the anchor unregistered nothing can say which instance
    // an item is in — two cards that each register a different child would
    // share every key below the anchor. Such leaves fall to the heading rule.
    const unprovenAnchor = p !== null && p.keys[0].startsWith('@testid=') && !byKey.has(p.keys[0]);
    if (p && !p.keys.some(ambiguous) && !unprovenAnchor) {
      const tags = p.tags.slice();
      if (tags[tags.length - 1] === '*' || p.ownId) tags[tags.length - 1] = item.tag;
      if (a !== null && tags[0] === '*') tags[0] = items[a].tag;
      for (let k = tags.length - 1; k >= 0; k--) {
        if (!DENSITY_BLOCK_TAGS.includes(tags[k])) continue;
        bk = p.keys[k];
        break;
      }
      if (bk === null && a !== null) bk = blockKey[a] ?? null;
    }
    blockKey[i] = bk;
    visiting.delete(i);
  };
  for (let i = 0; i < n; i++) resolveOne(i);

  const ROW_TAGS = new Set(['li', 'tr']);
  /** The text of chain segment `k` (`li[3]`), read back from the prefix keys. */
  const segmentOf = (p: ParsedChain, k: number): string =>
    k === 0 ? p.keys[0].replace(/^\//, '') : p.keys[k].slice(p.keys[k - 1].length + 1);
  const unindexed = (seg: string): string => seg.replace(/\[\d+\]$/, '');
  /** `[cousinKey, cousinRowKey, whether the row's cell on the way is a th]`, or `[null, null, false]`. */
  const cousinOf = (
    p: (ParsedChain & { ownId: boolean }) | null
  ): [string, string, boolean] | [null, null, false] => {
    if (!p || p.ownId || p.keys.some(ambiguous)) return [null, null, false];
    // An item that is itself a registered list item or table row is a row:
    // the path arm reads it with its siblings, inside whatever group it is in.
    const ownSeg = segmentOf(p, p.keys.length - 1);
    if (/\[\d+\]$/.test(ownSeg) && ROW_TAGS.has(unindexed(ownSeg))) return [null, null, false];
    for (let k = p.keys.length - 2; k >= 0; k--) {
      const seg = segmentOf(p, k);
      // Only a list item or a table row is a row nobody registered: an
      // indexed wrapper div is as likely three unrelated sections.
      if (!/\[\d+\]$/.test(seg) || !ROW_TAGS.has(unindexed(seg))) continue;
      // A registered row is read by the path arm through its own siblings.
      if (lookup(p.keys[k]) !== null) return [null, null, false];
      // Only the registered item nearest the row is its cousin: one registered
      // between the row and this item (a card holding this link) already is.
      for (let j = k + 1; j < p.keys.length - 1; j++) {
        if (lookup(p.keys[j]) !== null) return [null, null, false];
      }
      // Keyed by the row's place alone: every registered item nearest a row
      // (a link in one cell, a value in the next) belongs to that one list.
      return [
        [k > 0 ? p.keys[k - 1] : '', `${unindexed(seg)}[*]`].join('/'),
        p.keys[k],
        unindexed(seg) === 'tr' && unindexed(segmentOf(p, k + 1)) === 'th',
      ];
    }
    return [null, null, false];
  };
  const cousinRows = parsed.map(cousinOf);
  // A table row whose every cousin sits in a `th` is a header row (a table
  // with no `thead` keeps its header row in `tbody`), not a data row — when
  // another row of the same table holds a cell that is not a `th`; a table
  // whose only registered cells are `th` (row headers) keeps them all.
  const rowAllTh = new Map<string, boolean>();
  const groupHasData = new Set<string>();
  for (const [c, r, viaTh] of cousinRows) {
    if (c === null) continue;
    rowAllTh.set(r, (rowAllTh.get(r) ?? true) && viaTh);
    if (!viaTh) groupHasData.add(c);
  }
  const cousins = cousinRows.map(([c, r]): [string, string] | [null, null] =>
    c !== null && !(rowAllTh.get(r) === true && groupHasData.has(c)) ? [c, r] : [null, null]
  );

  // ---- ownChars: direct children only ----
  // `chars` is the WHITESPACE-COLLAPSED length, so the text of a row of k
  // registered spans carries up to k - 1 collapsed separators between them.
  // Those belong to no element; counting them as the row's own text would make
  // every row container a leaf. So up to k - 1 characters are allowed for them
  // (k = children with text), which can undercount a container's own text by
  // as much, never overcount it.
  const childChars: Array<number | null> = new Array<number | null>(n).fill(0);
  const textChildren: number[] = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    const pa = parent[i];
    if (pa === null) continue;
    const c = items[i].chars;
    const cur = childChars[pa];
    childChars[pa] = cur === null || c === null ? null : cur + c;
    if (c !== null && c > 0) textChildren[pa]++;
  }

  return items.map((item, i) => {
    const chars = item.chars;
    const kids = childChars[i];
    const pa = parent[i];
    return {
      ...item,
      parent: pa === null ? null : items[pa].id,
      path: path[i] ?? null,
      structureBy: byXPath[i] ? 'xpath' : 'geometry',
      landmark: landmark[i] ?? null,
      ownChars:
        chars === null || kids === null
          ? null
          : Math.max(0, chars - kids - Math.max(0, textChildren[i] - 1)),
      blockKey: blockKey[i] ?? null,
      siblingKey: parsed[i]?.keys.some(ambiguous) ? null : siblingKeyOf(parsed[i]),
      cousinKey: cousins[i][0],
      cousinRowKey: cousins[i][1],
    };
  });
}

// ============================================================================
// Reading a resolved capture
// ============================================================================

const MEDIA_TAGS = new Set(['img', 'svg', 'video']);

/**
 * The item's rect when a page can lay it out: every coordinate and size finite
 * and within {@link DENSITY_MAX_COORDINATE_PX}; `null` otherwise. Both doors
 * bound a capture (`boundDensityItem`), but these readers take any
 * `DensityCapture`, so a forged rect handed to them directly is no rect,
 * never an Infinity in a pin height or a block extent.
 */
export function densityLayoutRect(item: DensityItem): DensityRect | null {
  const r = item.rect;
  if (r === null) return null;
  const ok = [r.x, r.y, r.w, r.h].every(
    (v) => Number.isFinite(v) && Math.abs(v) <= DENSITY_MAX_COORDINATE_PX
  );
  return ok ? r : null;
}

/** Whether the item is media by tag (`img`, `svg`, `video`). */
export function isDensityMedia(item: DensityItem): boolean {
  return MEDIA_TAGS.has(item.tag);
}

/** Direct registered children of each item, in capture order. */
export function densityChildren(capture: DensityCapture): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const item of capture.items) {
    if (item.parent === null) continue;
    const list = out.get(item.parent);
    if (list) list.push(item.id);
    else out.set(item.parent, [item.id]);
  }
  return out;
}

/** The leaves of a capture, and the items whose leaf status cannot be read. */
export interface DensityLeaves {
  /** Leaf ids in capture order. */
  ids: string[];
  /**
   * Items that might be leaves but whose `ownChars` is `null` (redacted text,
   * or a child whose text is): neither counted as a leaf nor as a container.
   */
  unknown: string[];
}

/**
 * An item is a leaf when `ownChars > 0`, or when it is interactive or media
 * and has no registered descendant.
 */
export function densityLeaves(capture: DensityCapture): DensityLeaves {
  const children = densityChildren(capture);
  const ids: string[] = [];
  const unknown: string[] = [];
  for (const item of capture.items) {
    const childless = !children.has(item.id);
    if ((item.interactive || isDensityMedia(item)) && childless) ids.push(item.id);
    else if (item.ownChars === null) unknown.push(item.id);
    else if (item.ownChars > 0) ids.push(item.id);
  }
  return { ids, unknown };
}

/**
 * Text on containers that the registry does not see: the sum of `ownChars`
 * over items that have registered children. `null` when any of them is `null`.
 */
export function densityUnattributedChars(capture: DensityCapture): number | null {
  const children = densityChildren(capture);
  let sum = 0;
  for (const item of capture.items) {
    if (!children.has(item.id)) continue;
    if (item.ownChars === null) return null;
    sum += item.ownChars;
  }
  return sum;
}

/** What is pinned to the viewport's edges, and the height left between them. */
export interface DensityPins {
  /** Height covered from the top edge by pinned items, px. */
  pinTopPx: number;
  /** Height covered from the bottom edge by pinned items, px. */
  pinBottomPx: number;
  /** `H − pinTop − pinBottom`, px (`Hu`). */
  usableHeightPx: number;
  /** The pinned items, in capture order. */
  ids: string[];
  /**
   * Items wide enough to be a pin whose pin status cannot be read: no computed
   * `position`; a `fixed` or `sticky` item whose visibility is unknown; or any
   * `sticky` item in a capture taken scrolled (a pin is judged at scroll 0,
   * where that item's place is not known). The
   * pin heights above exclude them, so they are lower bounds while this is
   * not empty.
   */
  unknown: string[];
}

/**
 * Pins: items whose `position` is `fixed`, and `sticky` items that touch an
 * edge of the viewport, when they span at least half of `W`. A fixed item
 * belongs to the edge its centre is nearer. A sticky item touches the top edge
 * when its top lies on the bottom of what is already pinned there (the
 * viewport's edge, or a fixed header above it: a bar stuck at `top: 64px`
 * under a 64 px header is pinned too), and the bottom edge likewise. Only
 * registered items can be read (`pinBasis: registered-only` in snapshot mode).
 */
export function densityPins(capture: DensityCapture): DensityPins {
  const W = capture.viewport.width;
  const H = capture.viewport.height;
  const scrollY = capture.viewport.scrollY;
  let top = 0;
  let bottom = 0;
  const pinned = new Set<string>();
  const unknown: string[] = [];
  const sticky: Array<{ id: string; vTop: number; vBottom: number }> = [];
  for (const item of capture.items) {
    const r = densityLayoutRect(item);
    if (r === null || r.w < W / 2) continue;
    if (item.visibility === 'hidden' || item.visibility === 'no-layout') continue;
    const mayPin = item.position === 'fixed' || item.position === 'sticky';
    // No computed position, or a would-be pin whose visibility is unknown.
    if (item.position === null || (mayPin && item.visibility === null)) {
      unknown.push(item.id);
      continue;
    }
    if (item.position === 'sticky' && scrollY !== 0) {
      // Judged at scroll 0, where a sticky item's place is not in a scrolled capture.
      unknown.push(item.id);
      continue;
    }
    const vTop = r.y - scrollY;
    const vBottom = vTop + r.h;
    if (item.position === 'fixed') {
      pinned.add(item.id);
      if (vTop + r.h / 2 <= H / 2) top = Math.max(top, Math.min(H, vBottom));
      else bottom = Math.max(bottom, Math.min(H, H - vTop));
    } else if (item.position === 'sticky') {
      sticky.push({ id: item.id, vTop, vBottom });
    }
  }
  // Sticky bars stack on what is already pinned: top-down from the top edge,
  // bottom-up from the bottom edge, each one moving the edge it lies on.
  for (const s of sticky.slice().sort((a, b) => a.vTop - b.vTop)) {
    if (Math.abs(s.vTop - top) <= 1) {
      pinned.add(s.id);
      top = Math.max(top, Math.min(H, s.vBottom));
    }
  }
  for (const s of sticky.slice().sort((a, b) => b.vBottom - a.vBottom)) {
    if (pinned.has(s.id)) continue;
    if (Math.abs(s.vBottom - (H - bottom)) <= 1) {
      pinned.add(s.id);
      bottom = Math.max(bottom, Math.min(H, H - s.vTop));
    }
  }
  return {
    pinTopPx: top,
    pinBottomPx: bottom,
    usableHeightPx: Math.max(0, H - top - bottom),
    ids: capture.items.filter((i) => pinned.has(i.id)).map((i) => i.id),
    unknown,
  };
}

/**
 * The pinned items and every item inside one, following parent links read
 * from the xpath only (a geometric parent of a fixed bar is an accident of the
 * scroll position, not containment).
 */
export function densityPinnedIds(
  capture: DensityCapture,
  pins: DensityPins = densityPins(capture)
): Set<string> {
  const byId = new Map(capture.items.map((i) => [i.id, i]));
  const pinned = new Set(pins.ids);
  const out = new Set<string>();
  for (const item of capture.items) {
    const seen = new Set<string>();
    let cur: DensityItem | undefined = item;
    while (cur && !seen.has(cur.id)) {
      if (pinned.has(cur.id)) {
        out.add(item.id);
        break;
      }
      seen.add(cur.id);
      if (cur.structureBy !== 'xpath' || cur.parent === null) break;
      cur = byId.get(cur.parent);
    }
  }
  return out;
}

/** Whether two rects share a column: their x-ranges overlap by more than half the narrower width. */
export function densitySameColumn(a: DensityRect, b: DensityRect): boolean {
  const overlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  return overlap > 0.5 * Math.min(a.w, b.w);
}

/** Whether the item is a heading: an `h1`–`h6` tag or role `heading`. */
export function isDensityHeading(item: DensityItem): boolean {
  return /^h[1-6]$/.test(item.tag) || item.role === 'heading';
}

/**
 * The heading level of a heading: `h1`–`h6` by tag; `null` for role `heading`
 * on another tag, whose `aria-level` the capture does not carry (an unknown
 * level, never the ARIA default 2); `null` for a non-heading too.
 */
export function densityHeadingLevel(item: DensityItem): number | null {
  const m = /^h([1-6])$/.exec(item.tag);
  return m ? Number(m[1]) : null;
}

/** How a block was found. */
export type DensityBlockBy = 'declared' | 'path' | 'heading';

/** One block of leaves. */
export interface DensityBlock {
  id: string;
  by: DensityBlockBy;
  /** Member leaf ids, in capture order. */
  members: string[];
  /** Top of the highest member, document px; `null` when no member has a rect. */
  topPx: number | null;
  /** Length of the union of the members' vertical extents, px; `null` when no member has a rect. */
  heightPx: number | null;
  /** Distance to the top of the next block in the same column, px; `null` when there is none. */
  pitchPx: number | null;
  /** The heading block this one sits inside (`by: heading` only); `null` otherwise. */
  parent: string | null;
}

/** A declared block whose matcher selected nothing that can be relied on. */
export interface DensityUnresolvedBlock {
  id: string;
  reason: DensityUnresolvedReason;
}

export interface DensityBlocks {
  /** In document order (top, then declaration order). */
  blocks: DensityBlock[];
  unresolved: DensityUnresolvedBlock[];
  /** Leaves in no block. */
  unblocked: string[];
}

function unionLength(intervals: Array<[number, number]>): number {
  const sorted = intervals.slice().sort((a, b) => a[0] - b[0]);
  let total = 0;
  let curStart = -Infinity;
  let curEnd = -Infinity;
  for (const [s, e] of sorted) {
    if (s > curEnd) {
      if (curEnd > curStart) total += curEnd - curStart;
      curStart = s;
      curEnd = e;
    } else if (e > curEnd) {
      curEnd = e;
    }
  }
  if (curEnd > curStart) total += curEnd - curStart;
  return total;
}

interface Extent {
  top: number;
  bottom: number;
  x: number;
  right: number;
  height: number;
}

/**
 * The members' extent, by loops: a spread argument list has a length ceiling
 * (a block of a few hundred thousand leaves would throw). Only rects a page
 * can lay out count.
 */
function extentOf(members: readonly DensityItem[]): Extent | null {
  let top = Infinity;
  let bottom = -Infinity;
  let x = Infinity;
  let right = -Infinity;
  const spans: Array<[number, number]> = [];
  for (const m of members) {
    const r = densityLayoutRect(m);
    if (r === null) continue;
    top = Math.min(top, r.y);
    bottom = Math.max(bottom, r.y + r.h);
    x = Math.min(x, r.x);
    right = Math.max(right, r.x + r.w);
    spans.push([r.y, r.y + r.h]);
  }
  if (spans.length === 0) return null;
  return { top, bottom, x, right, height: unionLength(spans) };
}

/**
 * Blocks, in this order of precedence for each leaf:
 *
 * 1. a declared `blocks[]` entry of the targets (`by: declared`): the leaves
 *    its matcher selects, and the leaves below them; an earlier entry keeps a
 *    leaf it claims;
 * 2. the nearest `section`, `article`, `aside`, `form`, `fieldset`, `table` or
 *    `dialog` ancestor-or-self in the path (`by: path`);
 * 3. a heading and the leaves below it in its column, up to the next heading
 *    of the same or a higher level (`by: heading`). A lower-level heading opens
 *    a block inside it (`parent`); a heading whose level is unknown (role
 *    `heading` on a non-`h` tag) closes, and is closed by, every heading, so it
 *    nests nothing and inside nothing. A leaf joins a heading's block only within
 *    the heading's landmark, and a pinned leaf (or one inside a pin) joins
 *    none: a footer or a sticky bar below the last heading of a column is not
 *    that heading's content.
 *
 * `heightPx` is the union of the members' extents; `pitchPx` is the distance
 * to the top of the next block in the same column (not one nested in it), so
 * padding counts.
 */
export function densityBlocks(
  capture: DensityCapture,
  targets: DensityTargets | null,
  leaves: DensityLeaves = densityLeaves(capture),
  pinned: Set<string> = densityPinnedIds(capture)
): DensityBlocks {
  const byId = new Map(capture.items.map((i) => [i.id, i]));
  const claimed = new Map<string, string>();
  const blocks: Array<DensityBlock & { order: number }> = [];
  const unresolved: DensityUnresolvedBlock[] = [];
  const parentOf = new Map(capture.items.map((i) => [i.id, i.parent]));
  const hasAncestorIn = (id: string, set: Set<string>): boolean => {
    const seen = new Set<string>();
    let cur = parentOf.get(id) ?? null;
    while (cur !== null && !seen.has(cur)) {
      if (set.has(cur)) return true;
      seen.add(cur);
      cur = parentOf.get(cur) ?? null;
    }
    return false;
  };
  let order = 0;
  const push = (id: string, by: DensityBlockBy, members: string[], parent: string | null) => {
    const ext = extentOf(members.map((m) => byId.get(m)!));
    blocks.push({
      id,
      by,
      members,
      topPx: ext ? ext.top : null,
      heightPx: ext ? ext.height : null,
      pitchPx: null,
      parent,
      order: order++,
    });
  };

  // 1. declared
  for (const decl of targets?.blocks ?? []) {
    const res = resolveDensityMatcher(capture, decl.match);
    if (res.status === 'unresolved') {
      unresolved.push({ id: decl.id, reason: res.reason });
      continue;
    }
    const matched = new Set(res.ids);
    const members = leaves.ids.filter(
      (id) => !claimed.has(id) && (matched.has(id) || hasAncestorIn(id, matched))
    );
    members.forEach((m) => claimed.set(m, decl.id));
    push(decl.id, 'declared', members, null);
  }

  // 2. path
  const byKey = new Map<string, string[]>();
  for (const id of leaves.ids) {
    if (claimed.has(id)) continue;
    const key = byId.get(id)!.blockKey;
    if (key === null) continue;
    const list = byKey.get(key);
    if (list) list.push(id);
    else byKey.set(key, [id]);
  }
  for (const [key, members] of byKey) {
    const blockId = `path:${key}`;
    members.forEach((m) => claimed.set(m, blockId));
    push(blockId, 'path', members, null);
  }

  // 3. heading
  const free = leaves.ids
    .filter((id) => !claimed.has(id) && !pinned.has(id))
    .map((id) => byId.get(id)!)
    .filter((i) => densityLayoutRect(i) !== null);
  // Headings in document order: top, then capture order. A heading's block
  // holds only what comes after it in this order, so two headings at one `y`
  // never list each other, and the nesting below cannot cycle.
  const captureIndex = new Map(capture.items.map((it, i) => [it.id, i]));
  const headings = free
    .filter(isDensityHeading)
    .sort((a, b) => a.rect!.y - b.rect!.y || captureIndex.get(a.id)! - captureIndex.get(b.id)!);
  const rank = new Map(headings.map((h, i) => [h.id, i]));
  /** Whether heading `g` closes heading `h`'s block. An unknown level closes, and is closed by, any heading. */
  const closes = (g: DensityItem, h: DensityItem): boolean => {
    const lg = densityHeadingLevel(g);
    const lh = densityHeadingLevel(h);
    return lg === null || lh === null || lg <= lh;
  };
  const headingMembers = new Map<string, string[]>();
  for (const h of headings) {
    const hr = h.rect!;
    const hRank = rank.get(h.id)!;
    let end = Infinity;
    for (const g of headings) {
      if (rank.get(g.id)! <= hRank) continue;
      if (!densitySameColumn(hr, g.rect!) || g.landmark !== h.landmark) continue;
      if (closes(g, h)) end = Math.min(end, g.rect!.y);
    }
    const members = free
      .filter((l) => {
        if (l === h) return true;
        if (rank.has(l.id) && rank.get(l.id)! < hRank) return false;
        return (
          l.rect!.y >= hr.y &&
          l.rect!.y < end &&
          l.landmark === h.landmark &&
          densitySameColumn(hr, l.rect!)
        );
      })
      .map((l) => l.id);
    headingMembers.set(h.id, members);
  }
  for (const h of headings) {
    // The enclosing heading block: the latest earlier heading that lists this one.
    let parent: string | null = null;
    for (const g of headings) {
      if (rank.get(g.id)! >= rank.get(h.id)!) break;
      if (headingMembers.get(g.id)!.includes(h.id)) parent = `heading:${g.id}`;
    }
    const members = headingMembers.get(h.id)!;
    push(`heading:${h.id}`, 'heading', members, parent);
  }
  const inHeading = new Set<string>();
  for (const m of headingMembers.values()) m.forEach((id) => inHeading.add(id));

  // ---- pitch ----
  const blockParent = new Map(blocks.map((b) => [b.id, b.parent]));
  const nested = (a: string, b: string): boolean => {
    const up = (from: string, target: string) => {
      const seen = new Set<string>();
      let cur = blockParent.get(from) ?? null;
      while (cur !== null && !seen.has(cur)) {
        if (cur === target) return true;
        seen.add(cur);
        cur = blockParent.get(cur) ?? null;
      }
      return false;
    };
    return up(a, b) || up(b, a);
  };
  const extents = new Map(blocks.map((b) => [b.id, extentOf(b.members.map((m) => byId.get(m)!))]));
  for (const b of blocks) {
    const eb = extents.get(b.id);
    if (!eb) continue;
    let next = Infinity;
    for (const o of blocks) {
      if (o === b || nested(b.id, o.id)) continue;
      const eo = extents.get(o.id);
      if (!eo || eo.top <= eb.top) continue;
      const sameColumn = densitySameColumn(
        { x: eb.x, y: eb.top, w: eb.right - eb.x, h: 0 },
        { x: eo.x, y: eo.top, w: eo.right - eo.x, h: 0 }
      );
      if (sameColumn) next = Math.min(next, eo.top);
    }
    b.pitchPx = Number.isFinite(next) ? next - eb.top : null;
  }

  blocks.sort((a, b) => {
    const ta = a.topPx ?? Infinity;
    const tb = b.topPx ?? Infinity;
    return ta !== tb ? ta - tb : a.order - b.order;
  });
  return {
    blocks: blocks.map(({ order: _order, ...b }) => b),
    unresolved,
    unblocked: leaves.ids.filter((id) => !claimed.has(id) && !inHeading.has(id)),
  };
}
