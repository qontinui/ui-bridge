/**
 * Regression contract — `executeCommand('pageHealth', ...)`.
 *
 * The in-app `pageHealth` command is how a WS client (the qontinui-runner)
 * asks a connected app for the SDK's page-health producer instead of running
 * its own port of the analyzer. It must answer exactly what the server
 * `pageHealth` handler answers — an `Observation<PageHealthValue>` under
 * producer `sdk/page-health` — and "could not look" must be a typed
 * `unknown`, never a thrown command error and never a CRITICAL report over
 * zero elements.
 *
 * Plan: 2026-09-20-ui-bridge-observations-distinguish-cannot-see-from-not-present-and-carry-provenance
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeCommand, type BridgeAccess } from './commandHandlers';
import { getGlobalRegistry, resetGlobalRegistry } from '../core/registry';
import { SDK_PAGE_HEALTH_PRODUCER_ID, type PageHealthObservation } from '../server/page-health';
import { createHandlers, type RegistryLike } from '../server/handlers';

const emptyBridge: BridgeAccess = {
  elements: [],
  getElement: () => undefined,
  components: [],
  workflows: [],
};

async function pageHealth(): Promise<PageHealthObservation> {
  return (await executeCommand('pageHealth', {}, emptyBridge)) as PageHealthObservation;
}

/** A DOM element that lays out at the given pixel rect inside jsdom's viewport. */
function laidOut(
  container: HTMLElement,
  tag: string,
  text: string,
  rect: { x: number; y: number; width: number; height: number }
): HTMLElement {
  const el = document.createElement(tag);
  el.textContent = text;
  container.appendChild(el);
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    ...rect,
    top: rect.y,
    left: rect.x,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
    toJSON: () => ({}),
  } as DOMRect);
  return el;
}

function populate(container: HTMLElement): void {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const registry = getGlobalRegistry();
  registry.registerElement(
    'title',
    laidOut(container, 'h1', 'Dashboard', { x: 0, y: 0, width: vw, height: vh * 0.1 })
  );
  registry.registerElement(
    'body',
    laidOut(container, 'p', 'Quarterly revenue grew', {
      x: vw * 0.1,
      y: vh * 0.2,
      width: vw * 0.8,
      height: vh * 0.6,
    })
  );
  registry.registerElement(
    'save',
    laidOut(container, 'button', 'Save', {
      x: vw * 0.4,
      y: vh * 0.85,
      width: vw * 0.2,
      height: vh * 0.1,
    })
  );
}

describe('executeCommand · pageHealth', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    resetGlobalRegistry();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
    resetGlobalRegistry();
    vi.restoreAllMocks();
  });

  it('a populated registry answers measured with a PageHealthValue under sdk/page-health', async () => {
    populate(container);

    const obs = await pageHealth();

    expect(obs.provenance.producer.id).toBe(SDK_PAGE_HEALTH_PRODUCER_ID);
    expect(obs.status).toBe('measured');
    if (obs.status !== 'measured') return;
    expect(obs.value.element_count).toBe(3);
    expect(obs.value.visible_count).toBe(3);
    expect(Array.isArray(obs.value.findings)).toBe(true);
    expect(['OK', 'WARNING', 'CRITICAL']).toContain(obs.value.summary);
    expect(obs.value.heatmap).toHaveLength(20);
  });

  it('zero elements and zero components answers unknown{producer_not_run}, never unhealthy', async () => {
    const obs = await pageHealth();

    expect(obs.status).toBe('unknown');
    if (obs.status !== 'unknown') return;
    expect(obs.unknown.code).toBe('producer_not_run');
    expect(obs.provenance.producer.id).toBe(SDK_PAGE_HEALTH_PRODUCER_ID);
    const body = JSON.stringify(obs);
    expect(body).not.toMatch(/unhealthy/i);
    expect(body).not.toMatch(/CRITICAL/);
    expect(obs).not.toHaveProperty('value');
  });

  it('a snapshot that throws answers unknown{producer_failed}, not a rejected command', async () => {
    vi.spyOn(getGlobalRegistry(), 'createSnapshot').mockImplementation(() => {
      throw new Error('registry exploded');
    });

    const obs = await pageHealth();

    expect(obs.status).toBe('unknown');
    if (obs.status !== 'unknown') return;
    expect(obs.unknown.code).toBe('producer_failed');
    expect(obs.unknown.detail).toContain('registry exploded');
  });

  it('a snapshot with no elements array answers unknown{input_missing}, not []-coerced', async () => {
    vi.spyOn(getGlobalRegistry(), 'createSnapshot').mockReturnValue(
      {} as ReturnType<ReturnType<typeof getGlobalRegistry>['createSnapshot']>
    );

    const obs = await pageHealth();

    expect(obs.status).toBe('unknown');
    if (obs.status !== 'unknown') return;
    expect(obs.unknown.code).toBe('input_missing');
  });
  it('a throwing registry read outside the snapshot still answers unknown, not a rejected command', async () => {
    // The dispatcher's shared prologue reads getAllElements & co. for every
    // other command; pageHealth must not depend on it.
    vi.spyOn(getGlobalRegistry(), 'getAllElements').mockImplementation(() => {
      throw new Error('prologue exploded');
    });

    const obs = await pageHealth();

    expect(obs.status).toBe('unknown');
    if (obs.status !== 'unknown') return;
    // createSnapshot reads the same registry, so the throw lands inside the
    // producer's guard and is reported as a producer failure.
    expect(obs.unknown.code).toBe('producer_failed');
    expect(obs.unknown.detail).toContain('prologue exploded');
  });

  it('answers the same report as the server pageHealth handler over the same registry', async () => {
    populate(container);
    const handlers = createHandlers(
      getGlobalRegistry() as unknown as RegistryLike,
      { executeAction: async () => ({ success: true }) } as never,
      { idleDetection: false }
    );

    const fromCommand = await pageHealth();
    const fromServer = await handlers.pageHealth();

    expect(fromServer.success).toBe(true);
    const server = fromServer.data as PageHealthObservation;
    expect(fromCommand.status).toBe('measured');
    expect(server.status).toBe('measured');
    if (fromCommand.status !== 'measured' || server.status !== 'measured') return;
    expect(fromCommand.value).toEqual(server.value);
    expect(fromCommand.provenance.producer).toEqual(server.provenance.producer);
    expect(fromCommand.provenance.coverage).toEqual(server.provenance.coverage);
  });
});
