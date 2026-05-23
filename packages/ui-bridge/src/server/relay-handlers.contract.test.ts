/**
 * Relay ↔ browser command-handler drift guard.
 *
 * Root-cause regression coverage for the SDK interaction-API parity gap:
 * `relay-handlers.ts` relays the app-agnostic interaction commands
 * (clickByText / clickBySelector / typeInto / readValue / findByText) over the
 * SDK command channel, but the browser-side executor (`react/commandHandlers.ts`)
 * had NO matching `case`, so every relayed call hit
 * `default: throw new Error('Unknown command action')`. The runner then
 * silently fell back to its own Tauri webview, masking the failure.
 *
 * This test pins the contract on two fronts:
 *
 *   1. STATIC parity — every canonical action in
 *      `INTERACTION_RELAY_COMMAND_ACTIONS` (server/types.ts) appears both as a
 *      `relayCommand('<action>', ...)` call site in `relay-handlers.ts` AND as
 *      a `case '<action>'` in `react/commandHandlers.ts`. If a future change
 *      adds a relayed action without a browser case (or vice-versa), this
 *      fails — the browser executor can never again queue an action it cannot
 *      execute.
 *
 *   2. FUNCTIONAL — `executeCommand` actually runs each interaction against a
 *      live (jsdom) DOM and produces the expected effect, never throwing
 *      `Unknown command action`.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { INTERACTION_RELAY_COMMAND_ACTIONS } from './types';
import { executeCommand, type BridgeAccess } from '../react/commandHandlers';
import { resetGlobalRegistry } from '../core/registry';

const here = dirname(fileURLToPath(import.meta.url));
const relayHandlersSrc = readFileSync(resolve(here, 'relay-handlers.ts'), 'utf8');
const commandHandlersSrc = readFileSync(
  resolve(here, '../react/commandHandlers.ts'),
  'utf8'
);

const emptyBridge: BridgeAccess = {
  elements: [],
  getElement: () => undefined,
  components: [],
  workflows: [],
};

describe('relay ↔ commandHandlers drift guard · static parity', () => {
  it.each(INTERACTION_RELAY_COMMAND_ACTIONS)(
    "relay-handlers.ts relays '%s'",
    (action) => {
      // Matches: relayCommand('action' ...) or relayCommand<T>('action' ...)
      const re = new RegExp(`relayCommand(?:<[^>]*>)?\\(\\s*'${action}'`);
      expect(relayHandlersSrc).toMatch(re);
    }
  );

  it.each(INTERACTION_RELAY_COMMAND_ACTIONS)(
    "commandHandlers.ts has a browser case for '%s'",
    (action) => {
      expect(commandHandlersSrc).toMatch(new RegExp(`case '${action}'`));
    }
  );
});

describe('relay ↔ commandHandlers drift guard · functional', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    resetGlobalRegistry();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
    resetGlobalRegistry();
  });

  it('none of the canonical interaction actions throw "Unknown command action"', async () => {
    for (const action of INTERACTION_RELAY_COMMAND_ACTIONS) {
      // Intentionally minimal payloads — we only assert the dispatcher
      // recognizes the action (no throw). Bad/empty payloads return a
      // structured `{success:false}` body, which is fine here.
      await expect(executeCommand(action, {}, emptyBridge)).resolves.toBeDefined();
    }
  });

  it('clickByText clicks a matching element in the live DOM', async () => {
    const btn = document.createElement('button');
    btn.textContent = 'Visual Editor';
    let clicked = false;
    btn.addEventListener('click', () => {
      clicked = true;
    });
    container.appendChild(btn);

    // Scope to the `button` tag — `findElementsByText` with the default `*`
    // selector returns ancestor containers (body/div) first in document order,
    // exactly like the standalone-server `clickByText`. The `tag` filter is
    // the documented way to target the interactive leaf.
    const result = (await executeCommand(
      'clickByText',
      { text: 'Visual', tag: 'button' },
      emptyBridge
    )) as { clicked?: boolean; element?: { tag?: string } };

    expect(clicked).toBe(true);
    expect(result.clicked).toBe(true);
    expect(result.element?.tag).toBe('button');
  });

  it('clickBySelector clicks the element matched by the selector', async () => {
    const btn = document.createElement('button');
    btn.id = 'go';
    let clicked = false;
    btn.addEventListener('click', () => {
      clicked = true;
    });
    container.appendChild(btn);

    const result = (await executeCommand(
      'clickBySelector',
      { selector: '#go' },
      emptyBridge
    )) as { clicked?: boolean };

    expect(clicked).toBe(true);
    expect(result.clicked).toBe(true);
  });

  it('typeInto fills an input by selector and fires React-aware events', async () => {
    const input = document.createElement('input');
    input.id = 'name';
    let inputEvents = 0;
    let changeEvents = 0;
    input.addEventListener('input', () => {
      inputEvents++;
    });
    input.addEventListener('change', () => {
      changeEvents++;
    });
    container.appendChild(input);

    const result = (await executeCommand(
      'typeInto',
      { selector: '#name', text: 'hello' },
      emptyBridge
    )) as { typed?: boolean; element?: { value?: string } };

    expect(result.typed).toBe(true);
    expect(input.value).toBe('hello');
    expect(result.element?.value).toBe('hello');
    expect(inputEvents).toBeGreaterThan(0);
    expect(changeEvents).toBeGreaterThan(0);
  });

  it('typeInto resolves an input by associated label', async () => {
    const label = document.createElement('label');
    label.htmlFor = 'email';
    label.textContent = 'Email Address';
    const input = document.createElement('input');
    input.id = 'email';
    container.appendChild(label);
    container.appendChild(input);

    await executeCommand(
      'typeInto',
      { label: 'Email', text: 'a@b.com' },
      emptyBridge
    );

    expect(input.value).toBe('a@b.com');
  });

  it('readValue returns the value of the matched input', async () => {
    const input = document.createElement('input');
    input.id = 'token';
    input.value = 'abc123';
    container.appendChild(input);

    const result = (await executeCommand(
      'readValue',
      { selector: '#token' },
      emptyBridge
    )) as { value?: string | null; length?: number };

    expect(result.value).toBe('abc123');
    expect(result.length).toBe(6);
  });

  it('findByText returns all matching elements as an array', async () => {
    const a = document.createElement('button');
    a.textContent = 'Save Draft';
    const b = document.createElement('button');
    b.textContent = 'Save Now';
    container.appendChild(a);
    container.appendChild(b);

    const result = (await executeCommand(
      'findByText',
      { text: 'Save', tag: 'button' },
      emptyBridge
    )) as Array<{ tag: string; text: string }>;

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(2);
    expect(result[0].tag).toBe('button');
  });

  it('returns a structured error (not a throw) for missing targets', async () => {
    const result = (await executeCommand(
      'clickByText',
      { text: 'does-not-exist-anywhere' },
      emptyBridge
    )) as { success?: boolean; error?: string };

    expect(result.success).toBe(false);
    expect(result.error).toContain('No element found');
  });
});
