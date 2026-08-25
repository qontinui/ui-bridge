/**
 * Snapshot Signature — the cross-language identity fold for a `BridgeSnapshot`.
 *
 * ## Why this exists
 *
 * A `BridgeSnapshot` used to carry no id and no version, only a wall-clock
 * `snapshotTakenAtMs`. Two snapshots taken a second apart were therefore
 * indistinguishable from two snapshots of *different worlds*, and nothing on
 * the action path could refuse a click that cited a snapshot the caller read
 * two remounts ago. All the SDK could say, after the fact, was "that element
 * is gone" (`UB-STALE-ELEMENT`) — never "your snapshot is old".
 *
 * ## The two folds, and why there are two
 *
 * Every snapshot is folded into **two independent** 64-bit hashes:
 *
 * - **`content`** — what the caller could *see*: each element's `id`,
 *   `category`, `state.textContent` and `state.ariaPressed`. Two snapshots
 *   with the same `content` show the same thing.
 * - **`generation`** — **which mount** each element belongs to: each element's
 *   `id` and its `registeredAt` timestamp. A component that unmounts and
 *   remounts gets a fresh `registeredAt`, so its generation moves even when
 *   nothing observable changed.
 *
 * Holding them apart is the whole point. `count` + `content` equal with a
 * *different* `generation` is precisely a **remount**: the same elements
 * showing the same thing, but they are not the same DOM nodes the caller
 * reasoned about. That is the case a post-hoc "element not found" check can
 * never catch, because the element resolves perfectly well — it is simply a
 * different element. See {@link snapshotRemountedFrom}.
 *
 * The registry deliberately *hides* remounts at the id layer
 * (`preserveIdAcrossRemount` / the recently-removed cache in `registry.ts`),
 * which is a good ergonomic choice and is exactly why callers need this
 * orthogonal signal.
 *
 * ## Spec v1 — NORMATIVE, and reproduced in Rust
 *
 * This fold is a **cross-repo contract**. `qontinui-runner`'s
 * `mcp/ui_bridge/helpers.rs` implements byte-for-byte the same thing, and the
 * two are pinned together by the golden vectors in
 * `core/__fixtures__/snapshot-signature-golden.json`. It deliberately does
 * **not** use a language-default hasher: Rust's `DefaultHasher` is SipHash-1-3
 * under a fixed-but-*unspecified* key whose output is not guaranteed across
 * Rust releases and cannot be reproduced in TypeScript at all. Two
 * independently-derived hashes that can never be compared is the silent-drift
 * failure this module exists to prevent.
 *
 * Iterate `elements` in **array order**. Per element, feed these byte
 * sequences, **in this order**, into the two states:
 *
 * | Field                | Condition          | Bytes                          | Into                    |
 * |----------------------|--------------------|--------------------------------|-------------------------|
 * | `id`                 | is a string        | `utf8(id)` then `0xFF`         | content **and** generation |
 * | `category`           | is a string        | `utf8(category)` then `0xFF`   | content                 |
 * | `state.textContent`  | is a string        | `utf8(value)` then `0xFF`      | content                 |
 * | `state.ariaPressed`  | is a boolean       | one byte, `0x01` / `0x00`      | content                 |
 * | `registeredAt`       | is an integer ≥ 0  | the u64 as 8 bytes **little-endian** | generation        |
 *
 * A field that is **absent or of the wrong type contributes no bytes at all**.
 * That is not laziness — it preserves today's behaviour, where a serializer
 * that omits `registeredAt` simply never reports a remount rather than
 * reporting a spurious one. Note that `ElementState.ariaPressed` is
 * `boolean | 'mixed'`; the tri-state `'mixed'` is not a boolean and so
 * contributes nothing, by the same rule.
 *
 * FNV-1a-64: offset basis `0xcbf29ce484222325`, prime `0x100000001b3`, per
 * byte `h ^= b; h = (h * prime) mod 2^64`. Rendered as 16 lowercase hex chars.
 * `count` is `elements.length`.
 *
 * Strings are folded as UTF-8. A lone surrogate (which cannot be a Rust `str`,
 * and which JSON transport would replace anyway) is folded as U+FFFD, matching
 * `TextEncoder` and therefore matching what the Rust side would ever see.
 *
 * ## Known residual — inherited, not fixed
 *
 * `registeredAt` is **millisecond resolution**. A component that unmounts and
 * remounts inside the same millisecond produces the *same* `registeredAt` and
 * therefore the *same* `generation`, so that remount is invisible to this
 * fold. This residual is documented on the Rust side too (`helpers.rs`) and is
 * carried forward here deliberately rather than silently inherited: anything
 * built on this signature — including the opt-in stale-snapshot rejection in
 * `control/action-executor.ts` — is a **strong guarantee, not a total one**.
 * Do not document it as one.
 *
 * ## Performance
 *
 * Snapshots are taken constantly, so this is a hot path. The 64-bit multiply
 * is done with `Math.imul` and two 32-bit halves; there is **no `BigInt`**
 * anywhere in this file, and no per-byte allocation (strings are folded
 * in place rather than through `TextEncoder`).
 *
 * Measured (Node 24, warm, elements carrying a ~60-char `textContent` each):
 * **0.21 ms** per snapshot at 200 elements and **0.98 ms** at 1000 — about
 * 110 KB of folded bytes per millisecond. Quote the 200-element figure when
 * reasoning about a typical page; the 1000-element figure sits right at 1 ms
 * and is not "well under" it, which is worth knowing before anyone folds
 * something larger. {@link computeMountFold}, the arm the action path uses,
 * is roughly 4x cheaper again (0.05 ms / 0.26 ms) because it never touches
 * `category` or `state`.
 */

// ============================================================================
// Types
// ============================================================================

/**
 * The three-part identity of a snapshot. Mirrors the runner's
 * `SnapshotSignature { count, content, generation }` field-for-field so the
 * two sides compare rather than diverge.
 */
export interface SnapshotSignature {
  /** `elements.length` at snapshot time. */
  count: number;
  /** 16 lowercase hex chars — the fold over what the caller could see. */
  content: string;
  /** 16 lowercase hex chars — the fold over which mount each element is from. */
  generation: string;
}

/**
 * The snapshot identity as it is stamped onto a `BridgeSnapshot`: the
 * content-addressed id plus the structured signature it was rendered from.
 */
export interface SnapshotIdentity {
  /** See {@link formatSnapshotId}. */
  snapshotId: string;
  /** The signature the id was rendered from. */
  signature: SnapshotSignature;
}

/**
 * The structural shape the fold reads. Deliberately loose (`unknown`-typed
 * fields, everything optional) because the same fold runs over
 * `BridgeSnapshot['elements']`, over live `RegisteredElement`s, and over raw
 * JSON that arrived off the wire — and the spec's "wrong type contributes no
 * bytes" rule is only meaningful if wrongly-typed input can actually reach it.
 */
export interface SignatureElementLike {
  id?: unknown;
  category?: unknown;
  state?: { textContent?: unknown; ariaPressed?: unknown } | null | unknown;
  registeredAt?: unknown;
}

// ============================================================================
// FNV-1a-64
// ============================================================================

/** FNV-1a-64 offset basis `0xcbf29ce484222325`, split into two uint32 halves. */
const FNV_BASIS_HI = 0xcbf29ce4;
const FNV_BASIS_LO = 0x84222325;

/**
 * FNV-1a-64 prime `0x100000001b3` factored as `2^40 + 0x1b3`.
 *
 * That factoring is what lets the multiply avoid `BigInt` *and* avoid a
 * general 64×64 limb multiply. For `h = hi·2^32 + lo`:
 *
 * - `h · 2^40 mod 2^64` keeps only `lo`'s low 24 bits, landing them at bit 40
 *   — i.e. the whole product is `((lo << 8) mod 2^32)` in the HIGH word and
 *   zero in the low word. (`hi · 2^72` is a multiple of `2^64` and vanishes.)
 * - `h · 0x1b3` is two 32×9-bit products, both exactly representable as
 *   doubles, so the carry out of the low word is exact.
 *
 * Two multiplies per byte instead of sixteen.
 */
const FNV_PRIME_LOW = 0x1b3;

/** `2^32`, as the divisor that extracts the carry out of the low word. */
const TWO_32 = 4294967296;

/**
 * Mutable FNV-1a-64 state held as two uint32 halves.
 *
 * A class rather than a closure or a tuple: the fold is per-element per-field,
 * so this is allocated once per snapshot (twice, in fact — content and
 * generation) and then only mutated.
 */
class Fnv1a64 {
  private hi = FNV_BASIS_HI;
  private lo = FNV_BASIS_LO;

  /** Fold one byte. `b` must already be in `0..255`. */
  byte(b: number): void {
    // h ^= b — the byte only ever touches the low word.
    const lo = (this.lo ^ b) >>> 0;
    const hi = this.hi;
    // h *= prime, as (h << 40) + h * 0x1b3, mod 2^64.
    const product = lo * FNV_PRIME_LOW; // < 2^41 — exact in a double
    const nextLo = product >>> 0; // ToUint32 == mod 2^32
    const carry = (product - nextLo) / TWO_32; // exact integer < 2^9
    // Math.imul gives the low 32 bits of hi * 0x1b3; `(lo << 8) >>> 0` is the
    // `h << 40` term's contribution to the high word. Everything below is
    // mod-2^32 arithmetic, so the signed intermediate from imul is fine.
    this.hi = (Math.imul(hi, FNV_PRIME_LOW) + carry + ((lo << 8) >>> 0)) >>> 0;
    this.lo = nextLo;
  }

  /**
   * Fold a string as UTF-8, without allocating an intermediate byte array.
   * Lone surrogates are folded as U+FFFD — see the module doc.
   */
  utf8(value: string): void {
    for (let i = 0; i < value.length; i++) {
      const c = value.charCodeAt(i);
      if (c < 0x80) {
        this.byte(c);
      } else if (c < 0x800) {
        this.byte(0xc0 | (c >> 6));
        this.byte(0x80 | (c & 0x3f));
      } else if (c >= 0xd800 && c <= 0xdbff) {
        const next = i + 1 < value.length ? value.charCodeAt(i + 1) : 0;
        if (next >= 0xdc00 && next <= 0xdfff) {
          const cp = 0x10000 + ((c - 0xd800) << 10) + (next - 0xdc00);
          i++;
          this.byte(0xf0 | (cp >> 18));
          this.byte(0x80 | ((cp >> 12) & 0x3f));
          this.byte(0x80 | ((cp >> 6) & 0x3f));
          this.byte(0x80 | (cp & 0x3f));
        } else {
          this.replacementChar();
        }
      } else if (c >= 0xdc00 && c <= 0xdfff) {
        // Unpaired low surrogate.
        this.replacementChar();
      } else {
        this.byte(0xe0 | (c >> 12));
        this.byte(0x80 | ((c >> 6) & 0x3f));
        this.byte(0x80 | (c & 0x3f));
      }
    }
  }

  /** U+FFFD REPLACEMENT CHARACTER, the UTF-8 encoder's lone-surrogate output. */
  private replacementChar(): void {
    this.byte(0xef);
    this.byte(0xbf);
    this.byte(0xbd);
  }

  /**
   * Fold a non-negative integer as a u64 in **little-endian** byte order.
   *
   * Values above `2^53` cannot be represented exactly by a JS number in the
   * first place; the split below is still deterministic for whatever double
   * actually arrived, which is the most any JS implementation can promise.
   */
  u64le(value: number): void {
    const low = value >>> 0;
    const high = Math.floor(value / TWO_32) >>> 0;
    this.byte(low & 0xff);
    this.byte((low >>> 8) & 0xff);
    this.byte((low >>> 16) & 0xff);
    this.byte((low >>> 24) & 0xff);
    this.byte(high & 0xff);
    this.byte((high >>> 8) & 0xff);
    this.byte((high >>> 16) & 0xff);
    this.byte((high >>> 24) & 0xff);
  }

  /** Render as exactly 16 lowercase hex chars. */
  hex(): string {
    return this.hi.toString(16).padStart(8, '0') + this.lo.toString(16).padStart(8, '0');
  }
}

// ============================================================================
// The fold
// ============================================================================

/** Field terminator. `0xFF` is not a legal UTF-8 byte, so it cannot collide. */
const FIELD_TERMINATOR = 0xff;

/** Read `state.textContent` / `state.ariaPressed` off a loosely-typed element. */
function readState(
  element: SignatureElementLike
): { textContent?: unknown; ariaPressed?: unknown } | undefined {
  const state = element.state;
  return state !== null && typeof state === 'object'
    ? (state as { textContent?: unknown; ariaPressed?: unknown })
    : undefined;
}

/**
 * Compute the full spec-v1 signature over a snapshot's element array.
 *
 * See the module doc for the normative byte order. Callers that only need the
 * mount half — and cannot afford to serialize `state` — want
 * {@link computeMountFold} instead.
 */
export function computeSnapshotSignature(
  elements: readonly SignatureElementLike[]
): SnapshotSignature {
  const content = new Fnv1a64();
  const generation = new Fnv1a64();

  for (let i = 0; i < elements.length; i++) {
    const element = elements[i];
    const id = element.id;
    if (typeof id === 'string') {
      content.utf8(id);
      content.byte(FIELD_TERMINATOR);
      generation.utf8(id);
      generation.byte(FIELD_TERMINATOR);
    }
    const category = element.category;
    if (typeof category === 'string') {
      content.utf8(category);
      content.byte(FIELD_TERMINATOR);
    }
    const state = readState(element);
    if (state !== undefined) {
      const textContent = state.textContent;
      if (typeof textContent === 'string') {
        content.utf8(textContent);
        content.byte(FIELD_TERMINATOR);
      }
      const ariaPressed = state.ariaPressed;
      if (typeof ariaPressed === 'boolean') {
        content.byte(ariaPressed ? 0x01 : 0x00);
      }
    }
    const registeredAt = element.registeredAt;
    if (typeof registeredAt === 'number' && Number.isInteger(registeredAt) && registeredAt >= 0) {
      generation.u64le(registeredAt);
    }
  }

  return {
    count: elements.length,
    content: content.hex(),
    generation: generation.hex(),
  };
}

/**
 * Compute **only** the `count` + `generation` half of the signature.
 *
 * This is the arm the action path can afford. The content fold needs
 * `state.textContent` / `state.ariaPressed`, which on a live registry means
 * calling `getState()` per element — that forces layout and is exactly the
 * cost a snapshot pays deliberately and an action must not pay incidentally.
 * The generation fold needs only `id` and `registeredAt`, both of which are
 * plain fields on a `RegisteredElement`: no DOM reads at all.
 *
 * Because the generation fold reads the same two fields that
 * `serializeRegisteredElement` emits verbatim, this reproduces a stamped
 * snapshot's `generation` **exactly** when nothing has changed — it is a
 * cheaper projection of the same spec, not a second definition of it.
 */
export function computeMountFold(elements: readonly SignatureElementLike[]): {
  count: number;
  generation: string;
} {
  const generation = new Fnv1a64();
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i];
    const id = element.id;
    if (typeof id === 'string') {
      generation.utf8(id);
      generation.byte(FIELD_TERMINATOR);
    }
    const registeredAt = element.registeredAt;
    if (typeof registeredAt === 'number' && Number.isInteger(registeredAt) && registeredAt >= 0) {
      generation.u64le(registeredAt);
    }
  }
  return { count: elements.length, generation: generation.hex() };
}

// ============================================================================
// Ids
// ============================================================================

/** Version tag on every snapshot id. Bump only if spec v1's fold changes. */
export const SNAPSHOT_ID_PREFIX = 'ubs1';

/**
 * Render a signature as a snapshot id: `` `ubs1_${count36}_${content}_${generation}` ``.
 *
 * **Content-addressed, not a counter.** The AI layer's older
 * `snapshot-<counter>-<Date.now()>` (`ai/semantic-snapshot.ts`) is minted from
 * a per-instance counter, so two processes hand out the same id for different
 * worlds. This one is a function of the elements alone: two ids from anywhere
 * are directly comparable, and the id by itself answers both questions the
 * runner's `unchanged_from` / `remounted_from` answer — see
 * {@link snapshotUnchangedFrom} and {@link snapshotRemountedFrom}.
 */
export function formatSnapshotId(signature: SnapshotSignature): string {
  return `${SNAPSHOT_ID_PREFIX}_${signature.count.toString(36)}_${signature.content}_${signature.generation}`;
}

/**
 * Parse a snapshot id back into its signature, or `null` if it is not a
 * well-formed spec-v1 id.
 *
 * Returning `null` rather than throwing is deliberate: ids arrive off the wire
 * from callers this SDK does not control, and an unparseable one means "I
 * cannot judge this", never "this is stale".
 */
export function parseSnapshotId(snapshotId: string): SnapshotSignature | null {
  if (typeof snapshotId !== 'string') return null;
  const parts = snapshotId.split('_');
  if (parts.length !== 4) return null;
  const [prefix, count36, content, generation] = parts;
  if (prefix !== SNAPSHOT_ID_PREFIX) return null;
  if (!/^[0-9a-z]+$/.test(count36)) return null;
  if (!/^[0-9a-f]{16}$/.test(content) || !/^[0-9a-f]{16}$/.test(generation)) return null;
  const count = parseInt(count36, 36);
  if (!Number.isInteger(count) || count < 0) return null;
  return { count, content, generation };
}

/**
 * Compute a snapshot's full identity — the signature and the id rendered from
 * it. This is the one call `createSnapshot`-shaped code should make.
 */
export function computeSnapshotIdentity(
  elements: readonly SignatureElementLike[]
): SnapshotIdentity {
  const signature = computeSnapshotSignature(elements);
  return { snapshotId: formatSnapshotId(signature), signature };
}

// ============================================================================
// Comparison — mirrors the runner's `unchanged_from` / `remounted_from`
// ============================================================================

/** Accept either a parsed signature or the id string that renders to one. */
function asSignature(value: SnapshotSignature | string): SnapshotSignature | null {
  return typeof value === 'string' ? parseSnapshotId(value) : value;
}

/**
 * `true` when nothing observable changed **and** nothing remounted — the two
 * snapshots are, as far as this fold can tell, the same world.
 *
 * Mirrors the runner's `SnapshotSignature::unchanged_from`. Equal snapshot ids
 * are exactly this predicate, which is why the id is content-addressed.
 *
 * An unparseable id yields `false`: unknown is not "unchanged".
 */
export function snapshotUnchangedFrom(
  current: SnapshotSignature | string,
  previous: SnapshotSignature | string
): boolean {
  const a = asSignature(current);
  const b = asSignature(previous);
  if (!a || !b) return false;
  return a.count === b.count && a.content === b.content && a.generation === b.generation;
}

/**
 * `true` when the elements are the same and show the same thing, but they
 * belong to a **different mount** — a remount.
 *
 * Mirrors the runner's `SnapshotSignature::remounted_from`. This is the
 * predicate the whole stale-snapshot story turns on: the element the caller
 * cited still resolves, still looks identical, and is nonetheless not the node
 * the caller reasoned about.
 *
 * Subject to the millisecond residual documented at the top of this file — a
 * remount completed inside one millisecond is invisible here.
 */
export function snapshotRemountedFrom(
  current: SnapshotSignature | string,
  previous: SnapshotSignature | string
): boolean {
  const a = asSignature(current);
  const b = asSignature(previous);
  if (!a || !b) return false;
  return a.count === b.count && a.content === b.content && a.generation !== b.generation;
}
