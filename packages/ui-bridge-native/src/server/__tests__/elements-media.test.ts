import { describe, it, expect } from 'vitest';
import { NativeUIBridgeRegistry } from '../../core/registry';
import { DefaultNativeActionExecutor } from '../../control/action-executor';
import { NativeUIBridgeServer } from '../http-server';
import type { NativeElementRef } from '../../core/types';

/**
 * Image media on BOTH element-serving routes. `GET /control/snapshot` (and
 * `control/discover`) serve `registry.createSnapshot()`; `GET /control/elements`
 * builds its rows in `handlers.ts` `getElements`. Each calls
 * `projectVisionFields` itself, so each needs the image's props, accessibility
 * label and viewport answer passed in — a route that forgot them would emit an
 * image with no `media` facts and nothing would notice. Plan
 * 2026-10-13-image-generation-and-visual-judgment, Phase 7.
 */

const SHARED_SRC = 'http://localhost:3001/_next/image?url=%2Fimages%2Fhero.png&w=1920&q=75';
const SHARED_DIGEST = 'a846bcf412cf708ec0a4ac6a972307cbcb250b75509765fd44c49caecbd01f94';

interface MediaRow {
  id: string;
  text?: string;
  bg_color?: unknown;
  media?: Record<string, unknown>;
}

function makeRef(): React.RefObject<NativeElementRef> {
  return { current: {} as NativeElementRef };
}

function buildServer() {
  const registry = new NativeUIBridgeRegistry();
  registry.setViewportProvider(() => ({ width: 393, height: 830 }));
  const server = new NativeUIBridgeServer(registry, new DefaultNativeActionExecutor(registry));
  registry.registerElement('hero', makeRef(), {
    type: 'image',
    label: 'Hero',
    accessibilityLabel: 'Hero',
    // The host spread bridgeProps (accessibilityLabel) and captured them.
    props: { source: { uri: SHARED_SRC }, resizeMode: 'stretch', accessibilityLabel: 'Hero' },
    flatStyle: { backgroundColor: 'transparent' },
  });
  registry.updateElementState('hero', {
    visible: true,
    layout: { x: 0, y: 40, width: 393, height: 220, pageX: 0, pageY: 40 },
  });
  return server;
}

async function rows(server: NativeUIBridgeServer, path: string): Promise<Map<string, MediaRow>> {
  const res = await server.handleRequest({ method: 'GET', path, headers: {}, query: {} });
  const parsed = JSON.parse(res.body) as { data: { elements: MediaRow[] } };
  return new Map(parsed.data.elements.map((e) => [e.id, e]));
}

const EXPECTED_MEDIA = {
  kind: 'img',
  rendered_px: { w: 393, h: 220 },
  object_fit: 'fill',
  alt: { decorative: false, text: 'Hero' },
  src_digest: SHARED_DIGEST,
  in_viewport: true,
};

describe('image media on every element-serving route', () => {
  for (const path of [
    '/ui-bridge/control/snapshot',
    '/ui-bridge/control/discover',
    '/ui-bridge/control/elements',
  ]) {
    it(`${path} carries the image's media, no text, no fabricated background`, async () => {
      const hero = (await rows(buildServer(), path)).get('hero');
      expect(hero?.media).toEqual(EXPECTED_MEDIA);
      expect(hero?.text).toBeUndefined();
      expect(hero?.bg_color).toBeUndefined();
    });
  }
});
