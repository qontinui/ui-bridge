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
 * ## `mountEvidence` — because "no remount" and "cannot see remounts" are not the same answer
 *
 * The skip rule above has a consequence the fold must not hide. A payload in
 * which **no element carries `registeredAt`** folds a `generation` over ids
 * alone. Such a generation is not *wrong*, it is **uninformative**: it cannot
 * move on a remount, so a caller comparing it and finding it equal learns
 * nothing at all — and yet, read naively, "the generation matched" reads
 * exactly like "nothing remounted". Silence would be indistinguishable from
 * a clean bill of health, which is the failure this whole module exists to
 * prevent, one level up.
 *
 * So the signature carries {@link SnapshotSignature.mountEvidence}: how many
 * of the `count` elements actually contributed a `registeredAt`. Zero means
 * the generation half has **no standing to testify**. It is folded into the
 * id (see {@link formatSnapshotId}) rather than left on the payload alone,
 * because the id is the only part of a snapshot that survives the round trip
 * back through `ControlActionRequest.fromSnapshotId` — a freshness gate that
 * cannot recover it would have to either trust an ids-only generation (a
 * spurious PASS) or reject on its mismatch (a spurious REFUSAL), and both are
 * worse than saying "I cannot judge". See {@link generationComparable}.
 *
 * This is also the older-deployed-app case: a runner driving an app built
 * before the SDK emitted `registeredAt` on its find/discover payload gets
 * `mountEvidence: 0` and is told so, instead of being quietly told everything
 * is fine.
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
  /**
   * How many of the `count` elements contributed a `registeredAt` to
   * {@link SnapshotSignature.generation}.
   *
   * **Zero means the generation half is uninformative, NOT that nothing
   * remounted.** A payload whose serializer omits `registeredAt` folds a
   * generation over ids alone; it cannot move on a remount, so its equality
   * proves nothing. Consumers must read a zero here as *"cannot judge"* and
   * never as freshness — the same absence-is-not-zero discipline the rest of
   * this module applies to an unparseable id.
   *
   * A value strictly between `0` and `count` means the generation half can
   * testify about *some* elements only: a mixed payload (SDK-registered
   * elements alongside DOM-scanned ones, which have no registration time to
   * report) is the normal way that happens.
   *
   * This field has no equivalent in the runner's Rust `SnapshotSignature`,
   * which compares two folds it computed itself in the same process and so
   * never faces the round-trip question this answers. It does not change the
   * `content` / `generation` bytes, so the cross-language fold contract is
   * untouched.
   */
  mountEvidence: number;
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

// ============================================================================
// Freshness verdict — the honest three-valued answer
// ============================================================================

/**
 * The three answers a freshness check can give.
 *
 * - `fresh` — every arm that could run ran, and all of them agreed the cited
 *   snapshot still describes this UI.
 * - `superseded` — an arm **proved** it does not. The action citing it was
 *   refused before it ran.
 * - `indeterminate` — at least one arm could not run at all, and no arm that
 *   did run found anything wrong. **The action was executed** (fail-open on
 *   unknown is the correct direction here — the caller asked for a freshness
 *   check, not for a ban on actions this SDK has no opinion about) but nothing
 *   verified it. This is the value that exists so fail-open stops being
 *   *silent*: without it, "cannot judge" and "verified fresh" were the same
 *   observation — a `success: true` with no comment.
 */
export type SnapshotFreshnessVerdict = 'fresh' | 'superseded' | 'indeterminate';

/** Which arm proved the cited snapshot superseded. */
export type SnapshotFreshnessArm =
  /** The number of registered elements changed. */
  | 'element-set'
  /** Same elements, different mounts — the caller's nodes were rebuilt. */
  | 'remount'
  /** A newer stamped snapshot shows different `content`. */
  | 'content';

/**
 * Why an arm could not run. Each of these is a genuine *absence of evidence*;
 * none of them is evidence of freshness.
 */
export type SnapshotFreshnessBlindSpot =
  /** The cited id is not a well-formed spec id (wrong grammar, or an older one). */
  | 'unparseable-snapshot-id'
  /** Nothing was registered on either side — there is no world to compare. */
  | 'empty-element-set'
  /**
   * The cited snapshot folded **no** `registeredAt` at all, so its `generation`
   * is over ids alone and cannot move on a remount. The classic cause is a
   * driver holding an id minted by an app whose find/discover serializer does
   * not emit `registeredAt` — an older deployed build.
   */
  | 'cited-snapshot-has-no-mount-evidence'
  /** The live element set folded no `registeredAt` — see the cited-side twin. */
  | 'live-element-set-has-no-mount-evidence'
  /** The registry does not implement a live mount fold. */
  | 'no-live-mount-fold'
  /** This registry has never stamped a snapshot, so the content arm is mute. */
  | 'no-stamped-snapshot';

/**
 * The verdict a freshness check reports, and the record of how it got there.
 *
 * Surfaced on the action response as `snapshotFreshness`, following the
 * `effectVerification` precedent: one optional nested object, present only
 * when it applies — here, only when the caller supplied
 * `ControlActionRequest.fromSnapshotId`.
 */
export interface SnapshotFreshness {
  /** The id the caller passed as `fromSnapshotId`, echoed verbatim. */
  citedSnapshotId: string;
  /** See {@link SnapshotFreshnessVerdict}. */
  verdict: SnapshotFreshnessVerdict;
  /** Set iff `verdict === 'superseded'`. */
  supersededBy?: SnapshotFreshnessArm;
  /**
   * Set iff `verdict === 'indeterminate'` — every arm that could not run, so a
   * caller can tell "I am talking to an old build" apart from "this registry
   * has never been snapshotted". Never empty when present.
   */
  blindTo?: SnapshotFreshnessBlindSpot[];
  /** One human-readable sentence naming what was (or was not) established. */
  detail: string;
  /**
   * The id of the most recent snapshot this registry stamped, when it has
   * stamped one. Absent otherwise — which is itself reported via the
   * `no-stamped-snapshot` blind spot rather than as a missing field.
   */
  currentSnapshotId?: string;
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
  let mountEvidence = 0;

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
      mountEvidence++;
    }
  }

  return {
    count: elements.length,
    content: content.hex(),
    generation: generation.hex(),
    mountEvidence,
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
  mountEvidence: number;
} {
  const generation = new Fnv1a64();
  let mountEvidence = 0;
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
      mountEvidence++;
    }
  }
  return { count: elements.length, generation: generation.hex(), mountEvidence };
}

// ============================================================================
// Ids
// ============================================================================

/**
 * Version tag on every snapshot id. Bump when the **id grammar** changes.
 *
 * `ubs2` added the `mountEvidence` segment; the fold itself (spec v1, the
 * cross-language contract mirrored in Rust) is unchanged, which is why the
 * `content`/`generation` golden vectors did not move when this bumped. A
 * `ubs1` id parses to `null` — deliberately, because a `ubs1` id carries no
 * evidence count and the gate would have to guess whether its generation was
 * ids-only. `null` routes it to the honest "cannot judge" arm instead.
 */
export const SNAPSHOT_ID_PREFIX = 'ubs2';

/**
 * Render a signature as a snapshot id:
 * `` `ubs2_${count36}_${mountEvidence36}_${content}_${generation}` ``.
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
  return (
    `${SNAPSHOT_ID_PREFIX}_${signature.count.toString(36)}` +
    `_${signature.mountEvidence.toString(36)}_${signature.content}_${signature.generation}`
  );
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
  if (parts.length !== 5) return null;
  const [prefix, count36, evidence36, content, generation] = parts;
  if (prefix !== SNAPSHOT_ID_PREFIX) return null;
  if (!/^[0-9a-z]+$/.test(count36) || !/^[0-9a-z]+$/.test(evidence36)) return null;
  if (!/^[0-9a-f]{16}$/.test(content) || !/^[0-9a-f]{16}$/.test(generation)) return null;
  const count = parseInt(count36, 36);
  if (!Number.isInteger(count) || count < 0) return null;
  const mountEvidence = parseInt(evidence36, 36);
  // `mountEvidence` counts elements, so it cannot exceed `count`. An id that
  // says otherwise was not minted by this fold; treat it as unparseable rather
  // than reasoning from it.
  if (!Number.isInteger(mountEvidence) || mountEvidence < 0 || mountEvidence > count) return null;
  return { count, content, generation, mountEvidence };
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

/**
 * The two facts a freshness check reads off the world it is judging against.
 *
 * Passed in rather than fetched so the evaluation is a pure function of
 * (citation, world) — the SAME evaluation then serves both action paths in
 * this SDK: `DefaultActionExecutor.executeAction` and the injected/relay
 * `executeElementAction` in `react/commandHandlers.ts`, which is a wholly
 * separate DOM implementation that never touches the executor. Two copies of
 * this logic would drift, and a freshness gate that answers differently
 * depending on which transport the caller happened to reach is worse than one
 * that does not exist.
 */
export interface SnapshotFreshnessWorld {
  /**
   * The live `count` + `generation` + `mountEvidence` over what is registered
   * right now — `UIBridgeRegistry.computeLiveMountFold()`. Absent/null means
   * this world cannot produce one, which is a blind spot, not a pass.
   */
  liveMountFold?: { count: number; generation: string; mountEvidence: number } | null;
  /**
   * The most recent snapshot identity stamped by the registry, or null if it
   * has never stamped one. Null is UNKNOWN, not freshness.
   */
  lastSnapshotIdentity?: SnapshotIdentity | null;
}

/**
 * Decide whether a caller-cited snapshot id still describes this UI.
 *
 * ## What it can prove cheaply, and what it deliberately does not
 *
 * The honest definition of "superseded" is *"the identity the caller cited is
 * not the identity of the current UI state"*. Recomputing that identity in
 * full would mean re-serializing every element — `state.textContent` /
 * `state.ariaPressed` come from `getState()`, which forces layout per element.
 * That is a cost a snapshot pays deliberately and an action must not pay
 * incidentally, so this uses two cheap arms instead:
 *
 * 1. **The live mount fold** — reads only `id` and `registeredAt`, no DOM
 *    access at all, and reproduces a stamped snapshot's `count`/`generation`
 *    EXACTLY when nothing has changed. A `count` mismatch means the element
 *    set churned; a `generation` mismatch on a matching count is a
 *    **remount**: the same elements, possibly showing exactly the same thing,
 *    but not the same DOM nodes the caller reasoned about. That is the case
 *    the pre-existing "element not found" check can never catch, because the
 *    element resolves.
 * 2. **A newer stamped snapshot** — available only once the registry has
 *    stamped at least one. If the most recent one carries a different id while
 *    count and generation match, the difference is in `content`: what the
 *    caller could see has changed.
 *
 * What escapes both arms is a content change with no intervening snapshot —
 * nothing observed it, so nothing can prove it. Plus the inherited millisecond
 * residual: `registeredAt` is millisecond-resolution, so a remount completed
 * inside one millisecond leaves `generation` untouched. Callers get a strong
 * freshness signal, **not a total guarantee**.
 *
 * ## Unknown is not stale — and unknown is not fresh either
 *
 * An id this SDK cannot parse, a registry that has never stamped a snapshot, a
 * cited snapshot whose serializer never emitted `registeredAt`: none of these
 * is `superseded`. Refusing on "cannot judge" would fail closed on the wrong
 * axis — the caller opted into a freshness check, not into a ban on actions
 * this SDK has no opinion about.
 *
 * But none of them is `fresh` either, and that is the half a first cut of this
 * gate got wrong. A blind arm returning "not superseded" is indistinguishable,
 * at the call site, from an arm that ran and found the world unmoved — so the
 * caller receives `success: true` **with a freshness guarantee attached that
 * was never actually checked**. That is strictly worse than not offering the
 * guarantee, because it is trusted.
 *
 * So the verdict is three-valued and every arm that could not run is named in
 * `blindTo`. `indeterminate` still lets the action proceed — the fail-open
 * direction is right — it just stops failing open in silence. The concrete
 * case that motivates it: a driver citing an id minted by an older deployed
 * app, whose find/discover payload carried no `registeredAt`, so its
 * `generation` folded ids alone and could never have moved on a remount.
 */
export function evaluateSnapshotFreshness(
  citedSnapshotId: string,
  world: SnapshotFreshnessWorld
): SnapshotFreshness {
  const last = world.lastSnapshotIdentity ?? null;
  const currentSnapshotId = last?.snapshotId;

  const cited = parseSnapshotId(citedSnapshotId);
  if (!cited) {
    return {
      citedSnapshotId,
      verdict: 'indeterminate',
      blindTo: ['unparseable-snapshot-id'],
      detail:
        `'${citedSnapshotId}' is not a ${SNAPSHOT_ID_PREFIX} snapshot id, so no arm could ` +
        `evaluate it. The action ran, but its freshness was NOT verified — re-read ` +
        `the snapshotId field off a snapshot taken by this SDK to get a checkable citation.`,
      ...(currentSnapshotId !== undefined ? { currentSnapshotId } : {}),
    };
  }

  const blindTo: SnapshotFreshnessBlindSpot[] = [];
  const live = world.liveMountFold ?? null;
  if (!live) {
    blindTo.push('no-live-mount-fold');
  } else {
    if (live.count !== cited.count) {
      return {
        citedSnapshotId,
        verdict: 'superseded',
        supersededBy: 'element-set',
        detail: `the registered element set changed (${cited.count} elements when the snapshot was taken, ${live.count} now)`,
        ...(currentSnapshotId !== undefined ? { currentSnapshotId } : {}),
      };
    }
    // The remount arm needs BOTH sides to have folded at least one
    // `registeredAt`. Comparing an ids-only generation against one that
    // includes registration times is not a weaker check — it is a meaningless
    // one, wrong in both directions: equal proves nothing, and unequal would
    // accuse a perfectly current snapshot of a remount. See
    // {@link generationComparable}.
    if (cited.count === 0 && live.count === 0) {
      blindTo.push('empty-element-set');
    } else if (cited.mountEvidence === 0) {
      blindTo.push('cited-snapshot-has-no-mount-evidence');
    } else if (live.mountEvidence === 0) {
      blindTo.push('live-element-set-has-no-mount-evidence');
    } else if (live.generation !== cited.generation) {
      return {
        citedSnapshotId,
        verdict: 'superseded',
        supersededBy: 'remount',
        detail: `the same ${cited.count} elements now belong to a different mount (generation ${cited.generation} -> ${live.generation}), so the target may not be the element the snapshot described`,
        ...(currentSnapshotId !== undefined ? { currentSnapshotId } : {}),
      };
    }
  }

  if (!last) {
    blindTo.push('no-stamped-snapshot');
  } else if (last.snapshotId !== citedSnapshotId) {
    return {
      citedSnapshotId,
      verdict: 'superseded',
      supersededBy: 'content',
      detail: `a newer snapshot (${last.snapshotId}) shows different content`,
      currentSnapshotId: last.snapshotId,
    };
  }

  if (blindTo.length > 0) {
    return {
      citedSnapshotId,
      verdict: 'indeterminate',
      blindTo,
      detail:
        `no arm could confirm this snapshot is current (${blindTo.join(', ')}). ` +
        `The action ran — unknown is not stale — but treat this as "cannot judge", ` +
        `not as a freshness guarantee.`,
      ...(currentSnapshotId !== undefined ? { currentSnapshotId } : {}),
    };
  }

  return {
    citedSnapshotId,
    verdict: 'fresh',
    detail: `the cited snapshot still describes this UI (${cited.count} elements, generation ${cited.generation} unchanged)`,
    ...(currentSnapshotId !== undefined ? { currentSnapshotId } : {}),
  };
}

/**
 * The message an action path emits when it refuses a superseded citation.
 *
 * Shared so the executor and the injected/relay handler say the same thing —
 * a driver that gets different prose depending on which transport it reached
 * cannot pattern-match the failure.
 */
export function supersededSnapshotMessage(freshness: SnapshotFreshness, elementId: string): string {
  return (
    `Snapshot '${freshness.citedSnapshotId}' is superseded: ${freshness.detail}. ` +
    `The action on '${elementId}' was refused before it ran because it was reasoned ` +
    `from a snapshot that no longer describes this UI. Take a fresh snapshot and ` +
    `re-resolve the target from it before retrying.`
  );
}

// ============================================================================
// Comparison — mirrors the runner's `unchanged_from` / `remounted_from`
// ============================================================================

/** Accept either a parsed signature or the id string that renders to one. */
function asSignature(value: SnapshotSignature | string): SnapshotSignature | null {
  return typeof value === 'string' ? parseSnapshotId(value) : value;
}

/**
 * `true` when the two signatures' `generation` halves can meaningfully be
 * compared at all — i.e. **both** folded at least one `registeredAt`.
 *
 * This is the predicate that separates *"nothing remounted"* from *"I cannot
 * see remounts"*. When it is `false`, a generation **match** proves nothing
 * (an ids-only generation cannot move on a remount) and a generation
 * **mismatch** proves nothing either (one side folded registration times and
 * the other did not, so they were never going to agree). Both readings are
 * wrong in opposite directions, which is why every consumer of
 * {@link snapshotRemountedFrom} must consult this first if it intends to
 * report a verdict rather than a boolean.
 *
 * An unparseable id yields `false` — unknown is not comparable.
 */
export function generationComparable(
  current: SnapshotSignature | string,
  previous: SnapshotSignature | string
): boolean {
  const a = asSignature(current);
  const b = asSignature(previous);
  if (!a || !b) return false;
  return a.mountEvidence > 0 && b.mountEvidence > 0;
}

/**
 * `true` when nothing observable changed **and** nothing remounted — the two
 * snapshots are, as far as this fold can tell, the same world.
 *
 * Mirrors the runner's `SnapshotSignature::unchanged_from`. Equal snapshot ids
 * are exactly this predicate, which is why the id is content-addressed.
 *
 * An unparseable id yields `false`: unknown is not "unchanged".
 *
 * ⚠️ `true` from a pair with no mount evidence ({@link generationComparable}
 * `=== false`) means only *"nothing the fold could see changed"* — and what it
 * could see was ids and content, never mounts. Check
 * {@link generationComparable} before reporting this as "the same world".
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
 *
 * ⚠️ `false` is **"not proven"**, not "did not happen". It is returned both
 * when the mounts genuinely match and when the two generations were never
 * comparable in the first place ({@link generationComparable} `=== false`) —
 * without that guard a snapshot whose serializer omits `registeredAt` would
 * report a remount on every comparison against one that emits it, which is a
 * spurious accusation rather than a missed one. A caller that reports a
 * verdict to a human or refuses an action on this must consult
 * {@link generationComparable} and say "cannot judge" instead.
 */
export function snapshotRemountedFrom(
  current: SnapshotSignature | string,
  previous: SnapshotSignature | string
): boolean {
  const a = asSignature(current);
  const b = asSignature(previous);
  if (!a || !b) return false;
  if (a.mountEvidence === 0 || b.mountEvidence === 0) return false;
  return a.count === b.count && a.content === b.content && a.generation !== b.generation;
}
