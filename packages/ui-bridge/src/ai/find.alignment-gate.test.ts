/**
 * Regression: `ai/find` must not report a confident match for a query whose
 * own words this element does not answer for.
 *
 * THE DEFECT. `analyzeTokenAlignment` graded how well the query's tokens lined
 * up with a candidate, but that verdict was only ever a RANKING signal — it
 * picked a base score inside `scoreTextMatch` and nothing downstream looked at
 * it again. The final confidence is a weighted average, so branches that know
 * nothing about token coverage could carry a badly-aligned candidate over the
 * 0.5 default `confidenceThreshold` on their own:
 *
 *   - a `partial` text score of 0.7 at weight 0.35, plus
 *   - a synonym hit of 0.85 at weight 0.15
 *   → 0.745, reported as `found: true`.
 *
 * That is how the reported case returned a confident hit on an element that
 * answered for the query's FIRST word and nothing whatsoever for its second.
 * A confidently-wrong answer is worse than no answer: the caller acts on it.
 *
 * The fix caps such a match below the threshold rather than zeroing it, so it
 * still ranks sensibly inside `partialMatches` / `alternatives` — which is
 * exactly where a caller asked to see near misses.
 *
 * WHAT MUST NOT REGRESS ALONGSIDE IT: typo tolerance. A whole-string fuzzy
 * match compares the ENTIRE query to the ENTIRE target, so nothing is left
 * unaccounted for and the cap must not fire. Both directions are pinned here,
 * because a gate that also swallows typos would have traded one silent failure
 * for another.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { find } from './find';
import { SearchEngine } from './search-engine';
import type { RegisteredElement, ElementState } from '../core/types';

function defaultState(): ElementState {
  return {
    visible: true,
    enabled: true,
    focused: false,
    checked: false,
    textContent: '',
    rect: { x: 0, y: 0, width: 200, height: 30 },
    attributes: {},
  };
}

function makeRegistered(id: string, el: HTMLElement, type = 'button'): RegisteredElement {
  return {
    id,
    type,
    label: id,
    element: el,
    actions: ['click'],
    aliases: [],
    description: '',
    getState: () => ({ ...defaultState(), textContent: el.textContent || '' }),
  } as unknown as RegisteredElement;
}

function page(...labels: string[]): SearchEngine {
  const engine = new SearchEngine();
  document.body.innerHTML = '';
  const regs = labels.map((label, i) => {
    const b = document.createElement('button');
    b.textContent = label;
    document.body.appendChild(b);
    return makeRegistered(`btn-${i}`, b);
  });
  engine.updateElements(regs);
  return engine;
}

describe('ai/find — token alignment is a GATE, not only a reward', () => {
  let engine: SearchEngine;

  beforeEach(() => {
    // Deliberately NOT a "Session Manager"-shaped query: the runner shipped an
    // addressable `SessionManagerToggle` titled "Session Manager", so that
    // query now has a legitimate target and would pass for the wrong reason.
    // "Warehouse" appears nowhere on this page, in any form.
    engine = page('Export Report', 'Refresh Data', 'Save Draft');
  });

  it('does NOT report found for a query whose significant tokens are unmatched', () => {
    const result = find('Export Warehouse', engine);

    // "export" matches exactly; "warehouse" matches nothing at all. Before the
    // gate this returned found:true at ~0.90 on the "Export Report" button.
    expect(result.found).toBe(false);
  });

  it('caps the near miss below the threshold rather than hiding it', () => {
    // `debug` surfaces the sub-threshold candidates the primary search dropped,
    // which is how a caller distinguishes "considered and rejected" from
    // "never scanned". The capped candidate must still be visible there.
    const result = find('Export Warehouse', engine, { debug: true });
    expect(result.found).toBe(false);
    if (result.found) return;

    const capped = (result.alternatives ?? []).find((c) => c.elementId === 'btn-0');
    expect(capped, 'the near miss must still be reported as an alternative').toBeDefined();
    expect(capped!.confidence).toBeLessThan(0.5);
    expect(capped!.matchReasons.join(' | ')).toContain('capped');
  });

  it('still finds the element when every query token IS answered for', () => {
    const result = find('Export Report', engine);
    expect(result.found).toBe(true);
    if (!result.found || result.ambiguous) return;
    expect(result.elementId).toBe('btn-0');
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it('a single unmatched token is enough — a matching prefix does not carry it', () => {
    expect(find('Save Warehouse', engine).found).toBe(false);
    expect(find('Refresh Warehouse', engine).found).toBe(false);
  });

  it('does NOT swallow typo tolerance: a whole-string fuzzy match still finds', () => {
    // Every character of the query is accounted for by the target as a whole,
    // so this is an aligned match despite tokenizing to nothing.
    const typos = page('Submit Button');
    const response = typos.search({ text: 'Sumbit Buton', fuzzy: true });
    expect(response.bestMatch).not.toBeNull();
    expect(response.bestMatch!.element.id).toBe('btn-0');
  });

  it('leaves non-text criteria alone — a structured role/type search is not "unaligned"', () => {
    // There is no text criterion to align against here, so the cap must not
    // fire. Capping a `{ type: 'button' }` search would break every structured
    // caller that never supplied a query string at all.
    const response = engine.search({ type: 'button' });
    expect(response.results.length).toBeGreaterThan(0);
    for (const r of response.results) {
      expect(r.matchReasons.join(' | ')).not.toContain('capped');
    }
  });
});

describe('ai/find — matchReasons are deduped (display only)', () => {
  it('lists a repeated synonym pair once, not once per alias that contains it', () => {
    const engine = page('Refresh Data');

    const response = engine.search({ text: 'Refresh Data' });
    expect(response.bestMatch).not.toBeNull();
    const reasons = response.bestMatch!.matchReasons;

    // Non-vacuous: the generated alias set really does repeat the word, so the
    // undeduped double loop pushed this pair several times.
    const aliases = response.bestMatch!.element.aliases ?? [];
    expect(aliases.filter((a) => a.split(/\s+/).includes('refresh')).length).toBeGreaterThan(1);

    const selfPair = reasons.filter((r) => r === 'synonym match: "refresh" ~ "refresh"');
    expect(selfPair).toHaveLength(1);
    expect(new Set(reasons).size, `duplicate reasons: ${reasons.join(' | ')}`).toBe(reasons.length);
  });
});
