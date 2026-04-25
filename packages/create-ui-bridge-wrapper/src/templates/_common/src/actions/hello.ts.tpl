/**
 * Example action: `hello`.
 *
 * Transport-agnostic by design. The handler narrows `ctx.kind` when it
 * needs transport-specific capabilities (e.g. the Playwright `page` for
 * headless/headed). Wrappers that only ever run against one transport
 * can skip the narrowing and hard-code expectations.
 */

export interface HelloParams {
  /** Display name to greet. Defaults to `'world'`. */
  name?: string;
}

export interface HelloResult {
  message: string;
  /** Which transport executed the handler. Useful for end-to-end probes. */
  transport: string;
}

interface KindedCtx {
  kind?: string;
}

export async function hello(
  params: HelloParams | undefined,
  ctx: unknown
): Promise<HelloResult> {
  const target = params?.name ?? 'world';
  const kind = (ctx as KindedCtx | undefined)?.kind ?? 'unknown';
  // Example of a transport-specific branch — kept minimal so the
  // generated wrapper compiles without `playwright` installed until
  // the user actually pulls in the headless transport.
  if (kind === 'headless' || kind === 'headed') {
    // Access the Playwright page via `(ctx as { page }).page` here.
    // Left empty so the scaffold compiles without @types/playwright.
  }
  return {
    message: `hello, ${target}`,
    transport: kind,
  };
}
