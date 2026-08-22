/**
 * Phase 4 — the static verb→effect map and the override precedence rule.
 *
 * Plan: `2026-08-20-ui-bridge-action-declaration-shape.md`, Phase 4.
 *
 * Every expectation is a **hand-written literal**. Nothing here is asserted
 * against `STANDARD_ACTION_EFFECTS`, against the `IREffect` type, or via
 * `satisfies` / a type assertion: a test written against the constant it is
 * meant to pin proves nothing, because editing the constant would silently
 * edit the test with it. The map is spelled out verb by verb below so a
 * reclassification has to be made deliberately, in the diff.
 */

import { describe, it, expect } from 'vitest';
import {
  STANDARD_ACTION_EFFECTS,
  standardActionEffect,
  resolveActionEffect,
} from './action-effect';

describe('Phase 4 — STANDARD_ACTION_EFFECTS', () => {
  it('classifies all 22 standard verbs exactly as written here', () => {
    expect(STANDARD_ACTION_EFFECTS).toEqual({
      click: 'write',
      hoverClick: 'write',
      doubleClick: 'write',
      rightClick: 'read',
      middleClick: 'write',
      type: 'write',
      sendKeys: 'write',
      clear: 'write',
      select: 'write',
      focus: 'read',
      blur: 'read',
      hover: 'read',
      scroll: 'read',
      scrollIntoView: 'read',
      check: 'write',
      uncheck: 'write',
      toggle: 'write',
      setValue: 'write',
      drag: 'write',
      submit: 'write',
      reset: 'write',
      autocomplete: 'write',
    });
  });

  it('covers exactly 22 verbs', () => {
    expect(Object.keys(STANDARD_ACTION_EFFECTS)).toHaveLength(22);
  });

  it('never defaults a verb to destructive — that value is declaration-only', () => {
    // Destructiveness is a property of what a control does, not of the verb
    // used to reach it. A static map producing it would be producing it by
    // accident, on the one value where being wrong is dangerous.
    expect(Object.values(STANDARD_ACTION_EFFECTS)).not.toContain('destructive');
  });

  it('reads a representative read verb and a representative write verb', () => {
    expect(standardActionEffect('hover')).toBe('read');
    expect(standardActionEffect('click')).toBe('write');
  });

  it('classifies rightClick as read — revealing a menu commits nothing', () => {
    expect(standardActionEffect('rightClick')).toBe('read');
  });

  it('classifies middleClick as write — no dominant read-only convention', () => {
    expect(standardActionEffect('middleClick')).toBe('write');
  });

  it('classifies submit and reset as write, not destructive', () => {
    expect(standardActionEffect('submit')).toBe('write');
    expect(standardActionEffect('reset')).toBe('write');
  });

  it('returns undefined for an id that is not a standard verb', () => {
    // UNKNOWN, not "safe".
    expect(standardActionEffect('archiveInvoice')).toBeUndefined();
    expect(standardActionEffect('')).toBeUndefined();
  });

  it('does not resolve inherited Object.prototype keys as verbs', () => {
    expect(standardActionEffect('toString')).toBeUndefined();
    expect(standardActionEffect('constructor')).toBeUndefined();
  });
});

describe('Phase 4 — resolveActionEffect precedence', () => {
  it('falls back to the verb map when no effect is declared', () => {
    expect(resolveActionEffect({ id: 'hover' })).toBe('read');
    expect(resolveActionEffect({ id: 'click' })).toBe('write');
  });

  it('lets an explicit effect override the verb map', () => {
    // The delete button: `click` maps to `write`, and that default is
    // guaranteed wrong here — which is the entire reason the override ships.
    expect(resolveActionEffect({ id: 'click', effect: 'destructive' })).toBe('destructive');
    // The override works in the safe direction too.
    expect(resolveActionEffect({ id: 'click', effect: 'read' })).toBe('read');
    expect(resolveActionEffect({ id: 'hover', effect: 'write' })).toBe('write');
  });

  it('uses the declaration for a free-form id the map cannot cover', () => {
    expect(resolveActionEffect({ id: 'archiveInvoice', effect: 'destructive' })).toBe('destructive');
  });

  it('returns undefined when neither source has an answer', () => {
    expect(resolveActionEffect({ id: 'archiveInvoice' })).toBeUndefined();
  });

  it('treats an explicitly-undefined effect as absent, not as a value', () => {
    expect(resolveActionEffect({ id: 'click', effect: undefined })).toBe('write');
  });
});
