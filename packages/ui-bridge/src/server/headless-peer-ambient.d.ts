/**
 * Fallback ambient declaration for the OPTIONAL peer
 * `@qontinui/ui-bridge-headless`.
 *
 * The spawn-headless handler (`handlers.ts`) dynamic-imports this peer at
 * runtime and immediately casts the result to a local structural type
 * (`HeadlessLauncherModule`) — it never consumes the peer's real exported
 * types. But TypeScript's .d.ts rollup (tsup `dts`, which runs a real `tsc`
 * program) still RESOLVES the `import('@qontinui/ui-bridge-headless')`
 * specifier at build time. That resolution fails with TS2307 whenever the
 * sibling `ui-bridge-headless` workspace hasn't been built yet (its `dist/`
 * — and therefore its `package.json` `types` entry — is absent), which made
 * an isolated `npm run build` of THIS package always red even though the
 * runtime JS built fine, and the failure cascaded into spurious TS6059
 * "not under rootDir" errors on other files.
 *
 * This ambient declaration gives TypeScript a resolvable fallback for the
 * specifier so the declaration build is self-contained regardless of the
 * peer's build state. When the peer IS built, TypeScript resolves the import
 * to the real `@qontinui/ui-bridge-headless` package file (a concrete module
 * file takes precedence over an ambient `declare module`), so this fallback
 * is simply unused — no conflict, no behavioral change. The body is typed
 * `unknown` on purpose: the only surface the handler uses is described
 * structurally in `handlers.ts`, and the dynamic import's result is cast.
 */
declare module '@qontinui/ui-bridge-headless' {
  const launchHeadlessTab: unknown;
  export { launchHeadlessTab };
}
