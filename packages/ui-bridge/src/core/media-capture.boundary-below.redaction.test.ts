/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { getGlobalRegistry } from './registry';
import { DefaultActionExecutor } from '../control/action-executor';
import { createHandlers, type RegistryLike } from '../server/handlers';
import { registerMedia, stubBox } from '../react/__tests__/media-fixture';
import { REDACTED_VALUE } from './redaction';

const SECRET = 'SECRET-media-3302';

beforeEach(() => {
  getGlobalRegistry().clear?.();
});

afterEach(() => {
  document.body.innerHTML = '';
  getGlobalRegistry().clear?.();
});

/**
 * §4.6: `altText` of a `<canvas>` (its fallback content) and of an inline
 * `<svg>` (its `<title>`) is a subtree read. The row's own redaction verdict
 * only looks UP, so a boundary BELOW the media element rode into the find
 * payload and the registry snapshot until the read excluded boundaries.
 */
describe('canvas / svg altText — boundary below the media element', () => {
  async function payloads(): Promise<string[]> {
    const registry = getGlobalRegistry();
    const handlers = createHandlers(
      registry as unknown as RegistryLike,
      new DefaultActionExecutor(registry) as never
    );
    const find = JSON.stringify(await handlers.find({ mediaOnly: true, skipSettle: true }));
    const snapshot = JSON.stringify(registry.createSnapshot());
    return [find, snapshot];
  }

  it('canvas fallback content', async () => {
    document.body.innerHTML = `<canvas id="c">Chart <span data-bridge-redact="true">${SECRET}</span></canvas>`;
    const canvas = document.getElementById('c') as HTMLElement;
    stubBox(canvas, 50, 50);
    registerMedia(getGlobalRegistry(), 'canvas-1', canvas);
    const [find, snapshot] = await payloads();
    expect(find).toContain(`Chart ${REDACTED_VALUE}`);
    expect(find).not.toContain(SECRET);
    expect(snapshot).not.toContain(SECRET);
  });

  it('inline svg title', async () => {
    document.body.innerHTML =
      `<div id="host"><svg id="s" viewBox="0 0 1 1"><title>Logo ` +
      `<tspan data-bridge-redact="true">${SECRET}</tspan></title></svg></div>`;
    const svg = document.getElementById('s') as unknown as HTMLElement;
    stubBox(svg, 50, 50);
    registerMedia(getGlobalRegistry(), 'svg-1', svg);
    const [find, snapshot] = await payloads();
    expect(find).not.toContain(SECRET);
    expect(snapshot).not.toContain(SECRET);
  });
});
