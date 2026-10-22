/**
 * The canvas census (`UIBridgeRegistry.getCanvasCoverage`) and the in-page
 * `/control/visibility` handler that reports it.
 *
 * The occlusion sweep hit-tests registered elements only, so text painted
 * into a canvas no `paintsText` registration covers is never checked. The
 * census is what keeps the sweep from answering `clear` over such a canvas.
 * jsdom has no layout, so canvas boxes are stubbed per element.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UIBridgeRegistry } from '../registry';
import { createHandlers, type RegistryLike } from '../../server/handlers';
import { DefaultActionExecutor } from '../../control/action-executor';
import type { VisibilityReport } from '../../server/types';
import { ModalDetector } from '../../modal/modal-detector';

function boxed<T extends HTMLElement>(el: T, x: number, y: number, w: number, h: number): T {
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
  return el;
}

function canvasAt(
  parent: HTMLElement,
  x: number,
  y: number,
  w: number,
  h: number,
  cls?: string
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  if (cls) canvas.className = cls;
  parent.appendChild(canvas);
  return boxed(canvas, x, y, w, h);
}

function div(parent: HTMLElement = document.body): HTMLDivElement {
  const el = document.createElement('div');
  parent.appendChild(el);
  return boxed(el, 0, 0, 800, 600);
}

const realElementFromPoint = document.elementFromPoint;

beforeEach(() => {
  document.body.innerHTML = '';
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 720, configurable: true });
});

afterEach(() => {
  document.elementFromPoint = realElementFromPoint;
});

describe('getCanvasCoverage — the census', () => {
  it('zero canvases: measured, nothing to attribute', () => {
    const registry = new UIBridgeRegistry();
    registry.registerElement('a', div(), { type: 'generic' });
    expect(registry.getCanvasCoverage()).toEqual({
      state: 'measured',
      canvases: 0,
      attributed: 0,
      unattributed: [],
    });
  });

  it('a canvas inside a paintsText container is attributed', () => {
    const registry = new UIBridgeRegistry();
    const term = div();
    canvasAt(term, 0, 0, 800, 600, 'xterm-text-layer');
    canvasAt(term, 0, 0, 800, 600, 'xterm-link-layer');
    registry.registerElement('terminal-surface-a', term, { type: 'canvas', paintsText: true });

    expect(registry.getCanvasCoverage()).toEqual({
      state: 'measured',
      canvases: 2,
      attributed: 2,
      unattributed: [],
    });
  });

  it('a registered <canvas> attributes itself (implicitly paintsText)', () => {
    const registry = new UIBridgeRegistry();
    const chart = canvasAt(document.body, 10, 10, 300, 150);
    registry.registerElement('chart', chart, { type: 'canvas' });
    expect(registry.getCanvasCoverage()).toMatchObject({ canvases: 1, attributed: 1 });
  });

  it('an unregistered canvas is unattributed and named by its own DOM descriptor', () => {
    const registry = new UIBridgeRegistry();
    registry.registerElement('a', div(), { type: 'generic' });
    canvasAt(document.body, 20, 30, 300, 150, 'sparkline');

    expect(registry.getCanvasCoverage()).toEqual({
      state: 'measured',
      canvases: 1,
      attributed: 0,
      unattributed: [
        { descriptor: 'canvas.sparkline', rect: { x: 20, y: 30, width: 300, height: 150 } },
      ],
    });
  });

  it('a canvas whose first registered ancestor is NOT paintsText is unattributed', () => {
    const registry = new UIBridgeRegistry();
    const outer = div();
    const panel = div(outer);
    canvasAt(panel, 0, 0, 400, 300);
    // The paintsText registration is further up: the FIRST registered
    // ancestor decides, and that one judges hidesText from DOM text.
    registry.registerElement('outer', outer, { type: 'canvas', paintsText: true });
    registry.registerElement('panel', panel, { type: 'generic' });

    expect(registry.getCanvasCoverage()).toMatchObject({ canvases: 1, attributed: 0 });
  });

  it('attributes by registry membership, not by a stale data-ui-bridge-id', () => {
    const registry = new UIBridgeRegistry();
    const term = div();
    const wrapper = div(term);
    canvasAt(wrapper, 0, 0, 400, 300);
    registry.registerElement('terminal-surface-a', term, { type: 'canvas', paintsText: true });
    // An unregistered wrapper carrying a leftover stamp must not intercept.
    wrapper.setAttribute('data-ui-bridge-id', 'stale-wrapper');
    term.removeAttribute('data-ui-bridge-id');

    expect(registry.getCanvasCoverage()).toMatchObject({ canvases: 1, attributed: 1 });
  });

  it('many canvases with mixed attribution', () => {
    const registry = new UIBridgeRegistry();
    const term = div();
    canvasAt(term, 0, 0, 400, 300);
    canvasAt(term, 0, 0, 400, 300);
    registry.registerElement('term', term, { type: 'canvas', paintsText: true });
    canvasAt(document.body, 500, 0, 200, 100, 'a');
    canvasAt(document.body, 500, 200, 200, 100, 'b');

    const coverage = registry.getCanvasCoverage();
    expect(coverage).toMatchObject({ canvases: 4, attributed: 2 });
    expect(coverage?.unattributed.map((u) => u.descriptor)).toEqual(['canvas.a', 'canvas.b']);
  });

  it('skips canvases below 48x48, outside the viewport, hidden, or in a closed <details>', () => {
    const registry = new UIBridgeRegistry();
    registry.registerElement('a', div(), { type: 'generic' });
    canvasAt(document.body, 0, 0, 47, 300, 'thin');
    canvasAt(document.body, 2000, 0, 300, 300, 'offscreen-right');
    canvasAt(document.body, 0, -400, 300, 300, 'offscreen-above');
    canvasAt(document.body, 0, 0, 300, 300, 'none').style.display = 'none';
    canvasAt(document.body, 0, 0, 300, 300, 'invisible').style.visibility = 'hidden';
    canvasAt(document.body, 0, 0, 300, 300, 'transparent').style.opacity = '0';
    const details = document.createElement('details');
    details.appendChild(document.createElement('summary'));
    document.body.appendChild(details);
    canvasAt(details, 0, 0, 300, 300, 'collapsed');
    // One partly on screen still counts.
    canvasAt(document.body, 1200, 600, 300, 300, 'edge');

    const coverage = registry.getCanvasCoverage();
    expect(coverage?.unattributed.map((u) => u.descriptor)).toEqual(['canvas.edge']);
    expect(coverage?.canvases).toBe(1);
  });

  it('answers undefined when the census throws', () => {
    const registry = new UIBridgeRegistry();
    const original = document.getElementsByTagName;
    document.getElementsByTagName = (() => {
      throw new Error('boom');
    }) as typeof document.getElementsByTagName;
    try {
      expect(registry.getCanvasCoverage()).toBeUndefined();
    } finally {
      document.getElementsByTagName = original;
    }
  });
});

describe('the census rides every DOM-side snapshot', () => {
  it('createSnapshot carries canvasCoverage', () => {
    const registry = new UIBridgeRegistry();
    registry.registerElement('a', div(), { type: 'generic' });
    canvasAt(document.body, 0, 0, 300, 150, 'chart');
    expect(registry.createSnapshot().canvasCoverage).toMatchObject({
      state: 'measured',
      canvases: 1,
      attributed: 0,
    });
  });

  it('a census that threw is carried as accessor-threw, not dropped', () => {
    const registry = new UIBridgeRegistry();
    const original = document.getElementsByTagName;
    document.getElementsByTagName = (() => {
      throw new Error('boom');
    }) as typeof document.getElementsByTagName;
    try {
      expect(registry.createSnapshot().canvasCoverage).toEqual({
        state: 'unavailable',
        reason: 'accessor-threw',
      });
    } finally {
      document.getElementsByTagName = original;
    }
  });
});

describe('in-page /control/visibility reports the census', () => {
  async function visibility(
    registry: RegistryLike,
    params?: { includeExpected?: boolean }
  ): Promise<VisibilityReport> {
    const handlers = createHandlers(
      registry,
      new DefaultActionExecutor(new UIBridgeRegistry()) as never,
      { idleDetection: false }
    );
    const res = await handlers.visibility!(params);
    expect(res.success).toBe(true);
    return res.data as VisibilityReport;
  }

  it('an unregistered canvas on a page with registered elements reads unknown_canvas', async () => {
    const registry = new UIBridgeRegistry();
    registry.registerElement('a', div(), { type: 'generic' });
    canvasAt(document.body, 0, 0, 300, 150, 'chart');

    const report = await visibility(registry as unknown as RegistryLike);
    expect(report.verdict).toBe('unknown_canvas');
    expect(report.canvasCoverage).toMatchObject({ state: 'measured', attributed: 0 });
  });

  it('the same canvas inside a paintsText registration reads clear', async () => {
    const registry = new UIBridgeRegistry();
    const term = div();
    canvasAt(term, 0, 0, 300, 150);
    registry.registerElement('term', term, { type: 'canvas', paintsText: true });

    expect((await visibility(registry as unknown as RegistryLike)).verdict).toBe('clear');
  });

  it('maps state.paintsText into the report: an occluded surface hides painted text', async () => {
    const registry = new UIBridgeRegistry();
    const term = div();
    canvasAt(term, 0, 0, 800, 600);
    registry.registerElement('terminal-surface-a', term, { type: 'canvas', paintsText: true });
    const card = document.createElement('div');
    card.id = 'card';
    document.body.appendChild(card);
    // The card owns the whole surface at every probe.
    document.elementFromPoint = (() => card) as typeof document.elementFromPoint;

    const report = await visibility(registry as unknown as RegistryLike);
    expect(report.verdict).toBe('occlusions_found');
    expect(report.occlusions[0]).toMatchObject({
      element: 'terminal-surface-a',
      occludedBy: 'div#card',
      hidesText: true,
      textSource: 'painted',
    });
  });

  it('a directly registered modal whose registry id differs from its DOM id is an expected overlay', async () => {
    const registry = new UIBridgeRegistry();
    registry.setEnrichers({ modalDetector: new ModalDetector() });
    const label = div();
    label.textContent = 'Zone 8';
    registry.registerElement('zone-label', label, { type: 'generic' });
    const dialog = document.createElement('div');
    dialog.id = 'confirm-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    document.body.appendChild(dialog);
    // Registered directly, under an id that is neither its DOM id nor a testid.
    registry.registerElement('confirm', dialog, { type: 'generic' });
    document.elementFromPoint = (() => dialog) as typeof document.elementFromPoint;

    const report = await visibility(registry as unknown as RegistryLike);
    expect(registry.getModalContext()?.modals[0]).toMatchObject({
      id: 'confirm-dialog',
      bridgeId: 'confirm',
    });
    expect(report.expectedOverlaysFiltered).toBe(1);
    expect(report.occlusions.map((o) => o.element)).not.toContain('zone-label');
  });

  it('a heading inside a registered dialog is the dialog: still an expected overlay', async () => {
    const registry = new UIBridgeRegistry();
    registry.setEnrichers({ modalDetector: new ModalDetector() });
    const label = div();
    label.textContent = 'Zone 8';
    registry.registerElement('zone-label', label, { type: 'generic' });
    const dialog = document.createElement('div');
    dialog.id = 'confirm-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    const title = document.createElement('h2');
    title.id = 'dialog-title';
    title.textContent = 'Discard changes?';
    dialog.appendChild(title);
    document.body.appendChild(dialog);
    registry.registerElement('confirm', dialog, { type: 'generic' });
    // The point lands on the dialog's own (id-bearing) heading.
    document.elementFromPoint = (() => title) as typeof document.elementFromPoint;

    const report = await visibility(registry as unknown as RegistryLike);
    expect(report.expectedOverlaysFiltered).toBe(1);
    expect(report.occlusions.map((o) => o.element)).not.toContain('zone-label');
  });

  // Review H1: every registration door stamps its node, so a REGISTERED child
  // of a dialog carries its own stamp. Naming the hit by the closest stamp
  // would report the child's id, which is neither the modal's DOM id nor its
  // bridgeId, and the expected-overlay filter would miss the open dialog.
  it('a REGISTERED heading inside a registered dialog is still the dialog: an expected overlay', async () => {
    const registry = new UIBridgeRegistry();
    registry.setEnrichers({ modalDetector: new ModalDetector() });
    const label = div();
    label.textContent = 'Zone 8';
    registry.registerElement('zone-label', label, { type: 'generic' });
    const dialog = document.createElement('div');
    dialog.id = 'confirm-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    const title = document.createElement('h2');
    title.textContent = 'Discard changes?';
    dialog.appendChild(title);
    document.body.appendChild(dialog);
    registry.registerElement('confirm', dialog, { type: 'generic' });
    // Content discovery's door: it stamps the heading with its own id.
    registry.registerContentElement('heading-2-discard', title, {
      contentType: 'heading',
      contentMetadata: {} as never,
      label: 'Discard changes?',
    });
    expect(title.getAttribute('data-ui-bridge-id')).toBe('heading-2-discard');
    document.elementFromPoint = (() => title) as typeof document.elementFromPoint;

    const report = await visibility(registry as unknown as RegistryLike);
    expect(report.expectedOverlaysFiltered).toBe(1);
    expect(report.occlusions.map((o) => o.element)).not.toContain('zone-label');

    // includeExpected shows WHO: the dialog, by its bridge id.
    const all = await visibility(registry as unknown as RegistryLike, { includeExpected: true });
    expect(all.occlusions.find((o) => o.element === 'zone-label')?.occludedBy).toBe('confirm');
  });

  /** A `<dialog open>` whose `:modal` reads `modal` (jsdom has no showModal). */
  function openDialog(id: string, modal: boolean): HTMLDialogElement {
    const dialog = document.createElement('dialog');
    dialog.id = id;
    dialog.setAttribute('open', '');
    const realMatches = dialog.matches.bind(dialog);
    dialog.matches = (selector: string) => (selector === ':modal' ? modal : realMatches(selector));
    document.body.appendChild(dialog);
    return dialog;
  }

  it("a registered child of an UNREGISTERED modal <dialog> is named by the dialog's DOM id", async () => {
    const registry = new UIBridgeRegistry();
    registry.setEnrichers({ modalDetector: new ModalDetector() });
    const label = div();
    label.textContent = 'Zone 8';
    registry.registerElement('zone-label', label, { type: 'generic' });
    const dialog = openDialog('settings', true);
    const save = document.createElement('button');
    save.textContent = 'Save';
    dialog.appendChild(save);
    registry.registerElement('settings-save', save, { type: 'button' });
    document.elementFromPoint = (() => save) as typeof document.elementFromPoint;

    const all = await visibility(registry as unknown as RegistryLike, { includeExpected: true });
    expect(all.occlusions.find((o) => o.element === 'zone-label')?.occludedBy).toBe(
      'dialog#settings'
    );
    const report = await visibility(registry as unknown as RegistryLike);
    expect(report.expectedOverlaysFiltered).toBe(1);
  });

  // Review round 3, item 2: `dialog[open]` also matches a dialog opened with
  // show(), which blocks nothing. It is neither a dialog that names the hit
  // nor a modal the filter admits.
  it('a NON-modal <dialog open> (show()) is a real occlusion, named by its registered child', async () => {
    const registry = new UIBridgeRegistry();
    registry.setEnrichers({ modalDetector: new ModalDetector() });
    const label = div();
    label.textContent = 'Zone 8';
    registry.registerElement('zone-label', label, { type: 'generic' });
    const dialog = openDialog('find-bar', false);
    const input = document.createElement('input');
    dialog.appendChild(input);
    registry.registerElement('find-query', input, { type: 'input' });
    document.elementFromPoint = (() => input) as typeof document.elementFromPoint;

    expect(registry.getModalContext()?.modals[0]).toMatchObject({
      id: 'find-bar',
      blocking: false,
    });
    const report = await visibility(registry as unknown as RegistryLike);
    expect(report.verdict).toBe('occlusions_found');
    expect(report.expectedOverlaysFiltered).toBe(0);
    expect(report.occlusions.find((o) => o.element === 'zone-label')?.occludedBy).toBe(
      'find-query'
    );
  });

  it('a NON-modal <dialog open> named by its own DOM id is not expected either', async () => {
    const registry = new UIBridgeRegistry();
    registry.setEnrichers({ modalDetector: new ModalDetector() });
    const label = div();
    label.textContent = 'Zone 8';
    registry.registerElement('zone-label', label, { type: 'generic' });
    const dialog = openDialog('find-bar', false);
    document.elementFromPoint = (() => dialog) as typeof document.elementFromPoint;

    const report = await visibility(registry as unknown as RegistryLike);
    expect(report.occlusions.find((o) => o.element === 'zone-label')).toMatchObject({
      occludedBy: 'dialog#find-bar',
      isExpectedOverlay: false,
    });
  });

  it('a docked drawer is not a dialog: its registered child is named and the occlusion is reported', async () => {
    const registry = new UIBridgeRegistry();
    registry.setEnrichers({ modalDetector: new ModalDetector() });
    const label = div();
    label.textContent = 'Main title';
    registry.registerElement('main-title', label, { type: 'generic' });
    const drawer = document.createElement('div');
    drawer.className = 'MuiDrawer-root MuiDrawer-docked';
    document.body.appendChild(drawer);
    registry.registerElement('sidebar', drawer, { type: 'generic' });
    const nav = div(drawer);
    registry.registerElement('sidebar-nav', nav, { type: 'generic' });
    document.elementFromPoint = (() => nav) as typeof document.elementFromPoint;

    const report = await visibility(registry as unknown as RegistryLike);
    expect(report.verdict).toBe('occlusions_found');
    expect(report.expectedOverlaysFiltered).toBe(0);
    expect(report.occlusions.find((o) => o.element === 'main-title')).toMatchObject({
      occludedBy: 'sidebar-nav',
      isExpectedOverlay: false,
    });
  });

  it('an open Headless UI menu is not a dialog either', async () => {
    const registry = new UIBridgeRegistry();
    registry.setEnrichers({ modalDetector: new ModalDetector() });
    const label = div();
    label.textContent = 'Main title';
    registry.registerElement('main-title', label, { type: 'generic' });
    const menu = document.createElement('div');
    menu.setAttribute('data-headlessui-state', 'open');
    document.body.appendChild(menu);
    registry.registerElement('user-menu', menu, { type: 'generic' });
    const item = div(menu);
    registry.registerElement('user-menu-item', item, { type: 'generic' });
    document.elementFromPoint = (() => item) as typeof document.elementFromPoint;

    const report = await visibility(registry as unknown as RegistryLike);
    expect(report.expectedOverlaysFiltered).toBe(0);
    expect(report.occlusions.find((o) => o.element === 'main-title')?.occludedBy).toBe(
      'user-menu-item'
    );
  });

  // Review round 3: the expected-overlay FILTER admits only blocking modals.
  // A detected but non-blocking "modal" (docked drawer, open menu, Radix
  // popover) that is itself registered must not make its own occlusions
  // expected when the hit is an unregistered child named by its stamp.
  it('a registered docked drawer hit through an unregistered child is a real occlusion', async () => {
    const registry = new UIBridgeRegistry();
    registry.setEnrichers({ modalDetector: new ModalDetector() });
    const label = div();
    label.textContent = 'Main title';
    registry.registerElement('main-title', label, { type: 'generic' });
    const drawer = document.createElement('div');
    drawer.className = 'MuiDrawer-root MuiDrawer-docked';
    document.body.appendChild(drawer);
    registry.registerElement('sidebar', drawer, { type: 'generic' });
    const link = div(drawer);
    document.elementFromPoint = (() => link) as typeof document.elementFromPoint;

    const report = await visibility(registry as unknown as RegistryLike);
    expect(report.verdict).toBe('occlusions_found');
    expect(report.expectedOverlaysFiltered).toBe(0);
    expect(report.occlusions.find((o) => o.element === 'main-title')).toMatchObject({
      occludedBy: 'sidebar',
      isExpectedOverlay: false,
    });
  });

  it('a registered open Headless UI menu hit through an unregistered item is a real occlusion', async () => {
    const registry = new UIBridgeRegistry();
    registry.setEnrichers({ modalDetector: new ModalDetector() });
    const label = div();
    label.textContent = 'Main title';
    registry.registerElement('main-title', label, { type: 'generic' });
    const menu = document.createElement('div');
    menu.setAttribute('data-headlessui-state', 'open');
    document.body.appendChild(menu);
    registry.registerElement('user-menu', menu, { type: 'generic' });
    const item = div(menu);
    document.elementFromPoint = (() => item) as typeof document.elementFromPoint;

    const report = await visibility(registry as unknown as RegistryLike);
    expect(report.verdict).toBe('occlusions_found');
    expect(report.expectedOverlaysFiltered).toBe(0);
  });

  it('a registered non-modal Radix popover (role=dialog, no aria-modal) is a real occlusion', async () => {
    const registry = new UIBridgeRegistry();
    registry.setEnrichers({ modalDetector: new ModalDetector() });
    const label = div();
    label.textContent = 'Main title';
    registry.registerElement('main-title', label, { type: 'generic' });
    const popover = document.createElement('div');
    popover.id = 'radix-popover-1';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('data-state', 'open');
    document.body.appendChild(popover);
    registry.registerElement('filters-popover', popover, { type: 'generic' });
    const body = div(popover);
    document.elementFromPoint = (() => body) as typeof document.elementFromPoint;

    const report = await visibility(registry as unknown as RegistryLike);
    expect(report.verdict).toBe('occlusions_found');
    expect(report.expectedOverlaysFiltered).toBe(0);
  });

  it('a genuine aria-modal dialog hit through an unregistered child is still expected', async () => {
    const registry = new UIBridgeRegistry();
    registry.setEnrichers({ modalDetector: new ModalDetector() });
    const label = div();
    label.textContent = 'Main title';
    registry.registerElement('main-title', label, { type: 'generic' });
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    document.body.appendChild(dialog);
    registry.registerElement('confirm', dialog, { type: 'generic' });
    const text = div(dialog);
    document.elementFromPoint = (() => text) as typeof document.elementFromPoint;

    const report = await visibility(registry as unknown as RegistryLike);
    expect(report.expectedOverlaysFiltered).toBe(1);
    expect(report.occlusions.map((o) => o.element)).not.toContain('main-title');
  });

  it('a dialog with both a DOM id and a data-testid is named by the DOM id', async () => {
    const registry = new UIBridgeRegistry();
    registry.setEnrichers({ modalDetector: new ModalDetector() });
    const label = div();
    label.textContent = 'Zone 8';
    registry.registerElement('zone-label', label, { type: 'generic' });
    const dialog = document.createElement('div');
    dialog.id = 'delete-dialog';
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('data-testid', 'delete-confirm');
    const title = document.createElement('h2');
    dialog.appendChild(title);
    document.body.appendChild(dialog);
    registry.registerElement('delete-title', title, { type: 'generic' });
    document.elementFromPoint = (() => title) as typeof document.elementFromPoint;

    const all = await visibility(registry as unknown as RegistryLike, { includeExpected: true });
    expect(all.occlusions.find((o) => o.element === 'zone-label')).toMatchObject({
      occludedBy: 'div#delete-dialog',
      isExpectedOverlay: true,
    });
  });

  it('a custom-selector modal does not override a registered child (pinned under-claim)', async () => {
    const registry = new UIBridgeRegistry();
    registry.setEnrichers({ modalDetector: new ModalDetector({ customSelectors: ['.sheet'] }) });
    const label = div();
    label.textContent = 'Zone 8';
    registry.registerElement('zone-label', label, { type: 'generic' });
    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.id = 'filters-sheet';
    const field = document.createElement('input');
    sheet.appendChild(field);
    document.body.appendChild(sheet);
    registry.registerElement('filters-query', field, { type: 'input' });
    document.elementFromPoint = (() => field) as typeof document.elementFromPoint;

    const report = await visibility(registry as unknown as RegistryLike);
    expect(report.expectedOverlaysFiltered).toBe(0);
    expect(report.occlusions.find((o) => o.element === 'zone-label')?.occludedBy).toBe(
      'filters-query'
    );
  });

  it('a developer/hook stamp inside a dialog keeps naming its node', async () => {
    const registry = new UIBridgeRegistry();
    registry.setEnrichers({ modalDetector: new ModalDetector() });
    const label = div();
    label.textContent = 'Zone 8';
    registry.registerElement('zone-label', label, { type: 'generic' });
    const dialog = document.createElement('div');
    dialog.id = 'confirm-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    const ok = document.createElement('button');
    ok.setAttribute('data-ui-bridge-id', 'confirm-ok');
    dialog.appendChild(ok);
    document.body.appendChild(dialog);
    registry.registerElement('confirm-ok', ok, { type: 'button' });
    document.elementFromPoint = (() => ok) as typeof document.elementFromPoint;

    const all = await visibility(registry as unknown as RegistryLike, { includeExpected: true });
    expect(all.occlusions.find((o) => o.element === 'zone-label')?.occludedBy).toBe('confirm-ok');
  });

  it('a covered element INSIDE the dialog is covered by the popover, not by the dialog', async () => {
    const registry = new UIBridgeRegistry();
    registry.setEnrichers({ modalDetector: new ModalDetector() });
    const dialog = document.createElement('div');
    dialog.id = 'dlg';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    document.body.appendChild(dialog);
    registry.registerElement('dlg', dialog, { type: 'generic' });
    const field = div(dialog);
    field.textContent = 'Name';
    registry.registerElement('dlg-name', field, { type: 'generic' });
    const popover = div(dialog);
    registry.registerElement('dlg-popover', popover, { type: 'generic' });
    document.elementFromPoint = (() => popover) as typeof document.elementFromPoint;

    const all = await visibility(registry as unknown as RegistryLike, { includeExpected: true });
    expect(all.occlusions.find((o) => o.element === 'dlg-name')).toMatchObject({
      occludedBy: 'dlg-popover',
      isExpectedOverlay: false,
    });
  });

  it('nested dialogs: the outermost dialog that does not hold the covered element names the hit', async () => {
    const registry = new UIBridgeRegistry();
    registry.setEnrichers({ modalDetector: new ModalDetector() });
    const label = div();
    label.textContent = 'Zone 8';
    registry.registerElement('zone-label', label, { type: 'generic' });
    const outer = document.createElement('div');
    outer.setAttribute('role', 'dialog');
    outer.setAttribute('aria-modal', 'true');
    document.body.appendChild(outer);
    registry.registerElement('settings', outer, { type: 'generic' });
    const inner = document.createElement('div');
    inner.setAttribute('role', 'alertdialog');
    outer.appendChild(inner);
    registry.registerElement('settings-confirm', inner, { type: 'generic' });
    const button = document.createElement('button');
    inner.appendChild(button);
    registry.registerElement('settings-confirm-ok', button, { type: 'button' });
    document.elementFromPoint = (() => button) as typeof document.elementFromPoint;

    const all = await visibility(registry as unknown as RegistryLike, { includeExpected: true });
    expect(all.occlusions.find((o) => o.element === 'zone-label')).toMatchObject({
      occludedBy: 'settings',
      isExpectedOverlay: true,
    });
  });

  it('an unregistered dialog with only a data-testid is named by it, as the detector names it', async () => {
    const registry = new UIBridgeRegistry();
    registry.setEnrichers({ modalDetector: new ModalDetector() });
    const label = div();
    label.textContent = 'Zone 8';
    registry.registerElement('zone-label', label, { type: 'generic' });
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('data-testid', 'delete-confirm');
    const title = document.createElement('h2');
    dialog.appendChild(title);
    document.body.appendChild(dialog);
    registry.registerElement('delete-title', title, { type: 'generic' });
    document.elementFromPoint = (() => title) as typeof document.elementFromPoint;

    const report = await visibility(registry as unknown as RegistryLike);
    expect(report.expectedOverlaysFiltered).toBe(1);
  });

  it('outside any modal the closest registered widget is named, not the panel holding it', async () => {
    const registry = new UIBridgeRegistry();
    registry.setEnrichers({ modalDetector: new ModalDetector() });
    const label = div();
    label.textContent = 'Zone 1';
    registry.registerElement('zone-1-label', label, { type: 'generic' });
    const panel = div();
    registry.registerElement('zone-2-panel', panel, { type: 'generic' });
    const minimap = div(panel);
    registry.registerElement('zone-2-minimap', minimap, { type: 'generic' });
    document.elementFromPoint = (() => minimap) as typeof document.elementFromPoint;

    const report = await visibility(registry as unknown as RegistryLike);
    expect(report.expectedOverlaysFiltered).toBe(0);
    expect(report.occlusions.find((o) => o.element === 'zone-1-label')?.occludedBy).toBe(
      'zone-2-minimap'
    );
  });

  it('a registry without the accessor is page-sdk-lacks-coverage; one that answers undefined threw', async () => {
    const live = new UIBridgeRegistry();
    live.registerElement('a', div(), { type: 'generic' });
    const base = {
      getAllElements: () => live.getAllElements(),
      getElement: (id: string) => live.getElement(id),
      getAllComponents: () => [],
      getComponent: () => undefined,
      createSnapshot: () => live.createSnapshot() as never,
    };

    const lacking = await visibility(base as RegistryLike);
    expect(lacking.canvasCoverage).toEqual({
      state: 'unavailable',
      reason: 'page-sdk-lacks-coverage',
    });
    expect(lacking.verdict).toBe('unknown_canvas');

    const threw = await visibility({ ...base, getCanvasCoverage: () => undefined } as RegistryLike);
    expect(threw.canvasCoverage).toEqual({ state: 'unavailable', reason: 'accessor-threw' });
    expect(threw.verdict).toBe('unknown_canvas');
  });

  // Review L2: a registry with no DOM did not throw; say so, and still
  // withhold clear.
  it('with no document the census is unavailable as no-document, never accessor-threw', async () => {
    const live = new UIBridgeRegistry();
    const el = div();
    el.textContent = 'x';
    live.registerElement('a', el, { type: 'generic' });
    // States read while the DOM exists: only the census runs DOM-less.
    const states = live.getAllElements().map((e) => {
      const state = e.getState();
      return { ...e, getState: () => state };
    });
    const handlers = createHandlers(
      {
        getAllElements: () => states,
        getElement: (id: string) => live.getElement(id),
        getAllComponents: () => [],
        getComponent: () => undefined,
        createSnapshot: () => live.createSnapshot() as never,
        getCanvasCoverage: () => live.getCanvasCoverage(),
      } as RegistryLike,
      new DefaultActionExecutor(new UIBridgeRegistry()) as never,
      { idleDetection: false }
    );
    const realDocument = globalThis.document;
    let report: VisibilityReport;
    try {
      // @ts-expect-error -- simulate a server-side registry with no DOM
      delete globalThis.document;
      expect(typeof document).toBe('undefined');
      const res = await handlers.visibility!();
      if (!res.success) throw new Error(JSON.stringify(res));
      report = res.data as VisibilityReport;
    } finally {
      globalThis.document = realDocument;
    }
    expect(report.canvasCoverage).toEqual({ state: 'unavailable', reason: 'no-document' });
    expect(report.verdict).not.toBe('clear');
  });
});
