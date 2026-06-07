/**
 * Type-surface test for Phase 1 window targeting
 * (plan 2026-06-07-multi-window-sdk-automation).
 *
 * These objects are constructed WITHOUT casts: if `windowLabel` were missing
 * from the typed request bags, `tsc` would fail this file at build time. The
 * runtime assertions are incidental — the compile is the real assertion.
 */

import { describe, expect, it } from 'vitest';
import type { PageEvaluateRequest } from './types';
import type { ControlActionRequest } from '../control/types';

describe('Phase 1 typed surface — windowLabel is discoverable', () => {
  it('PageEvaluateRequest accepts windowLabel (and forwards extra fields)', () => {
    const req: PageEvaluateRequest = {
      expression: 'document.title',
      windowLabel: 'term-2',
    };
    expect(req.windowLabel).toBe('term-2');
    expect(req.expression).toBe('document.title');
  });

  it('ControlActionRequest accepts windowLabel', () => {
    const req: ControlActionRequest = {
      action: 'click',
      windowLabel: 'term-2',
    };
    expect(req.windowLabel).toBe('term-2');
  });

  it('windowLabel is optional everywhere (omitting it = main window)', () => {
    const evalReq: PageEvaluateRequest = { expression: '1 + 1' };
    const actionReq: ControlActionRequest = { action: 'click' };
    expect(evalReq.windowLabel).toBeUndefined();
    expect(actionReq.windowLabel).toBeUndefined();
  });
});
