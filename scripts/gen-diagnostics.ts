/**
 * Diagnostics mirror generator.
 *
 * Single source of truth: `diagnostics/codes.json`.
 * Emits TS / Rust / Python mirrors. Run via `npm run diagnostics:generate`;
 * `npm run diagnostics:check` re-runs this and fails CI on any non-empty diff
 * of the generated files.
 *
 * Type-only annotations are used so the file runs under Node's
 * `--experimental-strip-types` (Node >= 22) with no transpile step.
 *
 * Plan: D:/qontinui-root/plans/2026-05-18-ui-bridge-diagnostic-discipline-plan.md  Phase 0
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type Category = 'element' | 'action' | 'assertion' | 'network' | 'system';

interface RecoverySuggestion {
  suggestion: string;
  command?: string;
  confidence: number;
  retryable: boolean;
  priority?: number;
}

interface CodeEntry {
  code: string;
  category: Category;
  description: string;
  commonCauses: string[];
  recoveryTemplate: RecoverySuggestion[];
}

interface CodesFile {
  codes: CodeEntry[];
}

const HERE = dirname(fileURLToPath(import.meta.url));
const UIBRIDGE_ROOT = resolve(HERE, '..');
// The Rust mirror lives in the qontinui-schemas worktree, resolved relative to
// this worktree's sibling. Overridable via QONTINUI_SCHEMAS_RUST_DIR for CI /
// alternate checkouts.
const SCHEMAS_RUST_DIR =
  process.env.QONTINUI_SCHEMAS_RUST_DIR ??
  resolve(UIBRIDGE_ROOT, '..', 'tmp_wt_schemas_diag_w1', 'rust');

const CODES_JSON = join(UIBRIDGE_ROOT, 'diagnostics', 'codes.json');

const TS_OUT = join(
  UIBRIDGE_ROOT,
  'packages',
  'ui-bridge',
  'src',
  'diagnostics',
  'codes.generated.ts'
);
const RUST_OUT = join(SCHEMAS_RUST_DIR, 'src', 'ui_bridge_diagnostics.rs');
const PY_OUT = join(
  UIBRIDGE_ROOT,
  'packages',
  'ui-bridge-python',
  'ui_bridge',
  'diagnostics.py'
);
const MD_OUT = join(
  UIBRIDGE_ROOT,
  'packages',
  'ui-bridge',
  'docs',
  'diagnostics.md'
);

const HEADER_TS = '// @generated from diagnostics/codes.json — do not edit';
const HEADER_RS = '// @generated from diagnostics/codes.json — do not edit';
const HEADER_PY = '# @generated from diagnostics/codes.json — do not edit';

function load(): CodeEntry[] {
  const raw = JSON.parse(readFileSync(CODES_JSON, 'utf8')) as CodesFile;
  if (!Array.isArray(raw.codes) || raw.codes.length === 0) {
    throw new Error(`${CODES_JSON}: "codes" must be a non-empty array`);
  }
  const seen = new Set<string>();
  for (const e of raw.codes) {
    if (!/^UB-[A-Z0-9-]+$/.test(e.code)) {
      throw new Error(`Invalid code (must match /^UB-[A-Z0-9-]+$/): ${e.code}`);
    }
    if (seen.has(e.code)) throw new Error(`Duplicate code: ${e.code}`);
    seen.add(e.code);
  }
  // Stable order: by code, for deterministic output regardless of file order.
  return [...raw.codes].sort((a, b) => a.code.localeCompare(b.code));
}

// ---- naming helpers ---------------------------------------------------------

// UB-ELEM-NOT-FOUND -> ELEM_NOT_FOUND  (TS enum member / Python member)
function memberName(code: string): string {
  return code.replace(/^UB-/, '').replace(/-/g, '_');
}

// UB-ELEM-NOT-FOUND -> UbElemNotFound  (Rust variant)
function rustVariant(code: string): string {
  return code
    .split('-')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join('');
}

function jsonStr(s: string): string {
  return JSON.stringify(s);
}

function rustStr(s: string): string {
  return JSON.stringify(s);
}

// ---- TS emitter -------------------------------------------------------------

function emitTs(codes: CodeEntry[]): string {
  const lines: string[] = [];
  lines.push(HEADER_TS);
  lines.push('/* eslint-disable */');
  lines.push('');
  lines.push('/**');
  lines.push(' * Canonical UI Bridge diagnostic code vocabulary + recovery catalog.');
  lines.push(' * Generated from `diagnostics/codes.json`. See `scripts/gen-diagnostics.ts`.');
  lines.push(' */');
  lines.push('');
  lines.push('export type UiBridgeErrorCode =');
  codes.forEach((c, i) => {
    lines.push(`  | ${jsonStr(c.code)}${i === codes.length - 1 ? ';' : ''}`);
  });
  lines.push('');
  lines.push('/** All diagnostic codes, in stable sorted order. */');
  lines.push('export const UI_BRIDGE_ERROR_CODES: readonly UiBridgeErrorCode[] = [');
  codes.forEach((c) => lines.push(`  ${jsonStr(c.code)},`));
  lines.push('] as const;');
  lines.push('');
  lines.push("export type DiagnosticCategory =");
  lines.push("  | 'element'");
  lines.push("  | 'action'");
  lines.push("  | 'assertion'");
  lines.push("  | 'network'");
  lines.push("  | 'system';");
  lines.push('');
  lines.push('/**');
  lines.push(' * Canonical recovery suggestion shape (D6). One type across every');
  lines.push(' * failure surface: ActionFailureDetails, StructuredFailureInfo,');
  lines.push(' * ERROR_SUGGESTIONS, getRecoverySuggestions, codes.json.recoveryTemplate.');
  lines.push(' */');
  lines.push('export interface RecoverySuggestion {');
  lines.push('  /** Human-readable suggestion. */');
  lines.push('  suggestion: string;');
  lines.push('  /** Optional machine-executable command. */');
  lines.push('  command?: string;');
  lines.push('  /** Confidence this will help (0-1). */');
  lines.push('  confidence: number;');
  lines.push('  /** Whether retrying the original action may help. */');
  lines.push('  retryable: boolean;');
  lines.push('  /** Order hint (lower = try first). */');
  lines.push('  priority?: number;');
  lines.push('}');
  lines.push('');
  lines.push('export interface DiagnosticEntry {');
  lines.push('  description: string;');
  lines.push('  commonCauses: string[];');
  lines.push('  recoveryTemplate: RecoverySuggestion[];');
  lines.push('  category: DiagnosticCategory;');
  lines.push('}');
  lines.push('');
  lines.push(
    'export const DIAGNOSTICS: Record<UiBridgeErrorCode, DiagnosticEntry> = {'
  );
  for (const c of codes) {
    lines.push(`  ${jsonStr(c.code)}: {`);
    lines.push(`    description: ${jsonStr(c.description)},`);
    lines.push(`    commonCauses: [`);
    for (const cause of c.commonCauses) lines.push(`      ${jsonStr(cause)},`);
    lines.push(`    ],`);
    lines.push(`    recoveryTemplate: [`);
    for (const r of c.recoveryTemplate) {
      const parts: string[] = [`suggestion: ${jsonStr(r.suggestion)}`];
      if (r.command !== undefined) parts.push(`command: ${jsonStr(r.command)}`);
      parts.push(`confidence: ${r.confidence}`);
      parts.push(`retryable: ${r.retryable}`);
      if (r.priority !== undefined) parts.push(`priority: ${r.priority}`);
      lines.push(`      { ${parts.join(', ')} },`);
    }
    lines.push(`    ],`);
    lines.push(`    category: ${jsonStr(c.category)},`);
    lines.push(`  },`);
  }
  lines.push('};');
  lines.push('');
  return lines.join('\n');
}

// ---- Rust emitter -----------------------------------------------------------

function emitRust(codes: CodeEntry[]): string {
  const lines: string[] = [];
  lines.push(HEADER_RS);
  lines.push('//!');
  lines.push('//! Canonical UI Bridge diagnostic code vocabulary.');
  lines.push('//!');
  lines.push('//! Source of truth: `ui-bridge/diagnostics/codes.json`. Regenerated by');
  lines.push('//! `ui-bridge/scripts/gen-diagnostics.ts`. `FromStr` / `From<&str>` match');
  lines.push('//! the canonical `UB-` strings ONLY — there is intentionally no');
  lines.push('//! legacy-bare-string arm (single-user coordinated cutover, plan D1).');
  lines.push('//!');
  lines.push('//! Generated artifact: layout is owned by the generator, not `cargo fmt`.');
  lines.push('//! Each item carries `#[rustfmt::skip]` (stable; file-level `#![rustfmt::skip]`');
  lines.push('//! is nightly-only) so regen stays byte-stable and decoupled from rustfmt');
  lines.push('//! line-width drift across toolchain versions.');
  lines.push('#![allow(clippy::all)]');
  lines.push('');
  lines.push('use std::fmt;');
  lines.push('use std::str::FromStr;');
  lines.push('');
  lines.push('#[rustfmt::skip]');
  lines.push('#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]');
  lines.push('pub enum UiBridgeErrorCode {');
  for (const c of codes) {
    lines.push(`    /// \`${c.code}\``);
    lines.push(`    ${rustVariant(c.code)},`);
  }
  lines.push('}');
  lines.push('');
  lines.push('#[rustfmt::skip]');
  lines.push('impl UiBridgeErrorCode {');
  lines.push('    /// The canonical `UB-` wire string for this code.');
  lines.push('    pub fn as_str(&self) -> &\'static str {');
  lines.push('        match self {');
  for (const c of codes) {
    lines.push(
      `            UiBridgeErrorCode::${rustVariant(c.code)} => ${rustStr(c.code)},`
    );
  }
  lines.push('        }');
  lines.push('    }');
  lines.push('');
  lines.push('    /// Every code, in stable sorted order.');
  lines.push('    pub fn all() -> &\'static [UiBridgeErrorCode] {');
  lines.push('        &[');
  for (const c of codes) {
    lines.push(`            UiBridgeErrorCode::${rustVariant(c.code)},`);
  }
  lines.push('        ]');
  lines.push('    }');
  lines.push('}');
  lines.push('');
  lines.push('impl fmt::Display for UiBridgeErrorCode {');
  lines.push('    fn fmt(&self, f: &mut fmt::Formatter<\'_>) -> fmt::Result {');
  lines.push('        f.write_str(self.as_str())');
  lines.push('    }');
  lines.push('}');
  lines.push('');
  lines.push('/// Returned when a string is not a recognized canonical `UB-` code.');
  lines.push('#[derive(Debug, Clone, PartialEq, Eq)]');
  lines.push('pub struct ParseUiBridgeErrorCodeError(pub String);');
  lines.push('');
  lines.push('impl fmt::Display for ParseUiBridgeErrorCodeError {');
  lines.push('    fn fmt(&self, f: &mut fmt::Formatter<\'_>) -> fmt::Result {');
  lines.push(
    '        write!(f, "unrecognized UI Bridge diagnostic code: {}", self.0)'
  );
  lines.push('    }');
  lines.push('}');
  lines.push('');
  lines.push('impl std::error::Error for ParseUiBridgeErrorCodeError {}');
  lines.push('');
  lines.push('#[rustfmt::skip]');
  lines.push('impl FromStr for UiBridgeErrorCode {');
  lines.push('    type Err = ParseUiBridgeErrorCodeError;');
  lines.push('    fn from_str(s: &str) -> Result<Self, Self::Err> {');
  lines.push('        match s {');
  for (const c of codes) {
    lines.push(
      `            ${rustStr(c.code)} => Ok(UiBridgeErrorCode::${rustVariant(c.code)}),`
    );
  }
  lines.push(
    '            other => Err(ParseUiBridgeErrorCodeError(other.to_string())),'
  );
  lines.push('        }');
  lines.push('    }');
  lines.push('}');
  lines.push('');
  lines.push("impl<'a> TryFrom<&'a str> for UiBridgeErrorCode {");
  lines.push('    type Error = ParseUiBridgeErrorCodeError;');
  lines.push("    fn try_from(s: &'a str) -> Result<Self, Self::Error> {");
  lines.push('        s.parse()');
  lines.push('    }');
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

// ---- Python emitter ---------------------------------------------------------

function emitPython(codes: CodeEntry[]): string {
  const lines: string[] = [];
  lines.push(HEADER_PY);
  lines.push('"""Canonical UI Bridge diagnostic code vocabulary + recovery catalog.');
  lines.push('');
  lines.push('Source of truth: ``ui-bridge/diagnostics/codes.json``. Regenerated by');
  lines.push('``ui-bridge/scripts/gen-diagnostics.ts``. Do not edit by hand.');
  lines.push('"""');
  lines.push('');
  lines.push('from __future__ import annotations');
  lines.push('');
  lines.push('from enum import Enum');
  lines.push('from typing import Any');
  lines.push('');
  lines.push('');
  lines.push('class UiBridgeErrorCode(str, Enum):');
  lines.push('    """Every canonical ``UB-`` diagnostic code."""');
  lines.push('');
  for (const c of codes) {
    lines.push(`    ${memberName(c.code)} = ${jsonStr(c.code)}`);
  }
  lines.push('');
  lines.push('');
  lines.push('UI_BRIDGE_ERROR_CODES: tuple[str, ...] = (');
  for (const c of codes) lines.push(`    ${jsonStr(c.code)},`);
  lines.push(')');
  lines.push('');
  lines.push('');
  lines.push('# code -> {description, commonCauses, recoveryTemplate, category}');
  lines.push('DIAGNOSTICS: dict[str, dict[str, Any]] = {');
  for (const c of codes) {
    lines.push(`    ${jsonStr(c.code)}: {`);
    lines.push(`        "description": ${jsonStr(c.description)},`);
    lines.push(`        "commonCauses": [`);
    for (const cause of c.commonCauses) lines.push(`            ${jsonStr(cause)},`);
    lines.push(`        ],`);
    lines.push(`        "recoveryTemplate": [`);
    for (const r of c.recoveryTemplate) {
      const parts: string[] = [`"suggestion": ${jsonStr(r.suggestion)}`];
      if (r.command !== undefined) parts.push(`"command": ${jsonStr(r.command)}`);
      parts.push(`"confidence": ${r.confidence}`);
      parts.push(`"retryable": ${r.retryable ? 'True' : 'False'}`);
      if (r.priority !== undefined) parts.push(`"priority": ${r.priority}`);
      lines.push(`            {${parts.join(', ')}},`);
    }
    lines.push(`        ],`);
    lines.push(`        "category": ${jsonStr(c.category)},`);
    lines.push(`    },`);
  }
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

// ---- Markdown emitter -------------------------------------------------------

const CATEGORY_TITLES: Record<Category, string> = {
  element: 'Element',
  action: 'Action',
  assertion: 'Assertion',
  network: 'Network',
  system: 'System',
};

function mdRecovery(r: RecoverySuggestion): string {
  // One readable bullet per recovery suggestion, rendering every field.
  const bits: string[] = [`**${r.suggestion}**`];
  if (r.command !== undefined) bits.push(`command: \`${r.command}\``);
  bits.push(`confidence: ${r.confidence}`);
  bits.push(`retryable: ${r.retryable ? 'yes' : 'no'}`);
  if (r.priority !== undefined) bits.push(`priority: ${r.priority}`);
  // First element is the bold suggestion; the rest is a parenthetical meta line.
  return `${bits[0]} — ${bits.slice(1).join(', ')}`;
}

function emitMarkdown(codes: CodeEntry[]): string {
  const lines: string[] = [];
  lines.push('<!-- @generated from diagnostics/codes.json — do not edit. -->');
  lines.push(
    '<!-- Regenerate with `npm run diagnostics:generate`; CI drift-guards via `npm run diagnostics:check`. -->'
  );
  lines.push('');
  lines.push('# UI Bridge Diagnostic Catalog');
  lines.push('');
  lines.push(
    'Every machine-facing UI Bridge failure surface emits a stable `UB-` diagnostic code.'
  );
  lines.push(
    'This catalog is the human-readable companion to the generated code enum'
  );
  lines.push(
    '(`@qontinui/ui-bridge/diagnostics`), the `npx @qontinui/ui-bridge explain <CODE>`'
  );
  lines.push(
    'CLI, and the `GET /diagnostics/:code` proxy endpoint — all four are generated'
  );
  lines.push('from the single source of truth `diagnostics/codes.json`.');
  lines.push('');
  lines.push(`There are **${codes.length}** diagnostic codes.`);
  lines.push('');

  // Index grouped by category.
  const byCategory = new Map<Category, CodeEntry[]>();
  for (const c of codes) {
    const arr = byCategory.get(c.category) ?? [];
    arr.push(c);
    byCategory.set(c.category, arr);
  }
  const orderedCategories: Category[] = [
    'element',
    'action',
    'assertion',
    'network',
    'system',
  ];

  lines.push('## Index');
  lines.push('');
  for (const cat of orderedCategories) {
    const entries = byCategory.get(cat);
    if (!entries || entries.length === 0) continue;
    lines.push(`### ${CATEGORY_TITLES[cat]}`);
    lines.push('');
    for (const c of entries) {
      lines.push(`- [\`${c.code}\`](#${anchor(c.code)}) — ${c.description}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');

  // One section per code (stable sorted order — `codes` is pre-sorted).
  for (const c of codes) {
    const seeAlso = codes
      .filter((o) => o.category === c.category && o.code !== c.code)
      .map((o) => o.code);

    lines.push(`## ${c.code}`);
    lines.push('');
    lines.push(`**Category:** \`${c.category}\``);
    lines.push('');
    lines.push(c.description);
    lines.push('');
    lines.push('### Common causes');
    lines.push('');
    for (const cause of c.commonCauses) lines.push(`- ${cause}`);
    lines.push('');
    lines.push('### Default recovery template');
    lines.push('');
    if (c.recoveryTemplate.length === 0) {
      lines.push('_No recovery template._');
    } else {
      for (const r of c.recoveryTemplate) lines.push(`- ${mdRecovery(r)}`);
    }
    lines.push('');
    lines.push('### See also');
    lines.push('');
    if (seeAlso.length === 0) {
      lines.push(`_No other codes in the \`${c.category}\` category._`);
    } else {
      lines.push(
        seeAlso.map((code) => `[\`${code}\`](#${anchor(code)})`).join(', ')
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

// GitHub-flavored markdown heading anchor: lowercase, non-word -> '-'.
function anchor(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ---- main -------------------------------------------------------------------

function writeOut(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  // Normalize to LF + single trailing newline for deterministic diffs.
  const normalized = content.replace(/\r\n/g, '\n').replace(/\n*$/, '\n');
  writeFileSync(path, normalized, 'utf8');
}

function main(): void {
  const codes = load();
  writeOut(TS_OUT, emitTs(codes));
  writeOut(PY_OUT, emitPython(codes));
  writeOut(MD_OUT, emitMarkdown(codes));

  // The Rust mirror lives in the qontinui-schemas worktree. It may be absent
  // (e.g. ui-bridge CI checks out only this repo) — only emit when the target
  // crate's src/ exists, so we never create stray sibling dirs. The schemas
  // repo's own CI drift-checks the Rust mirror.
  const rustSrcDir = dirname(RUST_OUT);
  const rustEmitted = existsSync(rustSrcDir);
  if (rustEmitted) {
    writeOut(RUST_OUT, emitRust(codes));
  }

   
  console.log(
    `gen-diagnostics: wrote ${codes.length} codes ->\n  ${TS_OUT}\n  ${PY_OUT}\n  ${MD_OUT}` +
      (rustEmitted ? `\n  ${RUST_OUT}` : `\n  (skipped Rust mirror: ${rustSrcDir} absent)`)
  );
}

main();
