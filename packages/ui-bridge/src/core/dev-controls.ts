/**
 * Dev controls — the gate for commands that ALTER the page under test.
 *
 * Most UI Bridge commands observe, or act the way a user would (click, type,
 * navigate). A dev control does something no user can: it rewrites what the
 * page renders — `POST /control/media/override` swaps an image's source in
 * place. That is exactly what a design loop needs (see a candidate asset in
 * its real slot, then restore), and exactly what a production deployment must
 * never expose. So these commands answer only where something has OPTED IN:
 *
 *   - the injected runtime (`injected/bootstrap.ts`), which a driver
 *     (inject-cli, the headless/headed transports) installs into a browser IT
 *     launched. No app ships it; the page owner never serves it.
 *   - an embedded SDK whose app passes `features.devControls: true` to
 *     `UIBridgeProvider`, or calls {@link enableDevControls}. The app's own
 *     bundler resolves the condition, so the intended spelling is
 *     `devControls: process.env.NODE_ENV === 'development'`.
 *
 * WHY NOT `process.env.NODE_ENV` HERE. `AutoRegisterProvider`'s
 * `enabled = process.env.NODE_ENV === 'development'` works because it is a
 * React prop default in the APP's bundle. This module is also bundled into the
 * injected IIFE, which defines no `NODE_ENV` (`tsup.config.ts`): the expression
 * would either throw in a page realm or read as production, disabling the
 * control on the one path that needs it most. An explicit opt-in is the only
 * gate that means the same thing in every bundle.
 *
 * Off by default, never switched off by a later caller: the first opt-in wins
 * for the life of the realm, and {@link devControlsSource} names who opted in
 * so a response can say why the control answered.
 *
 * The flag lives on `globalThis` under a symbol, so two copies of the SDK in
 * one page (an app bundle plus the injected runtime) agree on one answer.
 */

/** Who opted the realm into dev controls. */
export type DevControlsSource = 'injected-runtime' | 'provider-feature' | 'explicit';

const KEY = Symbol.for('@qontinui/ui-bridge/dev-controls');

interface DevControlsSlot {
  source: DevControlsSource;
}

function slotHolder(): Record<symbol, DevControlsSlot | undefined> {
  return globalThis as unknown as Record<symbol, DevControlsSlot | undefined>;
}

/**
 * Opt this realm into dev controls. Idempotent; the first source is kept.
 *
 * Call it only from code that is itself dev-only: the injected runtime, or an
 * app's dev build. Calling it from a production bundle exposes the page-
 * altering commands on that deployment.
 */
export function enableDevControls(source: DevControlsSource = 'explicit'): void {
  const holder = slotHolder();
  if (holder[KEY]) return;
  holder[KEY] = { source };
}

/** True when this realm has opted into dev controls. */
export function devControlsEnabled(): boolean {
  return slotHolder()[KEY] !== undefined;
}

/** Who opted in, or `null` when dev controls are off. */
export function devControlsSource(): DevControlsSource | null {
  return slotHolder()[KEY]?.source ?? null;
}

/**
 * Test-only: forget the opt-in. Production code has no reason to disable dev
 * controls once enabled — a realm that was safe to alter stays so.
 */
export function resetDevControlsForTest(): void {
  delete slotHolder()[KEY];
}

/** Error code a dev control answers with when the realm has not opted in. */
export const DEV_CONTROLS_DISABLED_CODE = 'capability_unavailable_in_build';

/** The refusal body a dev control returns when the realm has not opted in. */
export function devControlsDisabledResponse(command: string): {
  success: false;
  code: typeof DEV_CONTROLS_DISABLED_CODE;
  reason: 'dev_controls_disabled';
  error: string;
  timestamp: number;
} {
  return {
    success: false,
    code: DEV_CONTROLS_DISABLED_CODE,
    reason: 'dev_controls_disabled',
    error:
      `${command} is a dev control and this build has not opted in. It answers in the ` +
      `injected runtime (inject-cli) and in an app that passes ` +
      `features.devControls: process.env.NODE_ENV === 'development' to UIBridgeProvider.`,
    timestamp: Date.now(),
  };
}
