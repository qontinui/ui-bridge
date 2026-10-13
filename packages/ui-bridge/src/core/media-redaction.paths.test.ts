/**
 * §4.6 media redaction across EVERY emission path — plan
 * 2026-10-13-image-generation-and-visual-judgment, Phase 5 step 6.
 *
 * THE BYPASS this closes (verified at vet): the registry's media refresh
 * override wrote the RAW `refreshFn(element)` into `state.mediaMetadata`, and
 * every emission path ships `state` beside its scrubbed top-level field — the
 * snapshot serializer, the server materializer, the relay's find row and the
 * executor's find row. So a media element inside a `data-bridge-redact`
 * boundary shipped its secret `src` / `srcset` / alt / `poster` through
 * `state` on all of them. The older executor test registered WITHOUT
 * `refreshMetadata`, so it never reached the override.
 *
 * This test registers exactly as `useAutoRegister` does — an initial capture
 * PLUS the refresh callback — and asserts that no path's serialized response
 * contains the secret in any letter case (ids and slugs lowercase it).
 *
 * Mutation proof: replace the registry override's
 * `scrubMediaMetadata(meta, verdictOf(element))` with the raw `meta` and the
 * boundary assertions below go red on every path.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getGlobalRegistry } from './registry';
import { DefaultActionExecutor } from '../control/action-executor';
import { createHandlers, type RegistryLike } from '../server/handlers';
import { createRelayHandlers } from '../server/relay-handlers';
import { CommandRelay } from '../server/command-relay';
import { executeCommand, type BridgeAccess } from '../react/commandHandlers';
import { makeImage, registerMedia, stubBox } from '../react/__tests__/media-fixture';

const SECRET = 'SECRET123';
const bridge: BridgeAccess = { elements: [], getElement: () => undefined, components: [], workflows: [] };

/** Every emission path, as the JSON a client would receive. */
const PATHS: Record<string, () => Promise<string>> = {
  async 'snapshot (serializeRegisteredElement)'() {
    return JSON.stringify(getGlobalRegistry().createSnapshot());
  },
  async 'server find (materializeElements)'() {
    const registry = getGlobalRegistry();
    const handlers = createHandlers(
      registry as unknown as RegistryLike,
      new DefaultActionExecutor(registry) as never
    );
    return JSON.stringify(await handlers.find({ mediaOnly: true, skipSettle: true }));
  },
  async 'server getElement (materializeElements)'() {
    const registry = getGlobalRegistry();
    const handlers = createHandlers(
      registry as unknown as RegistryLike,
      new DefaultActionExecutor(registry) as never
    );
    const all = await Promise.all(
      registry.getAllMediaElements().map((e) => handlers.getElement(e.id))
    );
    return JSON.stringify(all);
  },
  async 'executor find'() {
    return JSON.stringify(await new DefaultActionExecutor(getGlobalRegistry()).find({ mediaOnly: true }));
  },
  async 'relay find (elementToFindResult)'() {
    return JSON.stringify(await executeCommand('find', { mediaOnly: true, skipSettle: true }, bridge));
  },
  async 'relay snapshot (getControlSnapshot)'() {
    return JSON.stringify(await executeCommand('getControlSnapshot', { skipSettle: true }, bridge));
  },
  async 'relay cached find'() {
    const relay = new CommandRelay({ globalPrefix: `__uiBridgeRedactPaths_${Math.random()}` });
    vi.spyOn(relay, 'queueCommand').mockImplementation((async (action: string) => {
      if (action === 'getControlSnapshot') return getGlobalRegistry().createSnapshot();
      throw new Error('timeout: no browser answered');
    }) as never);
    return JSON.stringify(await createRelayHandlers(relay).find({ mediaOnly: true }));
  },
};

describe('§4.6 — a redacted media element ships no secret on any path', () => {
  beforeEach(() => {
    const boundary = document.createElement('section');
    boundary.setAttribute('data-bridge-redact', 'true');
    document.body.appendChild(boundary);

    const img = makeImage({
      alt: `QR code for ${SECRET}`,
      src: `/totp/${SECRET}.png`,
      natural: [64, 64],
      rendered: [64, 64],
      attrs: {
        srcset: `/totp/${SECRET}@2x.png 2x`,
        'data-ui-bridge-image-slot': `slot-${SECRET}`,
      },
      parent: boundary,
    });
    // The label useAutoRegister derives for a media element: its alt text.
    registerMedia(getGlobalRegistry(), 'media-qr', img, `QR code for ${SECRET}`);

    const video = document.createElement('video');
    video.setAttribute('aria-label', `recording of ${SECRET}`);
    video.setAttribute('poster', `/poster/${SECRET}.png`);
    video.setAttribute('src', `/clips/${SECRET}.mp4`);
    stubBox(video, 320, 180);
    boundary.appendChild(video);
    registerMedia(getGlobalRegistry(), 'media-clip', video, `recording of ${SECRET}`);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = `${SECRET} balance chart`;
    svg.appendChild(title);
    stubBox(svg, 200, 100);
    boundary.appendChild(svg);
    registerMedia(getGlobalRegistry(), 'media-chart', svg as unknown as HTMLElement);
  });

  afterEach(() => {
    getGlobalRegistry().clear();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('SANITY: every path returns all three media rows (guards vacuity)', async () => {
    for (const [name, emit] of Object.entries(PATHS)) {
      const json = await emit();
      for (const id of ['media-qr', 'media-clip', 'media-chart']) {
        expect(json, `${name} lost ${id}`).toContain(`"${id}"`);
      }
    }
  });

  it.each(Object.keys(PATHS))('%s: no secret src / srcset / alt / poster / slot, any case', async (name) => {
    const json = await PATHS[name]();
    expect(json.toLowerCase()).not.toContain(SECRET.toLowerCase());
    // The rows are still there, with their structure: the scrub is
    // field-level, so audits keep working inside the boundary.
    expect(json).toContain('[REDACTED]');
    expect(json).toContain('"naturalWidth":64');
  });
});

describe('[negative control] outside a boundary, media URLs pass through', () => {
  beforeEach(() => {
    const img = makeImage({
      alt: 'Company logo',
      src: '/brand/logo.png',
      natural: [64, 64],
      attrs: { srcset: '/brand/logo@2x.png 2x' },
    });
    registerMedia(getGlobalRegistry(), 'media-logo', img, 'Company logo');
  });

  afterEach(() => {
    getGlobalRegistry().clear();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it.each(Object.keys(PATHS))('%s: src, srcset and alt survive', async (name) => {
    const json = await PATHS[name]();
    expect(json).toContain('/brand/logo.png');
    expect(json).toContain('/brand/logo@2x.png 2x');
    expect(json).toContain('Company logo');
    expect(json).not.toContain('[REDACTED]');
  });
});
