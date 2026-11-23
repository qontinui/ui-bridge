/**
 * Parity — ONE `ElementState` reader behind every surface that reports one.
 *
 * Plan `2026-11-08-ui-bridge-element-state-has-two-readers-and-no-aria-busy`,
 * Phase 1. Four builders used to read `ElementState` from the DOM — the
 * registry, the action executor, the render-log capture and the debug
 * inspector — with four different `visible` algorithms behind one field name.
 * The executor's copy was occlusion-blind, counted `opacity: 0` as visible,
 * never set `role`, `href`, `dataset`, the scroll metrics or the form state,
 * and truncated `textContent` at 500 characters. They now all delegate to
 * `core/element-state.ts`.
 *
 * So for every fixture element (none carries a registry overlay), the
 * executor's action-response `elementState`, the registry snapshot entry's
 * `state` and the render-log `CapturedElement.state`, read in the same tick,
 * must be deep-equal — and the literals below pin what that one reading says.
 *
 * jsdom has neither layout nor `document.elementFromPoint`, so both are
 * stubbed exactly as `core/__tests__/registry.occlusion.test.ts` does: a
 * per-element `getBoundingClientRect`, and an `elementFromPoint` that resolves
 * a point against the stubbed boxes honouring paint order. Without the stub
 * the occlusion arm finds nothing and every element reads `visible: true`,
 * which would make the occluded case pass vacuously.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UIBridgeRegistry } from './registry';
import { DefaultActionExecutor } from '../control/action-executor';
import { captureDOMSnapshot } from '../render-log/dom-capture';
import { REDACTED_VALUE } from './redaction';
import type { ElementState } from './types';

interface Box {
  el: HTMLElement;
  rect: { x: number; y: number; w: number; h: number };
}

/** Later in this array = painted on top. */
let boxes: Box[] = [];
const realElementFromPoint = document.elementFromPoint;

function withBox<T extends HTMLElement>(el: T, x: number, y: number, w: number, h: number): T {
  el.getBoundingClientRect = () =>
    ({
      x,
      y,
      width: w,
      height: h,
      top: y,
      left: x,
      right: x + w,
      bottom: y + h,
      toJSON: () => ({}),
    }) as DOMRect;
  boxes.push({ el, rect: { x, y, w, h } });
  return el;
}

/** Append `el` to `parent` with a test id and a stubbed box. */
function place<T extends HTMLElement>(
  parent: HTMLElement,
  el: T,
  testId: string,
  box: [number, number, number, number]
): T {
  el.setAttribute('data-testid', testId);
  parent.appendChild(el);
  return withBox(el, ...box);
}

const LONG_TEXT = ('alpha   beta\n\n   gamma\tdelta ' + 'x'.repeat(20) + '  ').repeat(16);

let registry: UIBridgeRegistry;
let executor: DefaultActionExecutor;
let overlay: HTMLElement;

function build(): void {
  const body = document.body;

  const pressed = document.createElement('button');
  pressed.setAttribute('aria-pressed', 'true');
  pressed.textContent = 'Bold';
  place(body, pressed, 'pressed', [0, 0, 80, 24]);

  const occluded = document.createElement('button');
  occluded.textContent = 'Behind the overlay';
  place(body, occluded, 'occluded', [100, 0, 80, 24]);

  const faded = document.createElement('button');
  faded.textContent = 'Close';
  faded.style.opacity = '0';
  place(body, faded, 'faded', [200, 0, 80, 24]);

  const link = document.createElement('a');
  link.href = 'https://example.test/docs';
  link.textContent = 'Docs';
  place(body, link, 'link', [300, 0, 80, 24]);

  const tagged = document.createElement('div');
  tagged.setAttribute('data-session-id', 's-42');
  tagged.setAttribute('data-route', '/home');
  tagged.textContent = 'Tagged';
  place(body, tagged, 'tagged', [400, 0, 80, 24]);

  const scroller = document.createElement('div');
  scroller.style.overflowY = 'auto';
  scroller.textContent = 'Scrollable';
  Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 400 });
  Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 100 });
  Object.defineProperty(scroller, 'scrollWidth', { configurable: true, value: 100 });
  Object.defineProperty(scroller, 'clientWidth', { configurable: true, value: 100 });
  place(body, scroller, 'scroller', [0, 100, 100, 100]);

  const password = document.createElement('input');
  password.type = 'password';
  password.value = 'hunter2';
  place(body, password, 'password', [200, 100, 80, 24]);

  const pattern = document.createElement('input');
  pattern.required = true;
  pattern.pattern = '[0-9]+';
  pattern.value = 'abc';
  place(body, pattern, 'pattern', [300, 100, 80, 24]);

  const named = document.createElement('div');
  named.setAttribute('role', 'button');
  named.setAttribute('aria-label', 'Close dialog');
  place(body, named, 'named', [400, 100, 24, 24]);

  const long = document.createElement('p');
  long.textContent = LONG_TEXT;
  place(body, long, 'long', [0, 300, 600, 40]);

  const boundary = document.createElement('div');
  boundary.setAttribute('data-bridge-redact', 'true');
  body.appendChild(boundary);
  const secret = document.createElement('span');
  secret.textContent = 'token-xyz';
  place(boundary, secret, 'secret', [0, 400, 80, 24]);
  // A URL is a DOM string that can carry the secret itself.
  const secretLink = document.createElement('a');
  secretLink.href = SECRET_URL;
  secretLink.textContent = 'Reset password';
  place(boundary, secretLink, 'secretLink', [100, 400, 80, 24]);
  // Constraint attributes and the validation message are DOM strings too.
  const secretPattern = document.createElement('input');
  secretPattern.required = true;
  secretPattern.pattern = 'SECRET[0-9]+';
  secretPattern.min = 'm-SECRET';
  secretPattern.value = 'abc';
  // A message that quotes the secret, as a browser's can quote the value.
  secretPattern.setCustomValidity('abc is not SECRET-shaped');
  place(boundary, secretPattern, 'secretPattern', [200, 400, 80, 24]);

  // Painted LAST, so it owns every point of `occluded`'s box.
  overlay = document.createElement('div');
  overlay.style.position = 'absolute';
  place(body, overlay, 'overlay', [90, 0, 100, 40]);

  for (const id of FIXTURE_IDS) {
    const el = document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
    registry.registerElement(id, el, { type: 'generic', actions: ['blur'] });
  }
}

const FIXTURE_IDS = [
  'pressed',
  'occluded',
  'faded',
  'link',
  'tagged',
  'scroller',
  'password',
  'pattern',
  'named',
  'long',
  'secret',
  'secretLink',
  'secretPattern',
] as const;

const SECRET_URL = 'https://x.test/reset?token=SECRET123';

beforeEach(() => {
  document.body.innerHTML = '';
  boxes = [];
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 720, configurable: true });
  document.elementFromPoint = ((px: number, py: number) => {
    for (let i = boxes.length - 1; i >= 0; i--) {
      const { el, rect } = boxes[i];
      if (!el.isConnected) continue;
      if (px >= rect.x && px < rect.x + rect.w && py >= rect.y && py < rect.y + rect.h) {
        return el;
      }
    }
    return null;
  }) as typeof document.elementFromPoint;
  registry = new UIBridgeRegistry();
  executor = new DefaultActionExecutor(registry);
  build();
});

afterEach(() => {
  document.elementFromPoint = realElementFromPoint;
  document.body.innerHTML = '';
});

/** The three readings of one element, taken in the same tick. */
async function readAll(id: string): Promise<{
  executor: ElementState;
  snapshot: ElementState;
  renderLog: ElementState;
}> {
  const response = await executor.executeAction(id, { action: 'blur' });
  expect(response.success, `blur on ${id}: ${response.error}`).toBe(true);
  // `blur` refreshes only `focused` into the overlay; clear it so the snapshot
  // is the live canonical reading, with no overlay (the parity the plan names).
  registry.refreshElement(id, undefined);
  const entry = registry.createSnapshot().elements.find((e) => e.id === id);
  if (!entry) throw new Error(`no snapshot entry for ${id}`);
  const captured = captureDOMSnapshot({ includeHidden: true }).elements.find(
    (e) => e.identifier.testId === id
  );
  if (!captured) throw new Error(`no render-log capture for ${id}`);
  return { executor: response.elementState!, snapshot: entry.state, renderLog: captured.state };
}

describe('ElementState parity — executor, snapshot and render-log read one state', () => {
  it.each(FIXTURE_IDS)(
    '%s: executor elementState === snapshot state === render-log state',
    async (id) => {
      const r = await readAll(id);
      expect(r.executor).toEqual(r.snapshot);
      expect(r.renderLog).toEqual(r.snapshot);
    }
  );

  it('an occluded button reads visible: false, visibilityReason: occluded, naming the overlay', async () => {
    const r = await readAll('occluded');
    for (const state of [r.executor, r.snapshot, r.renderLog]) {
      expect(state.visible).toBe(false);
      expect(state.visibilityReason).toBe('occluded');
      expect(state.occludedPct).toBe(100);
      // The overlay is unregistered and has no id or class, so
      // `describeOccluder` names it by its tag.
      expect(state.occludedBy).toBe('div');
    }
  });

  it('an opacity-0 button reads visible: false, visibilityReason: hidden, opacityHidden: true', async () => {
    const r = await readAll('faded');
    for (const state of [r.executor, r.snapshot, r.renderLog]) {
      expect(state.visible).toBe(false);
      expect(state.visibilityReason).toBe('hidden');
      expect(state.opacityHidden).toBe(true);
    }
  });

  it('textContent longer than 500 characters is not truncated or whitespace-normalised', async () => {
    const r = await readAll('long');
    expect(LONG_TEXT.trim().length).toBeGreaterThan(500);
    expect(r.executor.textContent).toBe(LONG_TEXT.trim());
    expect(r.executor.textContent!.length).toBe(LONG_TEXT.trim().length);
  });

  it('the fields the executor copy never set are present, with their literals', async () => {
    const pressed = (await readAll('pressed')).executor;
    expect(pressed.ariaPressed).toBe(true);
    expect(pressed.visible).toBe(true);
    expect(pressed.inViewport).toBe(true);
    expect(pressed.accessibleName).toBe('Bold');
    expect(pressed.scrollWidth).toBe(0);
    expect(pressed.clientWidth).toBe(0);

    const named = (await readAll('named')).executor;
    expect(named.role).toBe('button');
    expect(named.accessibleName).toBe('Close dialog');
    expect(named.nameSource).toBe('aria-label');
    expect(named.textContent).toBe('Close dialog');

    expect((await readAll('link')).executor.href).toBe('https://example.test/docs');
    expect((await readAll('tagged')).executor.dataset).toEqual({
      sessionId: 's-42',
      route: '/home',
      testid: 'tagged',
    });

    const scroller = (await readAll('scroller')).executor;
    expect(scroller.scrollInfo).toEqual({
      scrollTop: 0,
      scrollLeft: 0,
      scrollHeight: 400,
      scrollWidth: 100,
      clientHeight: 100,
      clientWidth: 100,
      canScrollUp: false,
      canScrollDown: true,
      canScrollLeft: false,
      canScrollRight: false,
    });

    const pattern = (await readAll('pattern')).executor;
    expect(pattern.required).toBe(true);
    expect(pattern.value).toBe('abc');
    expect(pattern.constraints).toEqual({ pattern: '[0-9]+' });
    expect(pattern.validationState?.valid).toBe(false);
    expect(pattern.validationState?.patternMismatch).toBe(true);

    const password = (await readAll('password')).executor;
    expect(password.value).toBe(REDACTED_VALUE);
    expect(password.redaction).toEqual({ value: true });

    const secret = (await readAll('secret')).executor;
    expect(secret.textContent).toBe(REDACTED_VALUE);
    expect(secret.accessibleName).toBe(REDACTED_VALUE);
    expect(secret.dataset).toBeUndefined();
  });

  it('an <a href> inside a redaction boundary reads href: [REDACTED] everywhere', async () => {
    const r = await readAll('secretLink');
    for (const state of [r.executor, r.snapshot, r.renderLog]) {
      expect(state.href).toBe(REDACTED_VALUE);
      expect(state.textContent).toBe(REDACTED_VALUE);
      expect(JSON.stringify(state)).not.toContain('SECRET123');
    }
    const captured = captureDOMSnapshot({ includeHidden: true }).elements.find(
      (e) => e.identifier.testId === 'secretLink'
    )!;
    // The render-log's own attribute record and its state agree.
    expect(captured.attributes.href).toBe(REDACTED_VALUE);
    expect(JSON.stringify(captured)).not.toContain('SECRET123');
  });

  it('constraint attributes and the validation message inside a boundary are redacted', async () => {
    const r = await readAll('secretPattern');
    for (const state of [r.executor, r.snapshot, r.renderLog]) {
      expect(state.required).toBe(true);
      expect(state.value).toBe(REDACTED_VALUE);
      expect(state.constraints).toEqual({ pattern: REDACTED_VALUE, min: REDACTED_VALUE });
      expect(state.validationState?.valid).toBe(false);
      expect(state.validationState?.patternMismatch).toBe(true);
      expect(state.validationState?.customError).toBe(true);
      expect(state.validationState?.validationMessage).toBe(REDACTED_VALUE);
      expect(JSON.stringify(state)).not.toContain('SECRET');
    }
  });
});

describe('executor waitFor reads the canonical, occlusion-aware visible', () => {
  it('times out with met: false on the occluded button', async () => {
    const result = await executor.waitFor('occluded', { visible: true, timeout: 200 });
    expect(result.met).toBe(false);
    expect(result.waitedMs).toBeGreaterThanOrEqual(200);
    expect(result.state?.visible).toBe(false);
    expect(result.state?.visibilityReason).toBe('occluded');
  });

  it('resolves met: true once the overlay is removed', async () => {
    setTimeout(() => overlay.remove(), 50);
    // Lower bound + met only: no wall-clock ceiling to flake on a loaded box.
    // The generous timeout means "met" is the assertion that it terminated.
    const result = await executor.waitFor('occluded', {
      visible: true,
      timeout: 5000,
      interval: 10,
    });
    expect(result.met).toBe(true);
    expect(result.waitedMs).toBeGreaterThanOrEqual(40);
    expect(result.state?.visible).toBe(true);
    expect(result.state?.visibilityReason).toBeUndefined();
  });
});
