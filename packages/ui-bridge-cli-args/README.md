# @qontinui/ui-bridge-cli-args

Shared CLI argument primitives for the UI Bridge package bins.

This is the single home for the low-level argument-reading kit that every UI
Bridge CLI needs: the **flag-shaped-value swallow guard**, unknown-flag
rejection, the shared `--quiet` / `--help` surface, and a `--quiet`-aware stderr
logger. It has **zero runtime dependencies** so any bin — in
`@qontinui/ui-bridge-wrapper`, `@qontinui/ui-bridge-headless`, or a future
package — can import it without dragging in Playwright or the engine bundle.

## Why it exists

Each bin used to re-implement its own `valueOf` / `has` / unknown-flag kit, and
those copies drifted — most importantly, every one silently **swallowed a
flag-shaped value**: a value-flag followed by another `--flag` (e.g.
`--success --headed`, or `--ui-bridge --headless`) captured the flag as the
value. A *successful* login could report `ok:false` because its `--success`
target was literally `"--headed"`; a headless launch could poll a bogus UI
Bridge base because `--ui-bridge` swallowed `--headless`. This module rejects
that swallow uniformly.

## API

| Export | Purpose |
| --- | --- |
| `consumeValue(flag, raw, error)` | Guard a switch-style `argv[++i]` read: returns the value, `null` when absent, THROWS on a flag-shaped value. |
| `rejectEmptyValue(flag, value, error)` | Reject a present-but-empty value (`--success ''`). |
| `ArgReader` | An `indexOf`-based reader for flat arg lists — rejects unknown flags up front and flag-shaped values for value-flags. |
| `COMMON_FLAGS` | The flags shared by every bin (`--help`, `-h`, `--quiet`). |
| `makeLogger(prefix, quiet)` | A `--quiet`-aware stderr logger. |
| `ArgErrorFactory` | Type for the bin's domain-error constructor, so thrown errors keep each bin's specific type. |

A single leading dash (`-1`, `-h`) is **not** flag-shaped — negative numeric
values still read as values.
