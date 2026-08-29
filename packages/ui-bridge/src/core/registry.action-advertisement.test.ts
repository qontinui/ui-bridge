/**
 * `inferActions` must advertise every verb the executor actually implements.
 *
 * The per-element `actions` array is ENFORCED, not descriptive. The runner's
 * MCP element-action door checks the verb against this list
 * (`is_action_advertised`, `qontinui-runner/src-tauri/src/mcp/ui_bridge/elements.rs`)
 * and answers `UNSUPPORTED_ACTION` with a `supported_actions` payload BEFORE
 * the SDK is reached. So a verb the executor supports but this list omits is
 * unreachable for every auto-registered element — the driver is told the
 * element cannot do it, which is false.
 *
 * That is what had happened to `setValue` and `sendKeys` on inputs:
 * `performSetValue` handles input/textarea/select and `performSendKeys`
 * focuses and dispatches to any element, but neither appeared on any inferred
 * list. The gap was being closed one hand-declared element at a time.
 */

import { describe, expect, it, afterEach } from 'vitest';
import { getGlobalRegistry } from './registry';
import { createActionExecutor } from '../control/action-executor';
import type { ElementType, StandardAction } from './types';

function actionsFor(type: ElementType, dom: HTMLElement): StandardAction[] {
  const id = `adv-${type}`;
  getGlobalRegistry().registerElement(id, dom, { type });
  return getGlobalRegistry().getElement(id)?.actions ?? [];
}

describe('inferActions advertises what the executor implements', () => {
  afterEach(() => {
    getGlobalRegistry().clear();
    document.body.innerHTML = '';
  });

  it('input advertises setValue and sendKeys', () => {
    const actions = actionsFor('input', document.createElement('input'));
    expect(actions).toContain('setValue');
    expect(actions).toContain('sendKeys');
    // Unchanged neighbours — this is an addition, not a rewrite.
    expect(actions).toContain('type');
    expect(actions).toContain('clear');
    expect(actions).toContain('click');
  });

  it('textarea advertises setValue and sendKeys', () => {
    const actions = actionsFor('textarea', document.createElement('textarea'));
    expect(actions).toContain('setValue');
    expect(actions).toContain('sendKeys');
    expect(actions).toContain('type');
  });

  it('select advertises setValue alongside select', () => {
    const actions = actionsFor('select', document.createElement('select'));
    expect(actions).toContain('setValue');
    expect(actions).toContain('select');
    // `performType` / `performClear` mutate `.value` on input/textarea only,
    // so a select must NOT claim them.
    expect(actions).not.toContain('type');
    expect(actions).not.toContain('clear');
  });

  it('form advertises submit and reset', () => {
    const actions = actionsFor('form', document.createElement('form'));
    expect(actions).toContain('submit');
    expect(actions).toContain('reset');
  });

  it('an explicit actions list still wins over inference', () => {
    const dom = document.createElement('input');
    getGlobalRegistry().registerElement('adv-explicit', dom, {
      type: 'input',
      actions: ['click'],
    });
    expect(getGlobalRegistry().getElement('adv-explicit')?.actions).toEqual(['click']);
  });
});

describe('setValue on an element that has no value', () => {
  afterEach(() => {
    getGlobalRegistry().clear();
    document.body.innerHTML = '';
  });

  it('fails instead of reporting success on an unchanged page', async () => {
    const dom = document.createElement('div');
    document.body.appendChild(dom);
    getGlobalRegistry().registerElement('adv-div', dom, { type: 'custom' });

    const executor = createActionExecutor(getGlobalRegistry());
    const res = await executor.executeAction('adv-div', {
      action: 'setValue',
      params: { value: 'anything' },
    });

    expect(res.success).toBe(false);
    expect(JSON.stringify(res)).toContain('setValue is not supported');
  });
});
