/**
 * Real Chromium: exec mode reads and acts on ONE element, end to end through
 * the functions the bin runs (`parseArgs`, `buildTransportOptions`,
 * `executeActions`) — plan
 * 2026-11-08-ui-bridge-inject-exec-mode-is-a-second-class-driver, Phases 2-3.
 *
 * The lines are Phase 6's acceptance lines (run A lines 2-9, run B lines 1-3)
 * against Phase 6's fixture, so the packed-build acceptance and this test ask
 * the same questions. What is proved on a real page:
 *   - `getElement` answers the element's identity, state and box, and reads
 *     back the effect of a click (`aria-pressed` false → true) and of
 *     focus / blur — where it used to throw `Unknown command action: getElement`
 *     (HANDLER_ERROR on the CLI's error channel);
 *   - the flat and `elementId` spellings of `executeElementAction` act — where
 *     the flat one threw the `fromSnapshotId` TypeError;
 *   - a missing element and a mis-shaped payload come back RETURNED, as
 *     `ELEMENT_NOT_FOUND` and `INVALID_REQUEST` naming the grammar.
 * It also drives `InjectedContext.element(id)` once through a registered
 * handler; that method has no other consumer.
 *
 * The in-page runtime is `@qontinui/ui-bridge`'s built injected bundle, so this
 * reads `packages/ui-bridge/dist` — build first. Gated on a Playwright Chromium
 * like every real-Chromium test (`test-support/chromium-gate.mjs`).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createTransport } from '../src/create-transport.js';
import {
  buildTransportOptions,
  executeActions,
  parseArgs,
  type ExecLine,
} from '../src/inject-cli.js';
import type { InjectedContext } from '../src/transports/injected.js';
import { chromiumAvailable } from '../../../test-support/chromium-gate.mjs';

const PLAYWRIGHT_AVAILABLE = chromiumAvailable();

/** Phase 6's fixture, verbatim. */
const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><title>exec-mode fixture</title></head><body>
<h1>Exec-mode fixture</h1>
<button data-testid="go" aria-pressed="false" onclick="this.setAttribute('aria-pressed', this.getAttribute('aria-pressed')==='true'?'false':'true')">Toggle</button>
<button data-testid="busy" disabled>Busy</button>
<input data-testid="query" placeholder="Search" />
</body></html>`;

/** The literal Phase 6 run B line 2 reads in the refusal. */
const SHAPE_PREFIX = '{"id":"<elementId>","request":{"action":"<action>"';

/** Phase 6 run A, lines 2-9. */
const RUN_A = [
  'getElement {"id":"dom-go"}',
  'getElement {"elementId":"dom-busy"}',
  'executeElementAction {"id":"dom-go","request":{"action":"click"}}',
  'getElement {"id":"dom-go"}',
  'executeElementAction {"elementId":"dom-query","action":"focus"}',
  'getElement {"id":"dom-query"}',
  'executeElementAction {"elementId":"dom-query","request":{"action":"blur"}}',
  'getElement {"id":"dom-query"}',
];

/** Phase 6 run B, lines 1-3. */
const RUN_B = [
  'getElement {"id":"dom-nope"}',
  'executeElementAction {"elementId":"dom-query"}',
  'executeElementAction {"id":"dom-go","elementId":"dom-busy","request":{"action":"click"}}',
];

interface ElementResult {
  id: string;
  tagName: string;
  bbox?: { x: number; y: number; width: number; height: number };
  state: { ariaPressed?: boolean | 'mixed'; enabled: boolean; focused: boolean };
}

/** The element-read handler id the context method is driven through. */
const CONTEXT_ELEMENT = '__parity_context_element';

let server: Server;
let url: string;

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(FIXTURE);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** Launch the injected transport the way `ui-bridge-inject --exec` does and run `execs`. */
async function runExec(
  execs: readonly string[],
  extra?: (transport: ReturnType<typeof createTransport>) => Promise<void>
): Promise<{ anyError: boolean; lines: ExecLine[] }> {
  const args = parseArgs(['--url', url, ...execs.flatMap((e) => ['--exec', e]), '--quiet']);
  const transport = createTransport({ kind: 'injected', options: buildTransportOptions(args) });
  transport.register(CONTEXT_ELEMENT, (params: unknown, ctx: unknown) =>
    (ctx as InjectedContext).element((params as { id: string }).id)
  );
  const lines: ExecLine[] = [];
  try {
    await transport.ready();
    const anyError = await executeActions(
      transport,
      args.execActions,
      () => null,
      (line) => lines.push(line)
    );
    if (extra) await extra(transport);
    return { anyError, lines };
  } finally {
    await transport.close().catch(() => {});
  }
}

describe.skipIf(!PLAYWRIGHT_AVAILABLE)(
  'exec mode reads and acts on one element (real Chromium)',
  () => {
    it('run A: getElement reads identity, state and box, and reads back a click and focus/blur', async () => {
      let viaContext: unknown;
      let contextError: unknown;
      let viaExec: ExecLine[] = [];
      const { anyError, lines } = await runExec(RUN_A, async (transport) => {
        // `InjectedContext.element(id)`, then the exec read of the same id back
        // to back: the context method is the same read. A throw is kept, not
        // raised, so the per-line assertions below report first.
        try {
          viaContext = await transport.dispatch(CONTEXT_ELEMENT, { id: 'dom-go' });
        } catch (err) {
          contextError = err;
        }
        await executeActions(
          transport,
          [{ action: 'getElement', payload: { id: 'dom-go' } }],
          () => null,
          (line) => (viaExec = [line])
        );
      });

      // Every line is error-free: the run would exit 0.
      for (const line of lines) expect(line.error, JSON.stringify(line)).toBeUndefined();
      expect(anyError).toBe(false);
      expect(lines.map((l) => l.action)).toEqual([
        'getElement',
        'getElement',
        'executeElementAction',
        'getElement',
        'executeElementAction',
        'getElement',
        'executeElementAction',
        'getElement',
      ]);
      const r = lines.map((l) => l.result);

      // A2: identity, state and a box.
      const go = r[0] as ElementResult;
      expect(go.id).toBe('dom-go');
      expect(go.tagName).toBe('button');
      expect(go.state.ariaPressed).toBe(false);
      expect(go.state.enabled).toBe(true);
      expect(go.bbox).toBeDefined();
      expect(go.bbox!.width).toBeGreaterThan(0);
      expect(go.bbox!.height).toBeGreaterThan(0);
      // A3: the elementId spelling, on the disabled button.
      expect((r[1] as ElementResult).id).toBe('dom-busy');
      expect((r[1] as ElementResult).state.enabled).toBe(false);
      // A4 / A5: the click's effect, read back through the Bridge.
      expect(r[2]).toMatchObject({ success: true });
      expect((r[3] as ElementResult).state.ariaPressed).toBe(true);
      // A6 / A7: the flat elementId spelling acts.
      expect(r[4]).toMatchObject({ success: true });
      expect((r[5] as ElementResult).state.focused).toBe(true);
      // A8 / A9: the elementId + request spelling acts.
      expect(r[6]).toMatchObject({ success: true });
      expect((r[7] as ElementResult).state.focused).toBe(false);

      // InjectedContext.element('dom-go') is the same read as exec's getElement.
      expect(contextError).toBeUndefined();
      expect(viaContext).toMatchObject({
        id: 'dom-go',
        tagName: 'button',
        state: { ariaPressed: true, enabled: true },
      });
      expect(viaExec[0]!.error).toBeUndefined();
      expect(viaContext).toEqual(viaExec[0]!.result);
    }, 120_000);

    it('run B: a missing element and two mis-shaped payloads come back as RETURNED typed errors', async () => {
      const { anyError, lines } = await runExec(RUN_B);

      // The run would exit 1, with exactly these errors and one line per action.
      expect(anyError).toBe(true);
      expect(lines).toHaveLength(3);
      const [nope, noAction, twoIds] = lines.map((l) => l.error);

      expect(nope).toMatchObject({ code: 'ELEMENT_NOT_FOUND', source: 'returned' });
      expect(nope!.message).toBe('Element dom-nope not found');

      expect(noAction).toMatchObject({ code: 'INVALID_REQUEST', source: 'returned' });
      expect(noAction!.message).toContain(SHAPE_PREFIX);
      expect(noAction!.message).toContain('names no action');

      expect(twoIds).toMatchObject({ code: 'INVALID_REQUEST', source: 'returned' });
      expect(twoIds!.message).toContain(
        'names two elements: "id" is "dom-go" but "elementId" is "dom-busy"'
      );
    }, 120_000);
  }
);
