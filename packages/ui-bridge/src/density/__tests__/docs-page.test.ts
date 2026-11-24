// @vitest-environment node
/**
 * The density docs page (`docs-site/docs/api/density.md`) and the headless
 * README are the reader's copy of the registry and the command. A quantity
 * added to `DENSITY_QUANTITIES` without a row on the page, a row naming a
 * quantity the registry does not have, a row whose unit, scope or definition
 * drifted from the registry, and a verb that one of the two documents does not
 * show all fail here.
 *
 * Plan: 2026-11-23-ui-bridge-measures-information-density-as-reach-per-role-and-plans-the-change (Phase 9).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DENSITY_QUANTITIES } from '../quantities';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');
const PAGE = readFileSync(join(REPO_ROOT, 'docs-site', 'docs', 'api', 'density.md'), 'utf8');
const README = readFileSync(join(REPO_ROOT, 'packages', 'ui-bridge-headless', 'README.md'), 'utf8');

/** The body of the `## <heading>` section, up to the next `## ` heading. */
function section(markdown: string, heading: string): string {
  const lines = markdown.split(/\r?\n/);
  const start = lines.indexOf(`## ${heading}`);
  if (start < 0) throw new Error(`no "## ${heading}" section`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith('## '));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n');
}

interface Row {
  id: string;
  unit: string;
  scope: string;
  definition: string;
  notes: string;
}

/** The rows of the Quantities table: `| \`id\` | unit | scope | definition | notes |`. */
function quantityRows(): Row[] {
  return section(PAGE, 'Quantities')
    .split('\n')
    .filter((l) => l.startsWith('| `'))
    .map((l) => {
      const cells = l.split('|').map((c) => c.trim());
      // ['', '`id`', unit, scope, definition, notes, '']
      return {
        id: cells[1].replace(/^`|`$/g, ''),
        unit: cells[2],
        scope: cells[3],
        definition: cells[4],
        notes: cells[5],
      };
    });
}

/** The Notes cell the page gives a quantity: whether it compacts, and the bound `--draft` writes. */
function notesOf(q: (typeof DENSITY_QUANTITIES)[number]): string {
  return [q.compaction ? 'compaction' : null, q.draft ? `drafted as ${q.draft}` : null]
    .filter((n) => n !== null)
    .join(', ');
}

describe('the density docs page', () => {
  it('names every quantity in DENSITY_QUANTITIES', () => {
    const listed = new Set(quantityRows().map((r) => r.id));
    const missing = DENSITY_QUANTITIES.map((q) => q.id).filter((id) => !listed.has(id));
    expect(missing).toEqual([]);
  });

  it('lists each quantity once, and none the registry does not have', () => {
    const ids = quantityRows().map((r) => r.id);
    const known = new Set(DENSITY_QUANTITIES.map((q) => q.id));
    expect(ids.filter((id) => !known.has(id))).toEqual([]);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
    expect(ids.length).toBe(DENSITY_QUANTITIES.length);
  });

  it("gives each quantity the registry's unit, scope, definition and notes", () => {
    const byId = new Map(quantityRows().map((r) => [r.id, r]));
    const drifted = DENSITY_QUANTITIES.filter((q) => {
      const row = byId.get(q.id);
      return (
        row !== undefined &&
        (row.unit !== q.unit ||
          row.scope !== q.scope ||
          row.definition !== q.definition ||
          row.notes !== notesOf(q))
      );
    }).map((q) => q.id);
    expect(drifted).toEqual([]);
  });

  it('shows every verb, in the page and in the headless README', () => {
    const verbs = ['init', 'lint', 'fit', 'measure', 'plan', 'assert', 'diff'];
    const shown = (doc: string) =>
      verbs.filter((v) => new RegExp(`^ui-bridge-density +${v} `, 'm').test(doc));
    expect(shown(section(PAGE, 'The verbs'))).toEqual(verbs);
    expect(shown(section(README, '`ui-bridge-density`'))).toEqual(verbs);
  });

  it('names the exit codes the command returns', () => {
    const exits = section(PAGE, 'Exit codes');
    for (const code of ['`0`', '`1`', '`2`', '`3`', '`129`', '`130`', '`143`']) {
      expect(exits).toContain(code);
    }
  });
});
