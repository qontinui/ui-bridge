/**
 * Shared, code-point-safe text truncation for the UI Bridge SDK.
 *
 * Every user-facing string the SDK puts on the wire (`textContent`,
 * `accessibleName`, error-overlay messages, toast text, AI summaries, …) is
 * length-capped somewhere. Doing that with `String.prototype.slice` /
 * `.substring` operates on **UTF-16 code units**, so an astral character (any
 * emoji >= U+10000 — a surrogate *pair*) that straddles the cut index is split
 * in half. The survivor is a **lone surrogate**: `JSON.stringify` emits it as an
 * invalid `\uXXXX` escape without throwing, and any strict-UTF-8 consumer — most
 * importantly the Rust runner, whose `String` cannot hold a lone surrogate —
 * then fails to parse the *entire* response. One emoji at one boundary breaks a
 * whole snapshot.
 */

/**
 * Truncate `s` to at most `n` Unicode **code points**, never splitting a
 * surrogate pair.
 *
 * Code-point semantics deliberately match the Rust runner's `chars().take(n)`
 * (`qontinui-runner/src-tauri/src/mcp/ui_bridge/screenshots.rs`) so that `n`
 * means the same thing on both sides of the wire.
 *
 * Scans at most `2n` code units — unlike `[...s].slice(0, n).join('')` it never
 * materializes a code-point array for the whole string, which matters for the
 * large `textContent` reads on the snapshot path.
 *
 * A lone surrogate **already present in the input** is passed through as a
 * single code point. That is pre-existing invalid input, not truncation damage;
 * sanitizing it is deliberately out of scope.
 */
export function truncateCodePoints(s: string, n: number): string {
  if (n <= 0) return '';
  // A code point is >= 1 code unit, so a string this short can never need a cut.
  if (s.length <= n) return s;

  let i = 0;
  for (let count = 0; i < s.length && count < n; count++) {
    const hi = s.charCodeAt(i);
    const isPair =
      hi >= 0xd800 &&
      hi <= 0xdbff &&
      i + 1 < s.length &&
      s.charCodeAt(i + 1) >= 0xdc00 &&
      s.charCodeAt(i + 1) <= 0xdfff;
    i += isPair ? 2 : 1;
  }
  return s.slice(0, i);
}
