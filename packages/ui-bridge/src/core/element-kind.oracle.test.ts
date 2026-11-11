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
  /**
   * The fixture opens a popup: a combobox's `select` or a text field's
   * `autocomplete` drives one, so {@link suggestions} is mounted beside it.
   * Only these fixtures get it — on a page with a listbox lying around, a
   * `select` on an accordion trigger "succeeds" by clicking it and then the
   * stray option, which hides exactly the over-advertising this file exists
   * to catch.
   */
  popup?: boolean;
}

/** `<input>` types typed into as text, whose `autocomplete` reads a popup. */
const TEXT_INPUT_TYPES = ['text', 'search', 'email', 'url', 'tel', 'password', 'number'];

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
  { name: '<textarea>', html: `<textarea ${T}></textarea>`, popup: true },
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
  ].map((type) => ({
    name: `<input type="${type}">`,
    html: `<input type="${type}" ${T}>`,
    popup: TEXT_INPUT_TYPES.includes(type),
  })),
  {
    name: '<input type="text"> inside a form',
    html: `<form><input type="text" ${T}></form>`,
    popup: true,
  },
  // The formatted-value inputs holding a value, so `clear` and `type` replace
  // one rather than act on an empty field.
  ...[
    ['date', '2024-01-02'],
    ['datetime-local', '2024-01-02T09:00'],
    ['month', '2024-01'],
    ['week', '2024-W01'],
    ['time', '09:00'],
    ['color', '#112233'],
  ].map(([type, value]) => ({
    name: `<input type="${type}" value="${value}">`,
    html: `<input type="${type}" value="${value}" ${T}>`,
  })),

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
    popup: role === 'combobox',
  })),

  // The attributes the toggle and select arms branch on. `aria-expanded` makes
  // a node toggle, never a combobox; `aria-haspopup="listbox"` makes one.
  {
    name: '<button aria-expanded> (disclosure button)',
    html: `<button aria-expanded="false" ${T}>more</button>`,
  },
  {
    name: '<button aria-expanded aria-controls> (accordion trigger)',
    html: `<h3><button aria-expanded="true" aria-controls="oracle-panel" ${T}>Section</button></h3><div id="oracle-panel" role="region">panel</div>`,
  },
  {
    name: '<button aria-haspopup="menu" aria-expanded> (menu button)',
    html: `<button aria-haspopup="menu" aria-expanded="false" ${T}>menu</button>`,
  },
  {
    name: '<div role="button" aria-haspopup="listbox"> (select-only trigger)',
    html: `<div role="button" tabindex="0" aria-haspopup="listbox" ${T}>pick</div>`,
    popup: true,
  },

  // Click-toggled state: a toggle button (Radix `Toggle`) and the menu
  // checkbox / radio items (Radix `DropdownMenu.CheckboxItem` / `RadioItem`).
  {
    name: '<button aria-pressed> (toggle button)',
    html: `<button type="button" aria-pressed="false" ${T}>bold</button>`,
  },
  {
    name: '<div role="menuitemcheckbox">',
    html: `<div role="menu"><div role="menuitemcheckbox" aria-checked="false" tabindex="-1" ${T}>wrap</div></div>`,
  },
  {
    name: '<div role="menuitemradio">',
    html: `<div role="menu"><div role="menuitemradio" aria-checked="false" tabindex="-1" ${T}>left</div></div>`,
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
  {
    name: '<button role="combobox">',
    html: `<button role="combobox" ${T}>pick</button>`,
    popup: true,
  },
  {
    name: '<button role="combobox" aria-expanded> (select-only combobox trigger)',
    html: `<button role="combobox" aria-expanded="false" ${T}>pick</button>`,
    popup: true,
  },
  {
    name: '<input role="combobox"> (editable combobox)',
    html: `<input type="text" role="combobox" ${T}>`,
    popup: true,
  },
  {
    name: '<input type="checkbox" role="switch">',
    html: `<input type="checkbox" role="switch" ${T}>`,
  },
  { name: '<button role="tab">', html: `<button role="tab" ${T}>t</button>` },
  {
    name: '<input type="number" role="spinbutton">',
    html: `<input type="number" role="spinbutton" ${T}>`,
    popup: true,
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
  if (fixture.popup) host.appendChild(suggestions);
  const target = host.querySelector<HTMLElement>(`[${TARGET}]`);
  if (!target) throw new Error(`fixture "${fixture.name}" has no [${TARGET}] node`);
  // The interactive scanners all select `[data-testid]`, so every non-media
  // spelling is found by each of them whatever its tag or role.
  if (!fixture.media) target.setAttribute('data-testid', 'oracle-target');
  layOut(target);
  return target;
}

/**
 * A listbox offering the option `a`. A combobox's `select` and an input's
 * `autocomplete` drive a popup; this is the popup they find, so both can
 * SUCCEED rather than time out looking for one. Mounted only beside a fixture
 * marked {@link Fixture.popup}.
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
async function dispatch(
  via: Dispatcher,
  verb: StandardAction,
  params: Record<string, unknown> = VERB_PARAMS[verb]
): Promise<Outcome> {
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

/**
 * The date, time, colour and file inputs: the base (origin/main 7f766ae)
 * advertised `type` and `clear` on every `<input>`, and both dispatchers
 * performed them on these. The oracle above holds success; these hold the
 * EFFECT, on both dispatchers, so a verb that "succeeds" by doing nothing fails.
 */
describe('date, time, colour and file inputs: the value verbs do what they say', () => {
  const kinds = (html: string): string[] => {
    host.innerHTML = html;
    const el = host.querySelector<HTMLElement>(`[${TARGET}]`) as HTMLElement;
    return [...new UIBridgeRegistry().registerElement('oracle', el).actions];
  };

  it.each([['date'], ['datetime-local'], ['month'], ['week'], ['time'], ['color']])(
    '<input type="%s"> advertises type, clear and setValue, and not autocomplete',
    (type) => {
      const actions = kinds(`<input type="${type}" ${T}>`);
      expect(actions).toEqual(expect.arrayContaining(['type', 'clear', 'setValue']));
      expect(actions).not.toContain('autocomplete');
    }
  );

  it('<input type="file"> advertises clear, and neither type nor setValue', () => {
    const actions = kinds(`<input type="file" ${T}>`);
    expect(actions).toContain('clear');
    expect(actions).not.toContain('type');
    expect(actions).not.toContain('setValue');
  });

  /** Mount `html`, register its target, run one verb through `via`, return the target. */
  async function run(
    via: Dispatcher,
    html: string,
    verb: StandardAction,
    params: Record<string, unknown>
  ): Promise<{ outcome: Outcome; target: HTMLInputElement; events: string[] }> {
    getGlobalRegistry().clear();
    const target = mount({ name: html, html }) as HTMLInputElement;
    const events: string[] = [];
    for (const type of ['input', 'change']) {
      target.addEventListener(type, () => events.push(type));
    }
    getGlobalRegistry().registerElement('oracle-target', target);
    const outcome = await dispatch(via, verb, params);
    return { outcome, target, events };
  }

  describe.each(['executor', 'relay'] as const)('through the %s', (via) => {
    it.each([
      ['date', '2024-01-02', ''],
      ['datetime-local', '2024-01-02T09:00', ''],
      ['month', '2024-01', ''],
      ['week', '2024-W01', ''],
      ['time', '09:00', ''],
      // A colour has no empty value: cleared, it is the default colour.
      ['color', '#112233', '#000000'],
    ])('clear empties <input type="%s" value="%s">', async (type, value, cleared) => {
      const { outcome, target } = await run(
        via,
        `<input type="${type}" value="${value}" ${T}>`,
        'clear',
        {}
      );
      expect(outcome).toMatchObject({ success: true });
      expect(target.value).toBe(cleared);
    });

    it.each([
      ['time', '', '10:30'],
      ['time', '09:00', '10:30'],
      ['date', '', '2024-03-04'],
      ['date', '2024-01-02', '2024-03-04'],
      ['datetime-local', '', '2024-03-04T10:30'],
      ['month', '', '2024-03'],
      ['week', '', '2024-W10'],
      ['color', '#112233', '#ff0000'],
    ])('type into <input type="%s" value="%s"> sets %s', async (type, value, text) => {
      const { outcome, target } = await run(
        via,
        `<input type="${type}" value="${value}" ${T}>`,
        'type',
        { text }
      );
      expect(outcome).toMatchObject({ success: true });
      expect(target.value).toBe(text);
    });

    it('clear empties a file input and fires input and change', async () => {
      const { outcome, target, events } = await run(via, `<input type="file" ${T}>`, 'clear', {});
      expect(outcome).toMatchObject({ success: true });
      expect(target.value).toBe('');
      expect(target.files?.length ?? 0).toBe(0);
      expect(events).toEqual(expect.arrayContaining(['input', 'change']));
    });

    it('type into a file input is the element-kind refusal', async () => {
      const { outcome } = await run(via, `<input type="file" ${T}>`, 'type', { text: 'x' });
      expect(outcome).toMatchObject({ success: false, refusal: 'element-kind' });
    });

    it('autocomplete on a date input is the element-kind refusal', async () => {
      const { outcome } = await run(via, `<input type="date" ${T}>`, 'autocomplete', {
        searchText: 'a',
        suggestionTimeout: 10,
      });
      expect(outcome).toMatchObject({ success: false, refusal: 'element-kind' });
    });
  });
});

describe('select is advertised only on a node that opens a listbox', () => {
  const actionsOf = (html: string): string[] => {
    host.innerHTML = html;
    const el = host.querySelector<HTMLElement>(`[${TARGET}]`) as HTMLElement;
    return [...new UIBridgeRegistry().registerElement('oracle', el).actions];
  };

  it.each([
    ['an accordion trigger', `<button aria-expanded="true" aria-controls="p" ${T}>s</button>`],
    ['a disclosure button', `<button aria-expanded="false" ${T}>more</button>`],
    ['a menu button', `<button aria-haspopup="menu" aria-expanded="false" ${T}>m</button>`],
    [
      'an aria-haspopup="true" button',
      `<button aria-haspopup="true" aria-expanded="false" ${T}>m</button>`,
    ],
  ])('%s toggles and does not advertise select', (_name, html) => {
    const actions = actionsOf(html);
    expect(actions).toContain('toggle');
    expect(actions).not.toContain('select');
  });

  it.each([
    ['a role="combobox" button', `<button role="combobox" ${T}>p</button>`],
    [
      'an aria-haspopup="listbox" trigger',
      `<div role="button" aria-haspopup="listbox" ${T}>p</div>`,
    ],
  ])('%s advertises select', (_name, html) => {
    expect(actionsOf(html)).toContain('select');
  });

  it.each(['executor', 'relay'] as const)(
    'the %s refuses select on an accordion trigger without clicking it, even with a listbox on the page',
    async (via) => {
      getGlobalRegistry().clear();
      const target = mount({
        name: 'accordion',
        html: `<button aria-expanded="false" ${T}>s</button>`,
        popup: true,
      });
      let clicks = 0;
      target.addEventListener('click', () => clicks++);
      getGlobalRegistry().registerElement('oracle-target', target);
      const outcome = await dispatch(via, 'select');
      expect(outcome).toMatchObject({ success: false, refusal: 'element-kind' });
      expect(clicks).toBe(0);
    }
  );
});

describe('toggle on click-toggled state: the framework handler runs on both dispatchers', () => {
  it.each([
    [
      'a toggle button',
      `<button type="button" aria-pressed="false" ${T}>bold</button>`,
      'aria-pressed',
    ],
    [
      'a menu checkbox item',
      `<div role="menuitemcheckbox" aria-checked="false" ${T}>wrap</div>`,
      'aria-checked',
    ],
  ])('%s advertises toggle and flips through its own click handler', async (_name, html, attr) => {
    for (const via of ['executor', 'relay'] as const) {
      getGlobalRegistry().clear();
      const target = mount({ name: html, html });
      // What the component library does: its click handler owns the state.
      target.addEventListener('click', () =>
        target.setAttribute(attr, target.getAttribute(attr) === 'true' ? 'false' : 'true')
      );
      const registered = getGlobalRegistry().registerElement('oracle-target', target);
      expect(registered.actions).toContain('toggle');
      const outcome = await dispatch(via, 'toggle');
      expect(outcome, via).toMatchObject({ success: true });
      expect(target.getAttribute(attr), via).toBe('true');
    }
  });

  /** Mount `html` with a click handler that flips `aria-checked`, as Radix's CheckboxItem does. */
  function mountFlipping(html: string): HTMLElement {
    getGlobalRegistry().clear();
    const target = mount({ name: html, html });
    target.addEventListener('click', () =>
      target.setAttribute(
        'aria-checked',
        target.getAttribute('aria-checked') === 'true' ? 'false' : 'true'
      )
    );
    getGlobalRegistry().registerElement('oracle-target', target);
    return target;
  }

  it.each(['executor', 'relay'] as const)(
    'the %s checks and unchecks a menu checkbox item by clicking it when its state disagrees',
    async (via) => {
      const html = `<div role="menuitemcheckbox" aria-checked="false" ${T}>wrap</div>`;
      let target = mountFlipping(html);
      expect(getGlobalRegistry().getElement('oracle-target')?.actions).toEqual(
        expect.arrayContaining(['check', 'uncheck', 'toggle'])
      );
      expect(await dispatch(via, 'check')).toMatchObject({ success: true });
      expect(target.getAttribute('aria-checked')).toBe('true');
      // Already checked: a second check leaves it checked.
      expect(await dispatch(via, 'check')).toMatchObject({ success: true });
      expect(target.getAttribute('aria-checked')).toBe('true');
      target = mountFlipping(html.replace('"false"', '"true"'));
      expect(await dispatch(via, 'uncheck')).toMatchObject({ success: true });
      expect(target.getAttribute('aria-checked')).toBe('false');
    }
  );

  // Radix `DropdownMenu.RadioItem` only SELECTS: clicking a checked item leaves
  // it checked. So `toggle` on one would report success over an unchanged page
  // — it is refused — and `check` is how it is selected.
  it.each(['executor', 'relay'] as const)(
    'the %s refuses toggle on a menu radio item and checks it by click',
    async (via) => {
      const html = `<div role="menuitemradio" aria-checked="false" ${T}>left</div>`;
      getGlobalRegistry().clear();
      const target = mount({ name: html, html });
      let clicks = 0;
      target.addEventListener('click', () => {
        clicks++;
        target.setAttribute('aria-checked', 'true');
      });
      const registered = getGlobalRegistry().registerElement('oracle-target', target);
      expect(registered.actions).toContain('check');
      expect(registered.actions).not.toContain('toggle');
      expect(registered.actions).not.toContain('uncheck');

      expect(await dispatch(via, 'toggle')).toMatchObject({
        success: false,
        refusal: 'element-kind',
      });
      expect(clicks).toBe(0);

      expect(await dispatch(via, 'check')).toMatchObject({ success: true });
      expect(target.getAttribute('aria-checked')).toBe('true');
      expect(clicks).toBe(1);
      // Checked already: check clicks nothing.
      expect(await dispatch(via, 'check')).toMatchObject({ success: true });
      expect(clicks).toBe(1);

      expect(await dispatch(via, 'uncheck')).toMatchObject({
        success: false,
        refusal: 'element-kind',
      });
    }
  );
});
