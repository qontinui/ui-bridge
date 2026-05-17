#!/usr/bin/env node
// Pre-publish defense-in-depth: refuse to publish from a dirty working tree.
//
// Closes the 0.4.0-shape footgun (npm publish from unstaged source) even if
// the registry-side trusted-publishing policy isn't enforced. Acts as a
// tripwire for local `npm publish` attempts; canonical publishes happen via
// publish.yml on tag push and run in a fresh CI checkout where the tree is
// clean by construction.
//
// Plan: D:/qontinui-root/plans/2026-05-17-publish-discipline-migration.md §1.4

'use strict';

const { execSync } = require('node:child_process');

try {
  const status = execSync('git status --porcelain', { encoding: 'utf8' });
  if (status.trim() !== '') {
    console.error('');
    console.error('ERROR: working tree has uncommitted changes. Refusing to publish.');
    console.error('');
    console.error('All @qontinui/* packages publish via OIDC trusted-publishing');
    console.error('triggered by tag push (.github/workflows/publish.yml). Local');
    console.error('`npm publish` is not a sanctioned path. If you reached this');
    console.error('from a deliberate release workflow, commit your changes and');
    console.error('push the matching tag instead.');
    console.error('');
    console.error('Uncommitted files:');
    console.error(status);
    process.exit(1);
  }
} catch (e) {
  console.error('ERROR: failed to verify clean tree:', e.message);
  console.error('(If you are publishing from CI, this script should not be invoked;');
  console.error(' publish.yml runs `npm publish` directly without `prepublishOnly`');
  console.error(' triggering in the publish step. Investigate.)');
  process.exit(1);
}
