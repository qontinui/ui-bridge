/**
 * `RELAY_ELEMENT_ACTIONS` must name exactly the verbs the relay's
 * `executeElementAction` switch has a case for.
 *
 * Since ui-bridge#331 the list is load-bearing in both directions:
 * `relayAcceptedVerbs` FILTERS an element's advertised verbs through it, and
 * falls back to it when nothing survives. A case added to the switch but not
 * to the list is a runnable verb the unknown-verb refusal silently drops from
 * its suggestion; a list entry with no case is a suggestion the relay then
 * refuses — the exact defect #331 fixed. The list's own comment said "keep in
 * step"; this test is what keeps it there.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'commandHandlers.ts'),
  'utf8'
);

function listEntries(): string[] {
  const m = /const RELAY_ELEMENT_ACTIONS: readonly string\[\] = \[([\s\S]*?)\];/.exec(source);
  if (!m) throw new Error('RELAY_ELEMENT_ACTIONS literal not found in commandHandlers.ts');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

function switchCases(): string[] {
  const start = source.indexOf('switch (request.action) {');
  if (start < 0) throw new Error('`switch (request.action)` not found in commandHandlers.ts');
  // Walk braces to the switch's own closing brace so a later switch is never read.
  let depth = 0;
  let end = -1;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('unbalanced braces after `switch (request.action)`');
  const body = source.slice(start, end);
  return [...body.matchAll(/\bcase '([^']+)':/g)].map((x) => x[1]);
}

describe('relay verb list parity', () => {
  it('finds a non-trivial set on both sides (the parse is not vacuous)', () => {
    expect(listEntries().length).toBeGreaterThan(10);
    expect(switchCases().length).toBeGreaterThan(10);
  });

  it('RELAY_ELEMENT_ACTIONS equals the switch cases, with no duplicates', () => {
    const list = listEntries();
    expect(new Set(list).size).toBe(list.length);
    expect([...list].sort()).toEqual([...new Set(switchCases())].sort());
  });
});
