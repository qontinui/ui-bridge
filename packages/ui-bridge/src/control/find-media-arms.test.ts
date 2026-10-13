/**
 * One media filter, four find arms — plan
 * 2026-10-13-image-generation-and-visual-judgment, Phase 5 steps 1–2.
 *
 * `find` has four producers: the executor (`DefaultActionExecutor.find()`),
 * the in-page server handler (`createHandlers(...).find`), the live relay
 * (`executeCommand('find')`, what the runner's `/ui-bridge/sdk/*` proxy
 * reaches), and the relay server's CACHED fallback (`createRelayHandlers`,
 * answering from the last snapshot when the browser does not). Before this
 * phase only the executor honoured any media option: the server handler and
 * both relay arms returned the media rows (they are in the registry) and
 * ignored every media predicate, so `find {mediaOnly: true}` over the relay
 * answered with the whole page; and the executor's own `mediaOnly` still
 * returned every interactive row.
 *
 * Every filter is asserted on EVERY arm against one fixture page, so an arm
 * that drifts fails by name. Where an arm cannot honour an option it must say
 * so with a typed code — never answer as if the page had nothing there.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getGlobalRegistry, type UIBridgeRegistry } from '../core/registry';
import { DefaultActionExecutor } from './action-executor';
import { createHandlers, type RegistryLike } from '../server/handlers';
import { createRelayHandlers } from '../server/relay-handlers';
import { CommandRelay } from '../server/command-relay';
import { executeCommand, type BridgeAccess } from '../react/commandHandlers';
import { isFindRefusalError } from '../core/find-filter';
import { isMediaObservation } from '../core/media-observation';
import type { FindRequest, FindResponse } from './types';
import {
  makeImage,
  registerMedia,
  setDevicePixelRatio,
  stubBox,
} from '../react/__tests__/media-fixture';

const bridge: BridgeAccess = {
  elements: [],
  getElement: () => undefined,
  components: [],
  workflows: [],
};

type Row = {
  id: string;
  category?: string;
  mediaMetadata?: unknown;
  state?: { mediaMetadata?: unknown };
};
type ArmAnswer =
  | { ok: true; rows: Row[]; unevaluated?: FindResponse['unevaluated'] }
  | { ok: false; code: string };

/** The four arms, each answering one FindRequest over the global registry. */
const ARMS: Record<string, (req: FindRequest) => Promise<ArmAnswer>> = {
  async executor(req) {
    try {
      const res = await new DefaultActionExecutor(getGlobalRegistry()).find(req);
      return { ok: true, rows: res.elements as Row[], unevaluated: res.unevaluated };
    } catch (err) {
      if (isFindRefusalError(err)) return { ok: false, code: err.code };
      throw err;
    }
  },
  async server(req) {
    const registry = getGlobalRegistry();
    const handlers = createHandlers(
      registry as unknown as RegistryLike,
      new DefaultActionExecutor(registry) as never
    );
    const res = await handlers.find({ ...req, skipSettle: true });
    return res.success
      ? {
          ok: true,
          rows: (res.data as FindResponse).elements as Row[],
          unevaluated: (res.data as FindResponse).unevaluated,
        }
      : { ok: false, code: String(res.code) };
  },
  async relay(req) {
    const res = (await executeCommand('find', { ...req, skipSettle: true }, bridge)) as
      | FindResponse
      | { success: false; code: string };
    return 'elements' in res
      ? { ok: true, rows: res.elements as Row[], unevaluated: res.unevaluated }
      : { ok: false, code: res.code };
  },
  async 'relay-cache'(req) {
    // The browser does not answer `find`; the relay serves its cached
    // snapshot — a real one, serialized by this registry.
    const relay = new CommandRelay({ globalPrefix: `__uiBridgeMediaArms_${Math.random()}` });
    vi.spyOn(relay, 'queueCommand').mockImplementation((async (action: string) => {
      if (action === 'getControlSnapshot') return getGlobalRegistry().createSnapshot();
      throw new Error('timeout: no browser answered');
    }) as never);
    const res = await createRelayHandlers(relay).find({ ...req, skipSettle: true });
    return res.success
      ? {
          ok: true,
          rows: (res.data as FindResponse).elements as Row[],
          unevaluated: (res.data as FindResponse).unevaluated,
        }
      : { ok: false, code: String(res.code) };
  },
};

const ALL_MEDIA = ['broken', 'chart', 'clip', 'decorative', 'hero', 'logo', 'noalt', 'pending'];

function ids(answer: ArmAnswer): string[] {
  if (!answer.ok) throw new Error(`arm refused: ${answer.code}`);
  return answer.rows.map((r) => r.id).sort();
}

function mediaRowIds(answer: ArmAnswer): string[] {
  if (!answer.ok) throw new Error(`arm refused: ${answer.code}`);
  return answer.rows
    .filter((r) => r.category === 'media')
    .map((r) => r.id)
    .sort();
}

/** The fixture page: eight media rows, one interactive row, one content row. */
function buildPage(registry: UIBridgeRegistry): void {
  // DPR 1: `hero` carries 4x the pixels its box shows; `logo` exactly 1x.
  registerMedia(
    registry,
    'hero',
    makeImage({ alt: 'Hero', src: '/img/hero.png', natural: [400, 400], rendered: [100, 100] }),
    'Hero'
  );
  registerMedia(
    registry,
    'logo',
    makeImage({
      alt: 'Logo',
      src: 'https://cdn.example.com/logo.png',
      natural: [100, 100],
      rendered: [100, 100],
    }),
    'Logo'
  );
  registerMedia(
    registry,
    'broken',
    makeImage({ alt: 'Broken', src: '/img/missing.png', natural: [0, 0] }),
    'Broken'
  );
  registerMedia(
    registry,
    'noalt',
    makeImage({ alt: null, src: '/img/noalt.png', natural: [50, 50], rendered: [50, 50] }),
    'noalt.png'
  );
  registerMedia(
    registry,
    'decorative',
    makeImage({ alt: '', src: '/img/spacer.gif', natural: [1, 1], rendered: [1, 1] }),
    'spacer.gif'
  );
  registerMedia(
    registry,
    'pending',
    makeImage({ alt: 'Pending', src: '/img/pending.png', complete: false }),
    'Pending'
  );

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-label', 'Chart');
  svg.setAttribute('viewBox', '0 0 10 10');
  stubBox(svg, 200, 100);
  document.body.appendChild(svg);
  registerMedia(registry, 'chart', svg as unknown as HTMLElement, 'Chart');

  const video = document.createElement('video');
  video.setAttribute('aria-label', 'Clip');
  stubBox(video, 320, 180);
  document.body.appendChild(video);
  registerMedia(registry, 'clip', video, 'Clip');

  const button = document.createElement('button');
  button.textContent = 'Save';
  stubBox(button, 80, 30);
  document.body.appendChild(button);
  registry.registerElement('save', button, { type: 'button', actions: ['click'], label: 'Save' });

  const heading = document.createElement('h2');
  heading.textContent = 'Gallery';
  stubBox(heading, 300, 40);
  document.body.appendChild(heading);
  registry.registerContentElement('gallery-heading', heading, {
    contentType: 'heading',
    contentMetadata: { contentRole: 'heading', headingLevel: 2 },
    label: 'Gallery',
  });
}

describe.each(Object.keys(ARMS))('the %s arm', (arm) => {
  const find = (req: FindRequest) => ARMS[arm](req);
  let restoreDpr: () => void;

  beforeEach(() => {
    restoreDpr = setDevicePixelRatio(1);
    buildPage(getGlobalRegistry());
  });

  afterEach(() => {
    restoreDpr();
    getGlobalRegistry().clear();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('with no media option, media rows are IN (the superset invariant)', async () => {
    const answer = await find({});
    expect(mediaRowIds(answer)).toEqual(ALL_MEDIA);
    expect(ids(answer)).toEqual(expect.arrayContaining(['save', 'gallery-heading']));
  });

  it('mediaOnly returns ONLY media rows', async () => {
    expect(ids(await find({ mediaOnly: true }))).toEqual(ALL_MEDIA);
  });

  it('includeMedia: false drops every media row and nothing else', async () => {
    const answer = await find({ includeMedia: false });
    expect(mediaRowIds(answer)).toEqual([]);
    expect(ids(answer)).toEqual(expect.arrayContaining(['save', 'gallery-heading']));
  });

  it('mediaType selects one media type', async () => {
    expect(ids(await find({ mediaType: 'svg' }))).toEqual(['chart']);
    expect(ids(await find({ mediaType: 'video' }))).toEqual(['clip']);
  });

  it('brokenOnly selects the image that failed to load', async () => {
    expect(ids(await find({ brokenOnly: true }))).toEqual(['broken']);
  });

  it('missingAltOnly selects the image with NO alt — not the decorative one', async () => {
    expect(ids(await find({ missingAltOnly: true }))).toEqual(['noalt']);
  });

  it('srcPattern matches the displayed URL behind the ReDoS guard', async () => {
    expect(ids(await find({ srcPattern: 'cdn\\.example\\.com' }))).toEqual(['logo']);
    // A nested-quantifier pattern is matched as a literal substring, not run.
    expect(ids(await find({ srcPattern: '(a+)+' }))).toEqual([]);
  });

  it('oversizeThreshold returns only the proven match and REPORTS what it could not evaluate', async () => {
    // hero is 4.0. logo (1.0), the vector SVG and the broken image (it has no
    // resolution at all) do not match. `pending` and the unloaded video are
    // UNMEASURED: not returned — a filter never passes a row it cannot
    // evaluate — and not silently gone: both are reported, with the code.
    const answer = await find({ oversizeThreshold: 2 });
    expect(ids(answer)).toEqual(['hero']);
    if (!answer.ok) return;
    expect([...(answer.unevaluated ?? [])].sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: 'clip', option: 'oversizeThreshold', code: 'input_missing' },
      { id: 'pending', option: 'oversizeThreshold', code: 'input_missing' },
    ]);
  });

  it('a media-fact filter every row could answer reports unevaluated: []', async () => {
    const answer = await find({ mediaType: 'svg' });
    expect(answer.ok && answer.unevaluated).toEqual([]);
  });

  it('a find with no media-fact filter carries no unevaluated list', async () => {
    const answer = await find({ mediaOnly: true });
    expect(answer.ok && answer.unevaluated).toBeUndefined();
  });

  it('every media row carries its observation, top-level AND in state', async () => {
    const answer = await find({ mediaOnly: true });
    if (!answer.ok) throw new Error(answer.code);
    for (const row of answer.rows) {
      expect(isMediaObservation(row.mediaMetadata), `${row.id} top-level`).toBe(true);
      expect(isMediaObservation(row.state?.mediaMetadata), `${row.id} state`).toBe(true);
    }
  });

  it('a request that contradicts itself is refused typed, not answered empty', async () => {
    const answer = await find({ mediaOnly: true, interactiveOnly: true });
    expect(answer).toEqual({ ok: false, code: 'UB-VALIDATION-ERROR' });
  });

  it('a media question over an EMPTY registry is producer_not_run, not "no media"', async () => {
    getGlobalRegistry().clear();
    const answer = await find({ mediaOnly: true });
    expect(answer).toEqual({ ok: false, code: 'UB-OBS-PRODUCER-NOT-RUN' });
  });
});

describe('arm-specific behaviour', () => {
  let restoreDpr: () => void;

  beforeEach(() => {
    restoreDpr = setDevicePixelRatio(1);
    buildPage(getGlobalRegistry());
  });

  afterEach(() => {
    restoreDpr();
    getGlobalRegistry().clear();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('the executor includes hidden elements by default, as FindRequest documents', async () => {
    const hidden = document.createElement('button');
    hidden.textContent = 'Hidden';
    hidden.style.display = 'none';
    document.body.appendChild(hidden);
    getGlobalRegistry().registerElement('hidden-btn', hidden, {
      type: 'button',
      actions: ['click'],
    });

    const res = await new DefaultActionExecutor(getGlobalRegistry()).find({});
    expect(res.elements.map((e) => e.id)).toContain('hidden-btn');

    const visibleOnly = await new DefaultActionExecutor(getGlobalRegistry()).find({
      includeHidden: false,
    });
    expect(visibleOnly.elements.map((e) => e.id)).not.toContain('hidden-btn');
  });

  it('the cached arm refuses `selector` typed — its rows have no DOM', async () => {
    const answer = await ARMS['relay-cache']({ selector: 'img' });
    expect(answer).toEqual({ ok: false, code: 'UB-OBS-CAPABILITY-UNAVAILABLE-IN-BUILD' });
  });

  it('the live arms honour `selector` and `root` against the DOM', async () => {
    for (const arm of ['executor', 'server', 'relay']) {
      expect(mediaRowIds(await ARMS[arm]({ selector: 'video' })), arm).toEqual(['clip']);
      expect(await ARMS[arm]({ root: '#no-such-root' }), arm).toEqual({
        ok: false,
        code: 'UB-ELEM-NOT-FOUND',
      });
    }
  });

  it('the cached arm refuses a media-fact filter over rows that carry no observation', async () => {
    const relay = new CommandRelay({ globalPrefix: `__uiBridgeLegacy_${Math.random()}` });
    vi.spyOn(relay, 'queueCommand').mockImplementation((async (action: string) => {
      if (action !== 'getControlSnapshot') throw new Error('timeout');
      // A snapshot from an SDK build that predates the envelope.
      return {
        timestamp: Date.now(),
        elements: [
          {
            id: 'old-img',
            category: 'media',
            state: { visible: true },
            mediaMetadata: { mediaType: 'image', loadingState: 'error', isDecorative: false },
          },
        ],
        components: [],
        workflows: [],
      };
    }) as never);

    const res = await createRelayHandlers(relay).find({ brokenOnly: true });
    expect(res.success).toBe(false);
    expect(res.code).toBe('UB-OBS-CAPABILITY-UNAVAILABLE-IN-BUILD');
    // `mediaOnly` needs only the row's category, which the old build sent.
    const onlyMedia = await createRelayHandlers(relay).find({ mediaOnly: true });
    expect(onlyMedia.success).toBe(true);
  });

  it('a refusal the BROWSER answered is returned as-is — never replaced by a cache guess', async () => {
    const relay = new CommandRelay({ globalPrefix: `__uiBridgeRefusal_${Math.random()}` });
    const queue = vi.spyOn(relay, 'queueCommand').mockImplementation((async (action: string) => {
      if (action === 'find') {
        return { success: false, error: 'contradiction', code: 'UB-VALIDATION-ERROR' };
      }
      return getGlobalRegistry().createSnapshot();
    }) as never);

    const res = await createRelayHandlers(relay).find({ mediaOnly: true, interactiveOnly: true });
    expect(res.success).toBe(false);
    expect(res.code).toBe('UB-VALIDATION-ERROR');
    expect(queue).not.toHaveBeenCalledWith(
      'getControlSnapshot',
      expect.anything(),
      expect.anything()
    );
  });
});
