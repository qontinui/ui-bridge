/**
 * The element-kind ORACLE: an element's advertised `actions` are exactly the
 * verbs both web dispatchers perform on it (plan
 * `2026-11-09-an-elements-advertised-verbs-depend-on-which-path-found-it`,
 * Phase 1 / D3).
 *
 * The advertised list is ENFORCED, not descriptive: the runner's element-action
 * door refuses any verb an element does not advertise before the SDK is reached
 * (`is_action_advertised`, `qontinui-runner/src-tauri/src/mcp/ui_bridge/elements.rs`).
 * So it fails two ways, and this file pins both:
 *
 * - UNDER-advertising makes a verb the dispatchers run unreachable through the
 *   runner. Every advertised verb must therefore SUCCEED on both dispatchers
 *   with minimal valid params — not merely avoid a refusal, because an
 *   advertised verb that crashes (a value written to a file `<input>`) is the
 *   over-advertising defect wearing a different error.
 * - OVER-advertising names a verb the dispatchers refuse or silently ignore
 *   (the ui-bridge#331 class). Every `StandardAction` the element does NOT
 *   advertise must be refused, on both dispatchers, with the typed marker
 *   `failureDetails.context.refusal === 'element-kind'` — a refusal a caller
 *   can key on, never a success that did nothing.
 *
 * And the list must not depend on which path found the element: a
 * `registerElement` call with no options, an auto-registered node
 * (`useAutoRegister`, the path the runner mounts), the executor's `find()` row
 * for a DOM-scanned node and the server's DOM-fallback row must report the same
 * `type` and the same `actions`.
 *
 * The fixtures are enumerated per DOM SPELLING the scanners select, not one per
 * `ElementType` [policy: testing/coverage-is-enumerated-not-salient]: every
 * tag, every role, every `<input>` subtype, contenteditable, a form-owned and an
 * unowned control, `<details>`/`<summary>`, the attributes the dispatchers
 * branch on (`aria-expanded`), the role-on-a-native-tag spellings component
 * libraries render, and media registered through the media scanner. Hidden
 * inputs are not enumerated: they have no rendering, so every click-like verb
 * refuses them for visibility, which is state, not kind.
 *
 * It replaces `registry.action-advertisement.test.ts`, which pinned the
 * registry's table alone.
 *
 * It imports only modules that predate the convergence, so against the
 * pre-convergence tree it fails on its assertions, never on an import.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { UIBridgeRegistry, getGlobalRegistry } from './registry';
import type { RegisteredElement, StandardAction } from './types';
import { DefaultActionExecutor } from '../control/action-executor';
import { releaseForcedPseudoState } from '../control/forced-hover';
import { executeCommand, type BridgeAccess } from '../react/commandHandlers';
import { useAutoRegister } from '../react/useAutoRegister';
import type { UIBridgeContextValue } from '../react/UIBridgeProvider';
import { scanDOMForInteractiveElementsWithRefs } from '../server/dom-fallback';

let bridge: UIBridgeContextValue | null = null;
vi.mock('../react/UIBridgeProvider', () => ({ useUIBridgeOptional: () => bridge }));

/**
 * Every `StandardAction`, each with the minimal params that make it valid.
 * A `Record` over the union, so a verb added to `StandardAction` is a compile
 * error here until it is driven too.
 */
const VERB_PARAMS: Record<StandardAction, Record<string, unknown>> = {
  click: {},
  hoverClick: { settleTimeoutMs: 0 },
  doubleClick: {},
  rightClick: {},
  middleClick: {},
  type: { text: 'a' },
  sendKeys: { keys: ['a'] },
  clear: {},
  // `a` is an option of every select fixture and of the suggestion listbox.
  select: { value: 'a' },
  focus: {},
  blur: {},
  hover: { settleTimeoutMs: 0 },
  unhover: {},
  scroll: { direction: 'down', amount: 10 },
  scrollIntoView: { smooth: false },
  check: {},
  uncheck: {},
  toggle: {},
  setValue: { value: 'a' },
  drag: { targetPosition: { x: 1, y: 1 }, steps: 1, holdDelay: 0, releaseDelay: 0 },
  submit: {},
  reset: {},
  autocomplete: { searchText: 'a', suggestionTimeout: 150 },
};
const VERBS = Object.keys(VERB_PARAMS) as StandardAction[];

/** The node a fixture's verbs are driven on carries this attribute. */
const TARGET = 'data-oracle-target';

interface Fixture {
  /** The DOM spelling, as a reader would name it. */
  name: string;
  /** The fixture's markup. Exactly one node carries {@link TARGET}. */
  html: string;
  /**
   * Registered through the MEDIA scanner (`<img>`, `<canvas>`, …) rather than
   * the interactive one. Such a node carries no `data-testid`, so only the
   * media scanner selects it — which is the path a real page takes.
   */
  media?: true;
}

const T = TARGET;
const FIXTURES: Fixture[] = [
  // Tags.
  { name: '<a href>', html: `<a href="#oracle" ${T}>link</a>` },
  { name: '<button> outside a form', html: `<button type="button" ${T}>b</button>` },
  { name: '<button> inside a form', html: `<form><button type="submit" ${T}>b</button></form>` },
  {
    name: '<button form="…"> owned by a form elsewhere',
    html: `<form id="oracle-owner"></form><button type="submit" form="oracle-owner" ${T}>b</button>`,
  },
  { name: '<textarea>', html: `<textarea ${T}></textarea>` },
  {
    name: '<select>',
    html: `<select ${T}><option value="a">a</option><option value="b">b</option></select>`,
  },
  {
    name: '<select multiple>',
    html: `<select multiple ${T}><option value="a">a</option></select>`,
  },
  { name: '<option>', html: `<select><option value="a" ${T}>a</option></select>` },
  { name: '<form>', html: `<form ${T}><input type="text" name="q"></form>` },
  { name: '<details>', html: `<details ${T}><summary>s</summary>body</details>` },
  { name: '<summary>', html: `<details><summary ${T}>s</summary>body</details>` },
  { name: '<dialog open>', html: `<dialog open ${T}>d</dialog>` },
  { name: '[contenteditable]', html: `<div contenteditable="true" ${T}>e</div>` },
  { name: '<div tabindex>', html: `<div tabindex="0" ${T}>g</div>` },
  { name: '<span>', html: `<span ${T}>s</span>` },

  // Every <input> subtype.
  ...[
    'text',
    'search',
    'email',
    'url',
    'tel',
    'password',
    'number',
    'date',
    'datetime-local',
    'month',
    'week',
    'time',
    'color',
    'range',
    'checkbox',
    'radio',
    'file',
    'submit',
    'reset',
    'button',
    'image',
  ].map((type) => ({ name: `<input type="${type}">`, html: `<input type="${type}" ${T}>` })),
  { name: '<input type="text"> inside a form', html: `<form><input type="text" ${T}></form>` },

  // Every role, on a neutral element.
  ...[
    'button',
    'link',
    'checkbox',
    'radio',
    'switch',
    'slider',
    'spinbutton',
    'combobox',
    'listbox',
    'option',
    'textbox',
    'menu',
    'menuitem',
    'tab',
    'tablist',
    'dialog',
    'alertdialog',
    'status',
  ].map((role) => ({
    name: `<div role="${role}">`,
    html: `<div role="${role}"${
      ['checkbox', 'radio', 'switch'].includes(role) ? ' aria-checked="false"' : ''
    } ${T}>r</div>`,
  })),

  // The attribute the toggle and select arms branch on.
  {
    name: '<button aria-expanded> (disclosure button)',
    html: `<button aria-expanded="false" ${T}>more</button>`,
  },

  // Roles on native tags: the spellings component libraries render.
  {
    name: '<button role="switch">',
    html: `<button role="switch" aria-checked="false" ${T}>s</button>`,
  },
  {
    name: '<button role="checkbox">',
    html: `<button role="checkbox" aria-checked="false" ${T}>c</button>`,
  },
  { name: '<button role="combobox">', html: `<button role="combobox" ${T}>pick</button>` },
  {
    name: '<button role="combobox" aria-expanded> (select-only combobox trigger)',
    html: `<button role="combobox" aria-expanded="false" ${T}>pick</button>`,
  },
  {
    name: '<input role="combobox"> (editable combobox)',
    html: `<input type="text" role="combobox" ${T}>`,
  },
  {
    name: '<input type="checkbox" role="switch">',
    html: `<input type="checkbox" role="switch" ${T}>`,
  },
  { name: '<button role="tab">', html: `<button role="tab" ${T}>t</button>` },
  {
    name: '<input type="number" role="spinbutton">',
    html: `<input type="number" role="spinbutton" ${T}>`,
  },

  // Media, registered through the media scanner.
  { name: '<canvas>', html: `<canvas ${T}></canvas>`, media: true },
  { name: '<video>', html: `<video ${T}></video>`, media: true },
  { name: '<svg>', html: `<svg ${T}></svg>`, media: true },
  { name: '<div role="img">', html: `<div role="img" aria-label="chart" ${T}></div>`, media: true },
];

/** jsdom does no layout: give `el` a box inside the viewport and an offsetParent. */
function layOut(el: Element): void {
  const rect = { x: 0, y: 0, width: 10, height: 10, top: 0, left: 0, right: 10, bottom: 10 };
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ ...rect, toJSON: () => rect }),
  });
  Object.defineProperty(el, 'offsetParent', { configurable: true, get: () => document.body });
}

let host: HTMLDivElement;

/** Mount `fixture` fresh into the host and return its laid-out target. */
function mount(fixture: Fixture): HTMLElement {
  host.innerHTML = fixture.html;
  const target = host.querySelector<HTMLElement>(`[${TARGET}]`);
  if (!target) throw new Error(`fixture "${fixture.name}" has no [${TARGET}] node`);
  // The interactive scanners all select `[data-testid]`, so every non-media
  // spelling is found by each of them whatever its tag or role.
  if (!fixture.media) target.setAttribute('data-testid', 'oracle-target');
  layOut(target);
  return target;
}

/**
 * A listbox offering the option `a`, outside every fixture. A combobox's
 * `select` and an input's `autocomplete` drive a popup; this is the popup they
 * find, so both can SUCCEED rather than time out looking for one.
 */
let suggestions: HTMLDivElement;

/** Submitting in jsdom would navigate; every submit the oracle causes is cancelled. */
const cancelSubmit = (e: Event): void => e.preventDefault();

beforeAll(() => {
  // jsdom gaps, not kind facts: scrolling APIs it does not implement, and the
  // <dialog> methods (jsdom 23 reflects `open` but has no show/close).
  const proto = Element.prototype as unknown as Record<string, unknown>;
  for (const api of ['scrollBy', 'scrollTo', 'scrollIntoView']) {
    if (typeof proto[api] !== 'function') proto[api] = function noop(): void {};
  }
  const dialog = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  for (const api of ['show', 'showModal']) {
    if (typeof dialog[api] !== 'function') {
      dialog[api] = function open(this: HTMLElement): void {
        this.setAttribute('open', '');
      };
    }
  }
  if (typeof dialog.close !== 'function') {
    dialog.close = function close(this: HTMLElement): void {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    };
  }
  suggestions = document.createElement('div');
  suggestions.setAttribute('role', 'listbox');
  suggestions.innerHTML = '<div role="option" data-value="a">a</div>';
  document.body.appendChild(suggestions);
  host = document.createElement('div');
  document.body.appendChild(host);
  document.addEventListener('submit', cancelSubmit, true);
});

afterAll(() => {
  document.removeEventListener('submit', cancelSubmit, true);
  suggestions.remove();
  host.remove();
});

afterEach(async () => {
  cleanup();
  bridge = null;
  host.innerHTML = '';
  getGlobalRegistry().clear();
  await releaseForcedPseudoState('explicit');
});

interface Advertisement {
  type: string;
  actions: string[];
}

function advertisement(row: { type: string; actions: readonly string[] }): Advertisement {
  return { type: row.type, actions: [...row.actions] };
}

/** `registerElement` with no options: the registry infers both fields. */
function viaRegisterElement(target: HTMLElement): Advertisement {
  return advertisement(new UIBridgeRegistry().registerElement('oracle', target));
}

/** The auto-register hook — what `AutoRegisterProvider` (and so the runner) runs. */
async function viaAutoRegister(fixture: Fixture, target: HTMLElement): Promise<Advertisement> {
  const registry = new UIBridgeRegistry();
  bridge = { registry } as unknown as UIBridgeContextValue;
  function Harness(): null {
    useAutoRegister({
      enabled: true,
      debounceMs: 0,
      includeHidden: true,
      contentDiscovery: { enabled: false },
      mediaDiscovery: fixture.media ? { mediaDebounceMs: 0 } : { enabled: false },
    });
    return null;
  }
  render(createElement(Harness));
  let found: RegisteredElement | undefined;
  await waitFor(
    () => {
      found = registry.findByDOMElement(target);
      expect(found, `the auto-register scan never registered ${fixture.name}`).toBeDefined();
    },
    { timeout: 2000 }
  );
  return advertisement(found as RegisteredElement);
}

/** The executor's `find()` row for a node no registry holds. */
async function viaScannedRow(fixture: Fixture): Promise<Advertisement> {
  const found = await new DefaultActionExecutor(new UIBridgeRegistry()).find({
    selector: `[${TARGET}]`,
  });
  const row = found.elements[0];
  if (!row) throw new Error(`find() returned no row for ${fixture.name}`);
  return advertisement(row);
}

/** The server's DOM-fallback discovery row. */
function viaDomFallback(fixture: Fixture, target: HTMLElement): Advertisement {
  const row = scanDOMForInteractiveElementsWithRefs().find((r) => r.element === target);
  if (!row) throw new Error(`the DOM-fallback scan did not select ${fixture.name}`);
  return advertisement(row);
}

interface Outcome {
  success: boolean;
  refusal?: unknown;
  error?: string;
}

interface DispatchResponse {
  success?: boolean;
  error?: string;
  failureDetails?: { context?: { refusal?: unknown } };
}

function outcomeOf(res: DispatchResponse): Outcome {
  return {
    success: res.success === true,
    refusal: res.failureDetails?.context?.refusal,
    error: res.error,
  };
}

const emptyBridge: BridgeAccess = {
  elements: [],
  getElement: () => undefined,
  components: [],
  workflows: [],
};

type Dispatcher = 'executor' | 'relay';

/** Drive `verb` on the registered target through one dispatcher. */
async function dispatch(via: Dispatcher, verb: StandardAction): Promise<Outcome> {
  const params = VERB_PARAMS[verb];
  try {
    if (via === 'executor') {
      const res = await new DefaultActionExecutor(getGlobalRegistry()).executeAction(
        'oracle-target',
        { action: verb, params }
      );
      return outcomeOf(res as DispatchResponse);
    }
    // `skipSettle`: the relay otherwise waits for the DOM to go quiet before it
    // reads the registry, and every dispatch here follows a fresh mount — a
    // wait that measures nothing about the element's kind.
    const res = await executeCommand(
      'executeElementAction',
      {
        id: 'oracle-target',
        request: { action: verb, params, value: params.value },
        skipSettle: true,
      },
      emptyBridge
    );
    return outcomeOf(res as DispatchResponse);
  } catch (err) {
    return { success: false, error: `threw: ${(err as Error).message}` };
  }
}

/**
 * Every verb on a fresh mount of `fixture`, through `via`. Returns the
 * violations, so one failure names every verb that disagrees.
 */
async function violations(fixture: Fixture, via: Dispatcher): Promise<string[]> {
  const found: string[] = [];
  for (const verb of VERBS) {
    getGlobalRegistry().clear();
    const target = mount(fixture);
    const registered = getGlobalRegistry().registerElement('oracle-target', target);
    const advertised = registered.actions.includes(verb);
    const outcome = await dispatch(via, verb);
    await releaseForcedPseudoState('explicit');
    if (advertised && !outcome.success) {
      found.push(`advertises ${verb}, but ${via} failed it: ${outcome.error}`);
    } else if (!advertised && (outcome.success || outcome.refusal !== 'element-kind')) {
      found.push(
        `does not advertise ${verb}, but ${via} ` +
          (outcome.success
            ? 'performed it'
            : `refused it without the element-kind marker: ${outcome.error}`)
      );
    }
  }
  return found;
}

describe.each(FIXTURES)('$name', (fixture) => {
  it('reports one type and one actions list on every path that finds it', async () => {
    const target = mount(fixture);
    const expected = viaRegisterElement(target);
    const paths: Record<string, Advertisement> = {
      autoRegister: await viaAutoRegister(fixture, target),
      scannedRow: await viaScannedRow(fixture),
      ...(fixture.media ? {} : { domFallback: viaDomFallback(fixture, target) }),
    };
    expect(paths).toEqual(Object.fromEntries(Object.keys(paths).map((k) => [k, expected])));
  });

  it.each(['executor', 'relay'] as const)(
    'the %s performs every advertised verb and refuses every other with the element-kind marker',
    async (via) => {
      expect(await violations(fixture, via)).toEqual([]);
    },
    30_000
  );
});

describe('the inferred list is a default, never an override', () => {
  it('an explicit actions list wins over inference', () => {
    const registry = new UIBridgeRegistry();
    const registered = registry.registerElement('explicit', document.createElement('input'), {
      actions: ['click'],
    });
    expect(registered.actions).toEqual(['click']);
  });
});
