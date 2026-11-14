/**
 * The design-inspection routes answer with one model over both transports.
 *
 * `/design/element/:id/styles`, `/design/snapshot`, `/design/responsive` and
 * `/design/audit` are served by the server handlers (`createHandlers`, reading
 * the registry directly) and by the browser dispatcher (`executeCommand`, which
 * the relay and the in-page `ui-bridge-inject` mode both land on). The browser
 * side used to be a cut-down reimplementation: ~22 computed properties, no
 * custom properties, no pseudo-elements, a snapshot silently cut at 50
 * elements, responsive snapshots refused, and an audit that ignored the style
 * guide for four heuristics over the first 100 elements.
 *
 * Both now call `specs/design-request.ts`. These tests drive the BROWSER path —
 * `executeCommand` directly, and through a relay whose tab runs it — and
 * compare it with the server handlers over one registry.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeCommand, type BridgeAccess } from './commandHandlers';
import { getGlobalRegistry, resetGlobalRegistry, REDACTED_VALUE } from '../core/registry';
import type { ElementDesignData, ElementType } from '../core/types';
import { createHandlers, type RegistryLike } from '../server/handlers';
import { createRelayHandlers } from '../server/relay-handlers';
import { CommandRelay } from '../server/command-relay';
import { DefaultActionExecutor } from '../control/action-executor';
import type { StyleGuideConfig } from '../specs/style-types';
import { scrubStyleUrls } from '../ai/design-inspector';
import type {
  DesignAuditResponse,
  DesignSnapshotResponse,
  ResponsiveSnapshotsResponse,
} from '../specs/design-request';

const emptyBridge: BridgeAccess = {
  elements: [],
  getElement: () => undefined,
  components: [],
  workflows: [],
};

function serverHandlers(): ReturnType<typeof createHandlers> {
  const registry = getGlobalRegistry();
  return createHandlers(
    registry as unknown as RegistryLike,
    new DefaultActionExecutor(registry) as never,
    { idleDetection: false }
  );
}

const openRelays: Array<{ relay: CommandRelay; unsubscribe: () => void }> = [];

function closeRelays(): void {
  for (const { relay, unsubscribe } of openRelays.splice(0)) {
    unsubscribe();
    relay.destroy();
  }
}

/** Relay handlers whose one tab answers every command with the real in-page dispatcher. */
function relayHandlers(): ReturnType<typeof createRelayHandlers> {
  const relay = new CommandRelay({
    globalPrefix: `__uiBridgeTest_${Math.random().toString(36).slice(2, 10)}`,
    proactiveSnapshot: false,
  });
  const unsubscribe = relay.subscribeToCommands((command) => {
    void executeCommand(
      command.action,
      command.payload as Record<string, unknown>,
      emptyBridge
    ).then(
      (result) => relay.resolveCommand(command.commandId, result, 'tab-a'),
      (err: unknown) => relay.rejectCommand(command.commandId, String(err))
    );
  }, 'tab-a');
  openRelays.push({ relay, unsubscribe });
  return createRelayHandlers(relay);
}

/** Run one command on the browser path, as the relay and the injected runtime do. */
function browser<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  return executeCommand(action, payload, emptyBridge) as Promise<T>;
}

/** Drop the per-run fields (when it ran, how long it took) at any depth. */
function stable<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (key, v) => (key === 'timestamp' || key === 'durationMs' ? undefined : v))
  ) as T;
}

/**
 * jsdom does not compute pseudo-element styles (`getComputedStyle(el, '::before')`
 * is "not implemented" and answers the element's own style), so stand in a
 * browser's answer: `#dom-save::before` exists, nothing else has one.
 */
function stubPseudoElementStyles(): void {
  const real = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
    if (!pseudo) return real(el);
    const exists = pseudo === '::before' && (el as Element).id === 'dom-save';
    const values: Record<string, string> = exists
      ? {
          content: '"→"',
          color: 'rgb(0, 128, 0)',
          'background-image': 'url("https://cdn.test/p.png?token=x")',
        }
      : { content: 'none' };
    return { getPropertyValue: (prop: string) => values[prop] ?? '' } as CSSStyleDeclaration;
  });
}

const GUIDE: StyleGuideConfig = {
  version: '1',
  name: 'brand guide',
  tokens: {
    colors: { primary: 'rgb(0, 0, 255)' },
    typography: {
      fontFamilies: {},
      fontSizes: {},
      fontWeights: {},
      lineHeights: {},
      letterSpacings: {},
    },
    spacing: {},
    borderRadius: {},
    shadows: {},
    breakpoints: {},
  },
  rules: [
    {
      id: 'button-primary-color',
      elementType: 'button',
      constraints: [{ type: 'tokenRef', property: 'color', tokenPath: 'colors.primary' }],
      severity: 'error',
    },
  ],
};

describe('design-inspection routes · the browser path answers the full model', () => {
  let container: HTMLDivElement;
  let sheet: HTMLStyleElement;

  function register(id: string, tag: string, text: string, type: ElementType): HTMLElement {
    const el = document.createElement(tag);
    el.id = `dom-${id}`;
    el.textContent = text;
    container.appendChild(el);
    getGlobalRegistry().registerElement(id, el, { type, label: text });
    return el;
  }

  beforeEach(() => {
    resetGlobalRegistry();
    sheet = document.createElement('style');
    sheet.textContent = [
      '#dom-save { --brand-color: rgb(255, 0, 0); color: rgb(255, 0, 0); letter-spacing: 2px; }',
    ].join('\n');
    stubPseudoElementStyles();
    document.head.appendChild(sheet);
    container = document.createElement('div');
    document.body.appendChild(container);
    register('title', 'h1', 'Dashboard', 'generic');
    const save = register('save', 'button', 'Save', 'button');
    save.style.setProperty('--inline-token', '4px');
    register('name', 'input', '', 'input');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    closeRelays();
    container.remove();
    sheet.remove();
    document.documentElement.removeAttribute('style');
    resetGlobalRegistry();
  });

  // ---------------------------------------------------------------- styles

  it('getElementStyles returns ElementDesignData with custom properties and pseudo-elements', async () => {
    const data = await browser<ElementDesignData>('getElementStyles', { id: 'save' });

    expect(data.elementId).toBe('save');
    expect(data.type).toBe('button');
    expect(data.customProperties).toMatchObject({
      '--brand-color': 'rgb(255, 0, 0)',
      '--inline-token': '4px',
    });
    expect(data.pseudoElements?.map((p) => p.selector)).toEqual(['::before']);
    expect(data.styles).toHaveProperty('letterSpacing');
    expect(data.styles.color).toBe('rgb(255, 0, 0)');
    expect(data.rect).toEqual(expect.objectContaining({ width: expect.any(Number) }));
  });

  it('getElementStyles fails an unknown id with the server’s code, not a success-wrapped error', async () => {
    const server = await serverHandlers().getElementStyles('nope');
    const relay = await relayHandlers().getElementStyles('nope');
    expect(server.success).toBe(false);
    expect(relay.success).toBe(false);
    expect(relay.code).toBe(server.code);
    expect(relay.error).toBe(server.error);
  });

  it('getElementStyles collapses a redacted element’s label and generated content', async () => {
    const save = document.getElementById('dom-save')!;
    save.setAttribute('data-bridge-redact', 'true');
    save.style.setProperty('--who', "'Alice Smith'");
    save.style.setProperty('background-image', 'url("https://cdn.test/a.png?token=s3cr3t")');
    const data = await browser<ElementDesignData>('getElementStyles', { id: 'save' });
    expect(data.label).toBe(REDACTED_VALUE);
    expect(data.pseudoElements?.[0].content).toBe(REDACTED_VALUE);
    // Token names stay (design data); every value collapses.
    expect(data.customProperties?.['--who']).toBe(REDACTED_VALUE);
    expect(data.customProperties?.['--brand-color']).toBe(REDACTED_VALUE);
    expect(data.customProperties?.['--inline-token']).toBe(REDACTED_VALUE);
    // The element still reports a background image, not which one.
    expect(data.styles.backgroundImage).toBe(`url("${REDACTED_VALUE}")`);
    // So does its generated content.
    expect(data.pseudoElements?.[0].styles.backgroundImage).toBe(`url("${REDACTED_VALUE}")`);
    const wire = JSON.stringify(data);
    expect(wire).not.toContain('Alice');
    expect(wire).not.toContain('s3cr3t');
    expect(wire).not.toContain('cdn.test');
  });

  it('getElementStyles keeps custom-property values and URLs outside a redaction boundary', async () => {
    const save = document.getElementById('dom-save')!;
    save.style.setProperty('--who', "'Alice Smith'");
    save.style.setProperty('background-image', 'url("https://cdn.test/a.png")');
    const data = await browser<ElementDesignData>('getElementStyles', { id: 'save' });
    expect(data.customProperties?.['--who']).toBe("'Alice Smith'");
    expect(data.styles.backgroundImage).toContain('cdn.test/a.png');
  });

  // -------------------------------------------------------------- snapshot

  it('getDesignSnapshot honours elementIds and includePseudoElements', async () => {
    const out = await browser<DesignSnapshotResponse>('getDesignSnapshot', {
      elementIds: ['save', 'name'],
      includePseudoElements: true,
    });
    expect(out.elements.map((e) => e.elementId)).toEqual(['save', 'name']);
    expect(out.elements[0].pseudoElements?.length).toBe(1);
    expect(out.elements[0].customProperties).toHaveProperty('--brand-color');
    expect(out).toMatchObject({ totalElements: 2, returned: 2, truncated: false });

    const without = await browser<DesignSnapshotResponse>('getDesignSnapshot', {
      elementIds: ['save'],
    });
    expect(without.elements[0].pseudoElements).toBeUndefined();
  });

  it('getDesignSnapshot reports unknown ids and elements it could not read', async () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    container.appendChild(svg);
    getGlobalRegistry().registerElement('chart', svg as unknown as HTMLElement, {
      type: 'generic',
    });
    const out = await browser<DesignSnapshotResponse>('getDesignSnapshot', {
      elementIds: ['save', 'chart', 'ghost'],
    });
    expect(out.elements.map((e) => e.elementId)).toEqual(['save']);
    expect(out).toMatchObject({
      totalElements: 1,
      returned: 1,
      missingElementIds: ['ghost'],
      unreadableElementIds: ['chart'],
    });

    const all = await browser<DesignSnapshotResponse>('getDesignSnapshot', {});
    expect(all).toMatchObject({ missingElementIds: [], unreadableElementIds: ['chart'] });
  });

  it('getDesignSnapshot echoes at most 50 unknown ids and counts them all', async () => {
    const ghosts = Array.from({ length: 60 }, (_, i) => `ghost-${i}`);
    const out = await browser<DesignSnapshotResponse>('getDesignSnapshot', {
      elementIds: ['save', ...ghosts],
    });
    expect(out.missingElementIds).toEqual(ghosts.slice(0, 50));
    expect(out.missingElementCount).toBe(60);
    expect(out.unreadableElementCount).toBe(0);
  });

  it('getDesignSnapshot reports a truncation, and the caller raises the bound', async () => {
    const cut = await browser<DesignSnapshotResponse>('getDesignSnapshot', { limit: 2 });
    expect(cut.elements).toHaveLength(2);
    expect(cut).toMatchObject({ totalElements: 3, returned: 2, limit: 2, truncated: true });

    const whole = await browser<DesignSnapshotResponse>('getDesignSnapshot', { limit: 3 });
    expect(whole).toMatchObject({ totalElements: 3, returned: 3, truncated: false });

    const byDefault = await browser<DesignSnapshotResponse>('getDesignSnapshot', {});
    expect(byDefault.limit).toBeGreaterThan(3);
    expect(byDefault).toMatchObject({ totalElements: 3, returned: 3, truncated: false });
  });

  it('getDesignSnapshot refuses a malformed limit with UB-VALIDATION-ERROR on both transports', async () => {
    for (const limit of [0, -1, 1.5, '10']) {
      const server = await serverHandlers().getDesignSnapshot({ limit } as never);
      const relay = await relayHandlers().getDesignSnapshot({ limit } as never);
      expect(server.success).toBe(false);
      expect(server.code).toBe('UB-VALIDATION-ERROR');
      expect({ success: relay.success, error: relay.error, code: relay.code }).toEqual({
        success: server.success,
        error: server.error,
        code: server.code,
      });
    }
  });

  // ------------------------------------------------------------ responsive

  it('getResponsiveSnapshots returns one snapshot per viewport and says media queries did not re-evaluate', async () => {
    const out = await browser<ResponsiveSnapshotsResponse>('getResponsiveSnapshots', {
      viewports: { narrow: 320, wide: 1024 },
    });
    expect(out.snapshots.map((s) => [s.viewportLabel, s.viewportWidth])).toEqual([
      ['narrow', 320],
      ['wide', 1024],
    ]);
    for (const snapshot of out.snapshots) {
      expect(snapshot.elements.map((e) => e.elementId)).toEqual(['title', 'save', 'name']);
    }
    expect(out.method).toBe('document-width-constraint');
    expect(out.mediaQueriesReevaluated).toBe(false);
    expect(out.windowInnerWidth).toBe(window.innerWidth);
    expect(out).toMatchObject({ totalElements: 3, returned: 3, truncated: false });
  });

  it('getResponsiveSnapshots restores the root’s inline styles exactly', async () => {
    const root = document.documentElement;
    root.setAttribute('style', 'width: 50% !important; overflow-x: scroll; color: red');
    const before = {
      width: root.style.getPropertyValue('width'),
      widthPriority: root.style.getPropertyPriority('width'),
      overflowX: root.style.getPropertyValue('overflow-x'),
      overflowY: root.style.getPropertyValue('overflow-y'),
      minWidth: root.style.getPropertyValue('min-width'),
      color: root.style.getPropertyValue('color'),
    };
    await browser('getResponsiveSnapshots', { viewports: [375] });
    expect({
      width: root.style.getPropertyValue('width'),
      widthPriority: root.style.getPropertyPriority('width'),
      overflowX: root.style.getPropertyValue('overflow-x'),
      overflowY: root.style.getPropertyValue('overflow-y'),
      minWidth: root.style.getPropertyValue('min-width'),
      color: root.style.getPropertyValue('color'),
    }).toEqual(before);

    root.removeAttribute('style');
    await browser('getResponsiveSnapshots', { viewports: [375] });
    expect(root.hasAttribute('style')).toBe(false);
  });

  it('two overlapping captures leave the root’s inline style exactly as before', async () => {
    const root = document.documentElement;
    root.setAttribute('style', 'color: red');
    const before = root.style.cssText;
    // The shorter capture first: unserialized, the longer one saves the
    // shorter one's constraint as the page's original and restores it last.
    const [a, b] = await Promise.all([
      browser<ResponsiveSnapshotsResponse>('getResponsiveSnapshots', { viewports: [768] }),
      browser<ResponsiveSnapshotsResponse>('getResponsiveSnapshots', { viewports: [320, 480] }),
    ]);
    expect(a.snapshots).toHaveLength(1);
    expect(b.snapshots).toHaveLength(2);
    expect(root.style.cssText).toBe(before);
  });

  it('a viewport constraint set during a capture is not undone by the capture’s restore', async () => {
    const root = document.documentElement;
    await Promise.all([
      browser('getResponsiveSnapshots', { viewports: [320, 480] }),
      browser('setViewportConstraints', { width: 500 }),
    ]);
    expect(root.style.getPropertyValue('max-width')).toBe('500px');
    expect(root.style.getPropertyValue('width')).toBe('500px');
  });

  it('getResponsiveSnapshots completes in a tab that runs no animation frames', async () => {
    vi.stubGlobal('requestAnimationFrame', () => 0);
    try {
      const out = await browser<ResponsiveSnapshotsResponse>('getResponsiveSnapshots', {
        viewports: [320, 768],
      });
      expect(out.snapshots).toHaveLength(2);
    } finally {
      vi.unstubAllGlobals();
    }
  }, 2_000);

  it('getResponsiveSnapshots refuses more than 16 viewports with UB-VALIDATION-ERROR on both transports', async () => {
    const viewports = Array.from({ length: 17 }, (_, i) => 300 + i);
    const server = await serverHandlers().getResponsiveSnapshots({ viewports });
    const relay = await relayHandlers().getResponsiveSnapshots({ viewports });
    expect(server.success).toBe(false);
    expect(server.code).toBe('UB-VALIDATION-ERROR');
    expect(server.error).toContain('at most 16 viewports');
    expect({ success: relay.success, error: relay.error, code: relay.code }).toEqual({
      success: server.success,
      error: server.error,
      code: server.code,
    });
  });

  it('getResponsiveSnapshots restores the root even when a capture throws', async () => {
    const root = document.documentElement;
    const save = document.getElementById('dom-save')!;
    save.getBoundingClientRect = () => {
      throw new Error('layout read failed');
    };
    const out = await browser<{ success: boolean; error: string }>('getResponsiveSnapshots', {
      viewports: [375],
    });
    expect(out.success).toBe(false);
    expect(out.error).toContain('layout read failed');
    expect(root.hasAttribute('style')).toBe(false);
  });

  it('getResponsiveSnapshots divides the record budget by the viewport count, and reports it', async () => {
    const out = await browser<ResponsiveSnapshotsResponse>('getResponsiveSnapshots', {
      viewports: [320, 768],
      limit: 1,
    });
    expect(out.snapshots.every((s) => s.elements.length === 1)).toBe(true);
    expect(out).toMatchObject({ totalElements: 3, returned: 1, limit: 1, truncated: true });

    const byDefault = await browser<ResponsiveSnapshotsResponse>('getResponsiveSnapshots', {
      viewports: [320, 768],
    });
    expect(byDefault.limit).toBe(125);
  });

  // ----------------------------------------------------------------- audit

  it('runDesignAudit with a guide in the request returns a StyleAuditReport that flags the violation', async () => {
    const report = await browser<DesignAuditResponse>('runDesignAudit', { guide: GUIDE });
    expect(report.mode).toBe('style-guide');
    if (report.mode !== 'style-guide') throw new Error('unreachable');
    expect(report.guideName).toBe('brand guide');
    expect(report.totalElements).toBe(3);
    expect(report.failedCount).toBe(1);
    expect(report.results).toEqual([expect.objectContaining({ elementId: 'save', passed: false })]);
    // Counted, not listed a second time.
    expect(report.summary).toEqual({ errors: 1, warnings: 0, info: 0 });
    expect(report).toMatchObject({ limit: 250, maxResults: 1000, resultsTruncated: false });
  });

  it('runDesignAudit with no limit reports the default bound in both modes', async () => {
    for (const guide of [GUIDE, undefined]) {
      const report = await browser<DesignAuditResponse>('runDesignAudit', { guide });
      expect(report).toMatchObject({ limit: 250, truncated: false });
    }
  });

  it('runDesignAudit bounds the listed results and says so', async () => {
    const guide: StyleGuideConfig = {
      ...GUIDE,
      rules: [
        { ...GUIDE.rules[0], id: 'r1', elementType: undefined },
        { ...GUIDE.rules[0], id: 'r2', elementType: undefined },
      ],
    };
    const report = await browser<DesignAuditResponse>('runDesignAudit', { guide, maxResults: 2 });
    if (report.mode !== 'style-guide') throw new Error('expected style-guide mode');
    expect(report.results).toHaveLength(2);
    expect(report.failedCount).toBe(6);
    expect(report).toMatchObject({ maxResults: 2, listableResults: 6, resultsTruncated: true });
  });

  it('runDesignAudit in heuristic mode does not claim an includePassed it ignores', async () => {
    const report = await browser<DesignAuditResponse>('runDesignAudit', {});
    expect(report).not.toHaveProperty('includePassed');
  });

  it('runDesignAudit lists failures only unless includePassed, and counts every result', async () => {
    const guide: StyleGuideConfig = {
      ...GUIDE,
      rules: [
        ...GUIDE.rules,
        {
          id: 'button-red',
          elementType: 'button',
          constraints: [{ type: 'exact', property: 'color', value: 'rgb(255, 0, 0)' }],
        },
      ],
    };
    const failures = await browser<DesignAuditResponse>('runDesignAudit', { guide });
    if (failures.mode !== 'style-guide') throw new Error('expected style-guide mode');
    expect(failures.results.map((r) => [r.ruleId, r.passed])).toEqual([
      ['button-primary-color', false],
    ]);
    expect(failures).toMatchObject({ passedCount: 1, failedCount: 1, includePassed: false });

    const all = await browser<DesignAuditResponse>('runDesignAudit', {
      guide,
      includePassed: true,
    });
    if (all.mode !== 'style-guide') throw new Error('expected style-guide mode');
    expect(all.results).toHaveLength(2);
    expect(all.includePassed).toBe(true);
  });

  it('runDesignAudit bounds the elements it checks and reports the cut, in both modes', async () => {
    for (const guide of [GUIDE, undefined]) {
      const report = await browser<DesignAuditResponse>('runDesignAudit', { guide, limit: 1 });
      expect(report).toMatchObject({
        totalElements: 3,
        checkedElements: 1,
        limit: 1,
        truncated: true,
      });
    }
    const whole = await browser<DesignAuditResponse>('runDesignAudit', { guide: GUIDE });
    expect(whole).toMatchObject({ totalElements: 3, checkedElements: 3, truncated: false });

    const refused = await relayHandlers().runDesignAudit({ limit: 0 } as never);
    expect(refused.success).toBe(false);
    expect(refused.code).toBe('UB-VALIDATION-ERROR');
  });

  it('runDesignAudit uses a guide loaded through the browser’s own loadStyleGuide', async () => {
    await browser('loadStyleGuide', { guide: GUIDE });
    try {
      const report = await browser<DesignAuditResponse>('runDesignAudit', {});
      expect(report.mode).toBe('style-guide');
    } finally {
      await browser('clearStyleGuide');
    }
  });

  it('runDesignAudit without any guide runs the heuristics, says so, and checks every element', async () => {
    const report = await browser<DesignAuditResponse>('runDesignAudit', {});
    expect(report.mode).toBe('heuristic');
    if (report.mode !== 'heuristic') throw new Error('unreachable');
    expect(report.reason).toMatch(/no style guide/i);
    expect(report.totalElements).toBe(3);
    expect(report.checkedElements).toBe(3);
    // jsdom lays nothing out, so the 0x0 button is under the 44px touch target.
    expect(report.issues).toContainEqual(
      expect.objectContaining({ element: 'save', severity: 'warning' })
    );
  });
});

describe('design-inspection routes · relay and server answer the same model', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    resetGlobalRegistry();
    container = document.createElement('div');
    document.body.appendChild(container);
    for (const [id, tag, type] of [
      ['title', 'h1', 'generic'],
      ['save', 'button', 'button'],
    ] as const) {
      const el = document.createElement(tag);
      el.textContent = id;
      el.style.setProperty('--token', '1px');
      container.appendChild(el);
      getGlobalRegistry().registerElement(id, el, { type: type as ElementType, label: id });
    }
    stubPseudoElementStyles();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    closeRelays();
    container.remove();
    document.documentElement.removeAttribute('style');
    resetGlobalRegistry();
  });

  it('getElementStyles', async () => {
    const server = await serverHandlers().getElementStyles('save');
    const relay = await relayHandlers().getElementStyles('save');
    expect(server.success).toBe(true);
    expect(relay.success).toBe(true);
    expect(relay.data).toEqual(server.data);
    expect(relay.data!.customProperties).toEqual({ '--token': '1px' });
  });

  it('getDesignSnapshot', async () => {
    const request = { elementIds: ['save', 'title'], includePseudoElements: true, limit: 1 };
    const server = await serverHandlers().getDesignSnapshot(request);
    const relay = await relayHandlers().getDesignSnapshot(request);
    expect(server.success).toBe(true);
    expect(stable(relay.data)).toEqual(stable(server.data));
    expect(relay.data).toMatchObject({ totalElements: 2, returned: 1, truncated: true });
  });

  it('getResponsiveSnapshots', async () => {
    const request = { viewports: { mobile: 375, desktop: 1280 } };
    const server = await serverHandlers().getResponsiveSnapshots(request);
    const relay = await relayHandlers().getResponsiveSnapshots(request);
    expect(server.success).toBe(true);
    expect(relay.success).toBe(true);
    expect(stable(relay.data)).toEqual(stable(server.data));
    expect(server.data).toMatchObject({
      method: 'document-width-constraint',
      mediaQueriesReevaluated: false,
    });
  });

  it('runDesignAudit, with a guide and without one', async () => {
    for (const request of [{ guide: GUIDE }, {}]) {
      const server = await serverHandlers().runDesignAudit(request);
      const relay = await relayHandlers().runDesignAudit(request);
      expect(server.success).toBe(true);
      expect(relay.success).toBe(true);
      expect(stable(relay.data)).toEqual(stable(server.data));
    }
  });
});

describe('design-inspection routes · the root-width lock', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    resetGlobalRegistry();
    container = document.createElement('div');
    document.body.appendChild(container);
    const el = document.createElement('button');
    el.textContent = 'Save';
    container.appendChild(el);
    getGlobalRegistry().registerElement('save', el, { type: 'button', label: 'Save' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    container.remove();
    document.documentElement.removeAttribute('style');
    resetGlobalRegistry();
  });

  /** Hold the lock until the returned release is called. */
  async function holdLock(
    lock: typeof import('../core/root-width-lock'),
    budgetMs = 5_000
  ): Promise<() => void> {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let entered!: () => void;
    const isHeld = new Promise<void>((resolve) => (entered = resolve));
    void lock.withRootWidthLock(
      () => {
        entered();
        return held;
      },
      { budgetMs }
    );
    await isHeld;
    return release;
  }

  it('two module instances of the SDK share one lock (one per page, not per bundle)', async () => {
    vi.resetModules();
    const a = await import('../core/root-width-lock');
    vi.resetModules();
    const b = await import('../core/root-width-lock');
    expect(a).not.toBe(b);

    const order: string[] = [];
    const release = await holdLock(a);
    const waiting = b.withRootWidthLock(() => {
      order.push('b ran');
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    order.push('a released');
    release();
    await waiting;
    expect(order).toEqual(['a released', 'b ran']);
  });

  it('refuses a waiter whose deadline passes, and its constraint never lands', async () => {
    const lock = await import('../core/root-width-lock');
    const release = await holdLock(lock);
    const refused = await browser<{ success: boolean; code: string; error: string }>(
      'setViewportConstraints',
      { width: 500, budgetMs: 30 }
    );
    expect(refused).toMatchObject({ success: false, code: 'UB-ACTION-TIMEOUT' });
    release();
    // The lock is still usable, and the refused constraint was never applied.
    await lock.withRootWidthLock(() => undefined);
    expect(document.documentElement.style.getPropertyValue('max-width')).toBe('');
  });

  it('a capture stops between viewports once its deadline is spent, and restores the page', async () => {
    const save = getGlobalRegistry().getElement('save')!.element as HTMLElement;
    const real = save.getBoundingClientRect.bind(save);
    save.getBoundingClientRect = () => {
      const until = Date.now() + 80;
      while (Date.now() < until) {
        // A slow layout read: longer than the whole budget.
      }
      return real();
    };
    const out = await browser<ResponsiveSnapshotsResponse>('getResponsiveSnapshots', {
      viewports: [320, 768, 1280],
      budgetMs: 50,
    });
    expect(out.timedOut).toBe(true);
    expect(out.requestedViewports).toBe(3);
    expect(out.snapshots.map((snap) => snap.viewportWidth)).toEqual([320]);
    expect(document.documentElement.hasAttribute('style')).toBe(false);
  });

  it('a capture that waited for the lock selects the registry as it is when it runs', async () => {
    const lock = await import('../core/root-width-lock');
    const release = await holdLock(lock);
    const pending = browser<ResponsiveSnapshotsResponse>('getResponsiveSnapshots', {
      viewports: [320],
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const late = document.createElement('h2');
    container.appendChild(late);
    getGlobalRegistry().registerElement('late', late, { type: 'generic' });
    release();
    const out = await pending;
    expect(out.snapshots[0].elements.map((e) => e.elementId)).toEqual(['save', 'late']);
  });

  it('a hidden tab awaits no animation frame, and says so', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const raf = vi.fn(() => 0);
    vi.stubGlobal('requestAnimationFrame', raf);
    const out = await browser<ResponsiveSnapshotsResponse>('getResponsiveSnapshots', {
      viewports: [320, 768],
    });
    expect(out.snapshots).toHaveLength(2);
    expect(out.framesSkipped).toBe(true);
    expect(raf).not.toHaveBeenCalled();
  });

  it('a visible tab reports framesSkipped: false', async () => {
    const out = await browser<ResponsiveSnapshotsResponse>('getResponsiveSnapshots', {
      viewports: [320],
    });
    expect(out.framesSkipped).toBe(false);
    expect(out.timedOut).toBe(false);
  });

  it('refuses re-entry instead of deadlocking', async () => {
    const lock = await import('../core/root-width-lock');
    await expect(
      lock.withRootWidthLock(() => lock.withRootWidthLock(() => 1))
    ).rejects.toMatchObject({ code: 'UB-ACTION-REJECTED' });
    // Released: the next holder runs.
    await expect(lock.withRootWidthLock(() => 2)).resolves.toBe(2);
  });

  it('the relay fits the capture deadline under its own command timeout', async () => {
    const seen: unknown[] = [];
    const relay = new CommandRelay({
      globalPrefix: `__uiBridgeTest_${Math.random().toString(36).slice(2, 10)}`,
      proactiveSnapshot: false,
    });
    const unsubscribe = relay.subscribeToCommands((command) => {
      seen.push(command.payload);
      relay.resolveCommand(command.commandId, { ok: true }, 'tab-a');
    }, 'tab-a');
    try {
      const handlers = createRelayHandlers(relay);
      await handlers.getResponsiveSnapshots({ viewports: [320] });
      await handlers.getResponsiveSnapshots({ viewports: [320], budgetMs: 60_000 });
      await handlers.setViewportConstraints({ width: 500, budgetMs: 100 });
    } finally {
      unsubscribe();
      relay.destroy();
    }
    const budget = relay.commandBudgetMs - 1_000;
    expect(seen.map((p) => (p as { budgetMs?: number }).budgetMs)).toEqual([budget, budget, 100]);
  });
});

describe('scrubStyleUrls', () => {
  it('scrubs url( in any case, and the quoted images of image-set', () => {
    expect(scrubStyleUrls('URL("https://cdn.test/a.png?t=1"), linear-gradient(red, blue)')).toBe(
      `url("${REDACTED_VALUE}"), linear-gradient(red, blue)`
    );
    expect(scrubStyleUrls('-webkit-image-set("https://cdn.test/a.png?t=1" 1x, \'b.png\' 2x)')).toBe(
      `-webkit-image-set("${REDACTED_VALUE}" 1x, "${REDACTED_VALUE}" 2x)`
    );
    expect(scrubStyleUrls('image-set(url(a.png) 1x)')).toBe(
      `image-set(url("${REDACTED_VALUE}") 1x)`
    );
    expect(scrubStyleUrls('linear-gradient(red, blue)')).toBe('linear-gradient(red, blue)');
  });
});
