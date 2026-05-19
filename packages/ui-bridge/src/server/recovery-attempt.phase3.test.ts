/**
 * Phase 3 — `attemptRecovery` (POST /ai/recovery/attempt) consumes a sync
 * failure's canonical `RecoverySuggestion[]` directly, with NO NL roundtrip
 * to synthesize the suggestions, and selects the highest-confidence
 * retryable command first.
 *
 * Plan: 2026-05-18-ui-bridge-diagnostic-discipline-plan.md §8 (Phase 3).
 *
 * The synthetic failure is exactly what `action-executor.executeAction`
 * builds for a hidden-element sync click (`buildActionFailureDetails`
 * → `getRecoverySuggestions('UB-ELEM-NOT-VISIBLE', { elementId })`). With an
 * empty registry every NL recovery attempt fails, so `strategiesAttempted`
 * deterministically records the *order* the handler chose — that order is
 * the assertion target.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { createHandlers, type RegistryLike } from './handlers';
import { resetGlobalRegistry, getGlobalRegistry } from '../core/registry';
import { getRecoverySuggestions } from '../diagnostics';
import type { StructuredFailureInfo } from '../ai/types';

beforeAll(() => {
  if (typeof document !== 'undefined' && !document.elementFromPoint) {
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => null,
    });
  }
});

function makeRegistryLike(): RegistryLike {
  const reg = getGlobalRegistry();
  return {
    getAllElements: () => reg.getAllElements(),
    getElement: (id) => reg.getElement(id),
    getAllComponents: () => reg.getAllComponents(),
    getComponent: (id) => reg.getComponent(id),
    getComponentState: (id) => reg.getComponentState?.(id) ?? null,
    createSnapshot: () =>
      reg.createSnapshot() as ReturnType<RegistryLike['createSnapshot']>,
  };
}

function makeActionExecutor() {
  return {
    executeAction: async () => ({ success: false, error: 'no element' }),
    executeComponentAction: async () => ({ success: false }),
  };
}

describe('Phase 3 — attemptRecovery consumes sync RecoverySuggestion[] (no NL roundtrip)', () => {
  beforeEach(() => resetGlobalRegistry());
  afterEach(() => resetGlobalRegistry());

  it('selects the highest-confidence retryable command from a sync-click failure first', async () => {
    // Exactly the suggestions a sync hidden-element click produces.
    const suggestedActions = getRecoverySuggestions('UB-ELEM-NOT-VISIBLE', {
      elementId: 'hidden-cta',
    });

    // Sanity: the catalog top (priority 1 / confidence 0.9) is the
    // scroll/reveal command, and it is retryable.
    const top = [...suggestedActions].sort(
      (a, b) => (b.confidence ?? 0) - (a.confidence ?? 0)
    )[0];
    expect(top.command).toBe('scroll to element');
    expect(top.retryable).toBe(true);

    const failure: StructuredFailureInfo = {
      errorCode: 'UB-ELEM-NOT-VISIBLE',
      message: 'element is not visible (hidden); click was not dispatched',
      elementId: 'hidden-cta',
      suggestedActions,
      retryRecommended: true,
    };

    const handlers = createHandlers(
      makeRegistryLike(),
      makeActionExecutor() as never
    );

    const res = await handlers.attemptRecovery({
      failure,
      instruction: 'click hidden-cta',
      elementId: 'hidden-cta',
      maxRetries: 1,
    });

    expect(res.success).toBe(true);
    const data = res.data!;
    // Empty registry -> nothing recovers, but the *first* strategy attempted
    // must be the highest-confidence retryable command (the scroll/reveal
    // one), proving sync suggestions drove selection with no NL synthesis.
    expect(data.strategiesAttempted.length).toBeGreaterThan(0);
    expect(data.strategiesAttempted[0]).toBe(top.suggestion);
    // The chosen first suggestion is the rendered scroll command (carries
    // the element id, not the raw placeholder).
    expect(data.strategiesAttempted[0]).toContain('hidden-cta');
    expect(data.strategiesAttempted[0]).not.toContain('${elementId}');
  });

  it('prefers a retryable-with-command suggestion over an earlier non-command one', async () => {
    // Hand-built ordering: a high-confidence NON-command advice first, then a
    // lower-confidence retryable command. The handler must still execute the
    // command-bearing retryable one first.
    const failure: StructuredFailureInfo = {
      errorCode: 'UB-ELEM-NOT-FOUND',
      message: 'Element not found: x',
      elementId: 'x',
      suggestedActions: [
        {
          suggestion: 'Use a more specific description',
          confidence: 0.95,
          retryable: false,
          priority: 1,
        },
        {
          suggestion: 'Scroll the page to reveal x',
          command: 'scroll down',
          confidence: 0.6,
          retryable: true,
          priority: 3,
        },
      ],
      retryRecommended: true,
    };

    const handlers = createHandlers(
      makeRegistryLike(),
      makeActionExecutor() as never
    );

    const res = await handlers.attemptRecovery({
      failure,
      instruction: 'click x',
      elementId: 'x',
      maxRetries: 1,
    });

    expect(res.success).toBe(true);
    expect(res.data!.strategiesAttempted[0]).toBe('Scroll the page to reveal x');
  });
});
