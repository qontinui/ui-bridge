/**
 * Handler implementations for the headless / headed Playwright transports.
 *
 * Extracted from `index.ts` so the smoke test can register the same set of
 * actions without re-importing the CLI bootstrap. Every handler receives
 * `(params, ctx)` where `ctx` is a `HeadlessContext` — i.e. a real
 * `playwright.Page` plus its surrounding `BrowserContext` / `Browser`.
 *
 * Action ids here are wrapper-internal; they're driven by the *caller*
 * (this script's `main`, or the test) via `transport.dispatch(id, params)`.
 * They are not part of the runner's relay vocabulary — when you adopt this
 * for your own app, rename them to whatever reads naturally.
 */

import type { HeadlessContext, WrapperTransport } from '@qontinui/ui-bridge-wrapper';

/** Result of `getHeadingText`. */
export interface HeadingTextResult {
  text: string;
}

/** Result of `clickButton`. Captures before/after so the click is observable. */
export interface ClickButtonResult {
  clicked: true;
  beforeText: string;
  afterText: string;
}

/** Param + result for `fillInput`. `currentValue` is read back from the DOM. */
export interface FillInputParams {
  value: string;
}
export interface FillInputResult {
  value: string;
  currentValue: string;
}

/** Result of `screenshot` — bytes-length only, not the full PNG payload. */
export interface ScreenshotResult {
  bytes: number;
}

/** Result of `getMetrics`. */
export interface MetricsResult {
  url: string;
  viewport: { width: number; height: number } | null;
  userAgent: string;
}

/**
 * Register every action the example exposes onto the given transport. Idempotent
 * — re-registration replaces the prior handler (HandlerRegistry semantics).
 */
export function registerHandlers(transport: WrapperTransport): void {
  // 1. getHeadingText: read `<h1>` text content.
  transport.register<undefined, HeadingTextResult, HeadlessContext>(
    'getHeadingText',
    async (_params, ctx) => {
      const text = await ctx.page.evaluate(() => {
        const h1 = document.querySelector('h1');
        return h1?.textContent ?? '';
      });
      return { text };
    }
  );

  // 2. clickButton: click the primary button, capture heading before/after.
  transport.register<undefined, ClickButtonResult, HeadlessContext>(
    'clickButton',
    async (_params, ctx) => {
      const beforeText = await ctx.page.evaluate(
        () => document.querySelector('h1')?.textContent ?? ''
      );
      await ctx.page.click('button[data-test="primary"]');
      const afterText = await ctx.page.evaluate(
        () => document.querySelector('h1')?.textContent ?? ''
      );
      return { clicked: true, beforeText, afterText };
    }
  );

  // 3. fillInput: fill `input[name="email"]` and read the value back.
  transport.register<FillInputParams, FillInputResult, HeadlessContext>(
    'fillInput',
    async (params, ctx) => {
      const value = params?.value ?? '';
      await ctx.page.fill('input[name="email"]', value);
      const currentValue = await ctx.page.evaluate(() => {
        const input = document.querySelector<HTMLInputElement>('input[name="email"]');
        return input?.value ?? '';
      });
      return { value, currentValue };
    }
  );

  // 4. screenshot: capture a PNG; report just the byte count to keep logs small.
  transport.register<undefined, ScreenshotResult, HeadlessContext>(
    'screenshot',
    async (_params, ctx) => {
      const buf = await ctx.page.screenshot({ type: 'png' });
      return { bytes: buf.length };
    }
  );

  // 5. getMetrics: page url, viewport, and user agent (from the browser context).
  transport.register<undefined, MetricsResult, HeadlessContext>(
    'getMetrics',
    async (_params, ctx) => {
      const url = ctx.page.url();
      const viewport = ctx.page.viewportSize();
      const userAgent = await ctx.page.evaluate(() => navigator.userAgent);
      return { url, viewport, userAgent };
    }
  );
}

/** Action ids registered by `registerHandlers`. Exposed for help text. */
export const REGISTERED_ACTIONS = [
  'getHeadingText',
  'clickButton',
  'fillInput',
  'screenshot',
  'getMetrics',
] as const;
export type RegisteredAction = (typeof REGISTERED_ACTIONS)[number];
