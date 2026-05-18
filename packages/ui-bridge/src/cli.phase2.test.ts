/**
 * Phase 2 — `explain` CLI.
 *
 * Plan: 2026-05-18-ui-bridge-diagnostic-discipline-plan.md §8 (Phase 2).
 *
 * `runCli` is the testable core of the `npx @qontinui/ui-bridge explain
 * <CODE>` binary. These tests assert: plain-text + `--json` output for a
 * known code, unknown-code non-zero exit with a category list (not the full
 * catalog dump), and that the catalog the CLI reads is the same single
 * source as the generated diagnostics module.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runCli } from './cli';
import { UI_BRIDGE_ERROR_CODES, DIAGNOSTICS } from './diagnostics';

let out = '';
let err = '';

beforeEach(() => {
  out = '';
  err = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((s: unknown) => {
    out += String(s);
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((s: unknown) => {
    err += String(s);
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Phase 2 — explain CLI', () => {
  it('explain <CODE> prints a plain-text catalog entry and exits 0', () => {
    const code = runCli(['explain', 'UB-ELEM-NOT-FOUND']);
    expect(code).toBe(0);
    expect(out).toContain('UB-ELEM-NOT-FOUND');
    expect(out).toContain('Category: element');
    expect(out).toContain(DIAGNOSTICS['UB-ELEM-NOT-FOUND'].description);
    expect(out).toContain('Common causes:');
    expect(out).toContain('Recovery template:');
    expect(err).toBe('');
  });

  it('explain <CODE> --json prints the raw codes.json entry and exits 0', () => {
    const code = runCli(['explain', 'UB-ELEM-NOT-FOUND', '--json']);
    expect(code).toBe(0);
    const parsed = JSON.parse(out);
    expect(parsed.code).toBe('UB-ELEM-NOT-FOUND');
    expect(parsed.category).toBe('element');
    expect(parsed.description).toBe(
      DIAGNOSTICS['UB-ELEM-NOT-FOUND'].description
    );
    expect(parsed.commonCauses).toEqual(
      DIAGNOSTICS['UB-ELEM-NOT-FOUND'].commonCauses
    );
    expect(parsed.recoveryTemplate).toEqual(
      DIAGNOSTICS['UB-ELEM-NOT-FOUND'].recoveryTemplate
    );
  });

  it('every catalog code is explainable', () => {
    for (const c of UI_BRIDGE_ERROR_CODES) {
      out = '';
      err = '';
      expect(runCli(['explain', c]), `${c} should explain`).toBe(0);
      expect(out).toContain(c);
    }
  });

  it('unknown code exits non-zero with a category list, not the full dump', () => {
    const code = runCli(['explain', 'UB-DOES-NOT-EXIST']);
    expect(code).toBe(1);
    expect(err).toContain('Unknown diagnostic code: UB-DOES-NOT-EXIST');
    expect(err).toContain('Valid categories:');
    expect(err).toContain('element');
    expect(err).toContain('system');
    // Must NOT dump all 41 codes.
    const dumped = UI_BRIDGE_ERROR_CODES.filter((c) => err.includes(c));
    expect(dumped.length).toBe(0);
    expect(out).toBe('');
  });

  it('missing <CODE> exits non-zero with usage', () => {
    const code = runCli(['explain']);
    expect(code).toBe(1);
    expect(err).toContain('missing <CODE>');
    expect(err).toContain('Usage:');
  });

  it('unknown command exits non-zero', () => {
    const code = runCli(['frobnicate']);
    expect(code).toBe(1);
    expect(err).toContain('Unknown command: frobnicate');
  });

  it('--help exits 0 with usage', () => {
    const code = runCli(['--help']);
    expect(code).toBe(0);
    expect(out).toContain('Usage:');
  });
});
