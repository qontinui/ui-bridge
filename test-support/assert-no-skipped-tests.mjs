#!/usr/bin/env node
/**
 * Fail a smoke run that SKIPPED anything, when UI_BRIDGE_REQUIRE_CHROMIUM=1.
 *
 * Usage: node assert-no-skipped-tests.mjs <vitest JSON report>
 *
 * Each package's `test:smoke` writes a vitest JSON report and then runs this.
 * chromium-gate.mjs makes a missing Chromium fail loudly, but a smoke that
 * skips on some OTHER condition would still pass silently. This closes that:
 * under the flag (which only ci.yml's browser-smokes job sets), any skipped,
 * pending or todo test -- or a run that executed none -- fails the step, naming
 * each test. Without the flag it only reports, so a local `npm run test:smoke`
 * on a box without Chromium still passes by skipping.
 */
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: assert-no-skipped-tests.mjs <vitest JSON report>');
  process.exit(2);
}
const report = JSON.parse(readFileSync(file, 'utf8'));
const results = (report.testResults ?? []).flatMap((f) =>
  (f.assertionResults ?? []).map((a) => ({
    file: f.name,
    title: a.fullName ?? a.title,
    status: a.status,
  }))
);
const ran = results.filter((r) => r.status === 'passed' || r.status === 'failed');
const skipped = results.filter((r) => r.status !== 'passed' && r.status !== 'failed');
const required = process.env.UI_BRIDGE_REQUIRE_CHROMIUM === '1';
console.log(`smoke run: ${ran.length} executed, ${skipped.length} skipped (${file})`);
for (const s of skipped) console.log(`  skipped [${s.status}]: ${s.title} (${s.file})`);
if (required && (skipped.length > 0 || ran.length === 0)) {
  console.error(
    `UI_BRIDGE_REQUIRE_CHROMIUM=1: this smoke run must execute every test and skip none ` +
      `(${ran.length} executed, ${skipped.length} skipped).`
  );
  process.exit(1);
}
