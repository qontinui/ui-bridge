// The structural check behind the redaction-surface ratchet's fifth set,
// `additiveGuardScopes` (scripts/check-redaction-surface.cjs).
//
// An ADDITIVE guard block may name packages/ui-bridge/src/ paths outside the
// three §4.6 sentinel lists only because it can exempt nothing from §4.6: it
// adds rules and never touches `no-restricted-syntax` (which would REPLACE the
// package-wide selectors for its files — flat config does not merge one rule
// across blocks), and it is never an ignores-only object (which flat config
// reads as a GLOBAL ignore). Those properties are checked here on the parsed
// config, not on its text, so a key placed above the sentinel, a computed key
// or a spread cannot slip past. Anything the checker does not recognise is a
// problem: it fails closed.
//
// Plan 2026-11-23-ui-bridge-measures-information-density-as-reach-per-role-and-plans-the-change, Phase 1.

'use strict';

const ts = require('typescript');

const START = 'redaction-surface:additive-guard-scopes:start';
const END = 'redaction-surface:additive-guard-scopes:end';
const SRC_PREFIX = 'packages/ui-bridge/src/';
/** The rules an additive block may set. `no-restricted-syntax` is never one. */
const ALLOWED_RULES = new Set(['no-restricted-globals', 'no-restricted-imports']);
const ALLOWED_KEYS = new Set(['files', 'ignores', 'rules']);

function keyName(prop) {
  if (!prop.name) return null;
  if (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) return prop.name.text;
  return null; // computed, numeric, private: not a key this checker understands
}

function srcStringArray(node, what, problems) {
  if (!node || !ts.isArrayLiteralExpression(node)) {
    problems.push(`${what} must be an array literal`);
    return;
  }
  if (node.elements.length === 0) problems.push(`${what} must not be empty`);
  for (const el of node.elements) {
    if (!ts.isStringLiteral(el)) {
      problems.push(`${what} may hold only string literals (found ${ts.SyntaxKind[el.kind]})`);
    } else if (!el.text.startsWith(SRC_PREFIX)) {
      problems.push(`${what} entry ${JSON.stringify(el.text)} is not a '${SRC_PREFIX}...' path`);
    }
  }
}

/**
 * Every reason the additive guard block in `source` (the text of
 * eslint.config.js) is not provably additive. `[]` means it is.
 */
function additiveGuardBlockProblems(source) {
  const start = source.indexOf(START);
  const end = source.indexOf(END);
  if (start === -1 || end === -1 || end < start) {
    return [`the ${START} / ${END} sentinels are missing or out of order`];
  }
  if (source.indexOf(START, start + 1) !== -1 || source.indexOf(END, end + 1) !== -1) {
    return ['the additive-guard-scopes sentinels appear more than once'];
  }

  const sf = ts.createSourceFile(
    'eslint.config.js',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  );
  // The innermost object literal whose span holds both sentinels is the block.
  let block = null;
  const visit = (node) => {
    if (node.getStart(sf) <= start && node.getEnd() >= end) {
      if (ts.isObjectLiteralExpression(node)) block = node;
      ts.forEachChild(node, visit);
    }
  };
  visit(sf);
  if (!block) return ['the additive-guard-scopes sentinels do not sit inside a config object'];

  const problems = [];
  const seen = new Map();
  for (const prop of block.properties) {
    if (!ts.isPropertyAssignment(prop)) {
      problems.push(
        `the block may hold only plain \`key: value\` entries (found ${ts.SyntaxKind[prop.kind]})`
      );
      continue;
    }
    const key = keyName(prop);
    if (key === null) {
      problems.push('the block has a computed key, which the checker cannot read');
      continue;
    }
    if (!ALLOWED_KEYS.has(key)) {
      problems.push(`the block key \`${key}\` is not one of files, ignores, rules`);
      continue;
    }
    if (seen.has(key)) {
      // Last key wins in an object literal, so a second `rules` could hide the
      // one this check reads (or the other way round): refuse the ambiguity.
      problems.push(`the block key \`${key}\` appears more than once`);
      continue;
    }
    seen.set(key, prop.initializer);
  }
  if (!seen.has('files')) {
    problems.push('the block has no `files`: an object with only `ignores` is a GLOBAL ignore');
  }
  if (!seen.has('rules')) problems.push('the block has no `rules`: it guards nothing');
  if (seen.has('files')) srcStringArray(seen.get('files'), '`files`', problems);
  if (seen.has('ignores')) srcStringArray(seen.get('ignores'), '`ignores`', problems);

  const rules = seen.get('rules');
  if (rules) {
    if (!ts.isObjectLiteralExpression(rules)) {
      problems.push('`rules` must be an object literal');
    } else {
      for (const r of rules.properties) {
        if (!ts.isPropertyAssignment(r)) {
          problems.push(`\`rules\` may hold only plain entries (found ${ts.SyntaxKind[r.kind]})`);
          continue;
        }
        const name = keyName(r);
        if (name === null) {
          problems.push('`rules` has a computed key, which the checker cannot read');
        } else if (!ALLOWED_RULES.has(name)) {
          problems.push(
            `\`rules\` sets \`${name}\`; an additive block may set only ${[...ALLOWED_RULES].join(', ')}`
          );
        }
      }
    }
  }
  return problems;
}

module.exports = { additiveGuardBlockProblems, ALLOWED_RULES };
