/**
 * SDK-dispatch scope — marks the window in which the SDK itself is acting on
 * the page, so a listener can tell an agent's action from a human's.
 *
 * `event.isTrusted` alone does not: the SDK's synthetic events are untrusted,
 * but the BROWSER fires TRUSTED events as a consequence of what the SDK does —
 * `form.requestSubmit()` fires a trusted `submit`, and a `.click()` or a
 * dispatched `click` on a checkbox fires a trusted `input` + `change` (on a
 * submit button, a trusted `submit`; `execCommand('insertText')`, a trusted
 * `input`). Those consequences fire SYNCHRONOUSLY inside the call, so wrapping
 * every activation-capable call in {@link sdkDispatch} covers them.
 *
 * Every `.click()`, `requestSubmit(…)`, `dispatchEvent(…'click'…)` and
 * `execCommand(…)` in the package source must run inside `sdkDispatch` — a
 * source-scan test (`sdk-dispatch.scan.test.ts`) fails on one that does not.
 *
 * A depth COUNTER (nested and re-entrant scopes are safe), held only for the
 * synchronous call.
 *
 * What this scope does NOT cover — two gaps, both left open:
 *
 *   1. Asynchronous consequences. An async callback's continuation is not
 *      covered (deliberately: an agent's awaited waits and snapshots must not
 *      mask a human using the page meanwhile), so app code that reacts to an
 *      agent's action LATER (a `setTimeout` that calls `requestSubmit()`)
 *      fires trusted events outside it.
 *   2. External drivers. Input injected from OUTSIDE the page — Playwright
 *      locator `.click()` / `.fill()`, which reach the page as CDP `Input.*`
 *      events (ui-bridge-wrapper's `login-drive.ts` and `login-web-cli.ts`
 *      drive a login that way), and OS-level input (a desktop automation tool
 *      moving the real mouse) — arrives with `isTrusted === true` and never
 *      passes through
 *      this module, so no `sdkDispatch` scope can mark it. In-page, it is
 *      indistinguishable from a human; passive capture records it as one.
 *
 * globalThis-backed so every bundle copy of this module (the injected runtime
 * and the React entry on one page) shares one counter.
 */

interface SdkDispatchStore {
  depth: number;
}

function store(): SdkDispatchStore {
  const g = globalThis as unknown as { __UI_BRIDGE_SDK_DISPATCH__?: SdkDispatchStore };
  if (!g.__UI_BRIDGE_SDK_DISPATCH__) g.__UI_BRIDGE_SDK_DISPATCH__ = { depth: 0 };
  return g.__UI_BRIDGE_SDK_DISPATCH__;
}

/** Run `fn` as an SDK action: events fired during its synchronous run are the SDK's. */
export function sdkDispatch<T>(fn: () => T): T {
  const s = store();
  s.depth++;
  try {
    return fn();
  } finally {
    s.depth--;
  }
}

/** Whether the SDK is acting on the page right now. */
export function isSdkDispatching(): boolean {
  return store().depth > 0;
}
