/**
 * Shared CLI argument primitives for the package bins (`ui-bridge-login-web`,
 * `ui-bridge-capture-specs`, `ui-bridge-inject`). Each bin used to re-implement
 * its own `valueOf`/`has`/unknown-flag kit, and those copies drifted — most
 * importantly, every one of them silently SWALLOWED a flag-shaped value: a
 * value-flag followed by another `--flag` (e.g. `--success --headed`) captured
 * the flag as the value, so a *successful* login could report `ok:false` because
 * its `--success` target was literally `"--headed"`. The kit below is the single
 * home for argument reading and rejects that swallow uniformly.
 *
 * The bins keep their own typed `parseArgs` (the arg SHAPE differs per bin); this
 * module only owns the low-level reading + the cross-bin invariants (flag-shaped
 * value rejection, unknown-flag rejection, the shared `--quiet`/`--help` flags,
 * and a `--quiet`-aware stderr logger).
 */

/**
 * Construct a bin's own domain error from a message. Passing the factory keeps
 * thrown errors the bin's specific type (`LoginCliArgError` / `CaptureCliArgError`
 * / `InjectCliArgError`) so each bin's `main()` `instanceof` catch still fires.
 */
export type ArgErrorFactory = (message: string) => Error;

/**
 * Flags shared by every bin. A bin unions these into its own KNOWN set so the
 * common surface (`--help`, `-h`, `--quiet`) is defined in exactly one place.
 */
export const COMMON_FLAGS: ReadonlySet<string> = new Set(['--help', '-h', '--quiet']);

/**
 * True iff `value` looks like a flag (`--foo`), i.e. the next token a value-flag
 * accidentally swallowed. A single leading dash (`-1`, `-h`) is NOT flag-shaped —
 * negative numeric values (`--settle-quiet -1`) must still read as values.
 */
function isFlagShaped(value: string): boolean {
  return value.startsWith('--');
}

/**
 * Guard a single value consumed by a *switch-style* parser (`argv[++i]`) against
 * the flag-shaped swallow. Returns the value, `null` when it's simply absent
 * (end of argv — the caller applies its own required/default handling), and
 * THROWS (via `error`) when the value is flag-shaped — that is never an intended
 * value, it's an omitted argument.
 */
export function consumeValue(
  flag: string,
  raw: string | undefined,
  error: ArgErrorFactory
): string | null {
  if (raw === undefined) return null;
  if (isFlagShaped(raw)) {
    throw error(`${flag} expects a value but got the flag '${raw}' — did you omit ${flag}'s argument?`);
  }
  return raw;
}

/**
 * Reject a present-but-empty value (`--success ''`). An empty value on a
 * matching/target flag is never intended — e.g. an empty `--success` makes
 * `landingPath.includes('')` true on ANY landing page, turning a stuck login
 * into a false success (the exact exit-code-trust failure #83 exists to
 * prevent). `null` (flag absent — caller defaults it) passes through.
 */
export function rejectEmptyValue(
  flag: string,
  value: string | null,
  error: ArgErrorFactory
): string | null {
  if (value !== null && value.trim() === '') {
    throw error(
      `${flag} was given an empty value — omit the flag to use its default, or pass a non-empty value`
    );
  }
  return value;
}

/**
 * An `indexOf`-based reader for the browser bins' flat arg lists. Rejects unknown
 * `--flags` up front (matching each bin's prior behavior) and rejects flag-shaped
 * values for value-flags (the swallow fix).
 */
export class ArgReader {
  private readonly argv: readonly string[];
  private readonly error: ArgErrorFactory;

  /**
   * @param argv  Already sliced past `node script`.
   * @param known All flags the bin recognizes (union the bin's set with {@link COMMON_FLAGS}).
   * @param error Factory producing the bin's domain error type.
   */
  constructor(argv: readonly string[], known: ReadonlySet<string>, error: ArgErrorFactory) {
    this.argv = argv;
    this.error = error;
    for (const arg of argv) {
      if (isFlagShaped(arg) && !known.has(arg)) {
        throw error(`Unknown flag: ${arg}`);
      }
    }
  }

  /** True if `name` appears as a bare boolean flag. */
  has(name: string): boolean {
    return this.argv.includes(name);
  }

  /**
   * Value following the value-flag `name`, or `null` when the flag is absent OR
   * has no following token (the caller defaults it). Throws when the following
   * token is flag-shaped — the swallow this kit exists to kill. Delegates to
   * {@link consumeValue} so the guard (and its message) live in exactly one
   * place for both the indexOf-style and switch-style parsers.
   */
  value(name: string): string | null {
    const i = this.argv.indexOf(name);
    if (i < 0 || i + 1 >= this.argv.length) return null;
    return consumeValue(name, this.argv[i + 1], this.error);
  }
}

/**
 * Build a `--quiet`-aware stderr logger. When `quiet` is true it drops every
 * line; otherwise it writes `<prefix> <message>` (or just `<message>` when
 * `prefix` is empty) to stderr. Shared so all three bins honor `--quiet`
 * identically.
 */
export function makeLogger(prefix: string, quiet: boolean): (message: string) => void {
  if (quiet) return () => {};
  return prefix
    ? (m: string) => process.stderr.write(`${prefix} ${m}\n`)
    : (m: string) => process.stderr.write(`${m}\n`);
}
