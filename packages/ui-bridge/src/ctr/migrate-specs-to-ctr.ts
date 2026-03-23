/**
 * Migration utility: .spec.uibridge.json → .ctr.uibridge.json
 *
 * Scans existing spec files, extracts elementId and search targets, and generates
 * CTR entries so that specs can migrate to logical-name-based targeting.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  SpecConfig,
  SpecTarget,
  SpecAssertion,
  SpecGroup,
  AssertionCondition,
  SetupAction,
} from '../specs/types';
import type { SearchCriteria } from '../ai/types';
import type { CtrConfig, CtrEntry } from './types';
import { CTR_CONFIG_VERSION, DEFAULT_SELECTOR_CONFIDENCE } from './types';

// =============================================================================
// Result type
// =============================================================================

export interface MigrationResult {
  /** Generated CTR config. */
  ctrConfig: CtrConfig;
  /** Number of unique targets found (elementId + search). */
  totalTargets: number;
  /** Number of CTR entries created (deduplicated). */
  entriesCreated: number;
  /** Spec file paths that were scanned. */
  scannedFiles: string[];
}

// =============================================================================
// Internal helpers
// =============================================================================

/**
 * Slugify a string: lowercase, spaces/underscores→hyphens, strip non-alphanumeric (except hyphens/dots).
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9\-\.]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Derive a deterministic logical name from a search target.
 * Priority:
 *   1. label (slugified)
 *   2. {role}.{text|textContent|accessibleName|textContains}
 *   3. selector as-is
 *   4. fallback "search-{index}" (should not happen in practice)
 */
export function logicalNameFromSearch(
  criteria: SearchCriteria,
  label?: string
): string {
  if (label) {
    return slugify(label);
  }

  const role = criteria.role;
  const textPart =
    criteria.text ??
    criteria.textContent ??
    criteria.accessibleName ??
    criteria.textContains;

  if (role && textPart) {
    return `${slugify(role)}.${slugify(textPart)}`;
  }
  if (role) {
    return slugify(role);
  }
  if (textPart) {
    return slugify(textPart);
  }
  if (criteria.selector) {
    return slugify(criteria.selector);
  }

  // Fallback: serialize criteria keys
  const keys = Object.keys(criteria).sort().join('-');
  return slugify(`search-${keys}`) || 'search-unknown';
}

interface CollectedTarget {
  component?: string;
  description?: string;
  criteria?: SearchCriteria;
}

function collectTargets(
  targets: SpecTarget[],
  seen: Map<string, CollectedTarget>,
  component?: string,
  description?: string
): void {
  for (const target of targets) {
    if (!target) continue;
    if (target.type === 'elementId') {
      if (!seen.has(target.elementId)) {
        seen.set(target.elementId, { component, description });
      }
    } else if (target.type === 'search') {
      const name = logicalNameFromSearch(target.criteria, target.label);
      if (!seen.has(name)) {
        seen.set(name, { component, description, criteria: target.criteria });
      }
    }
  }
}

/**
 * Extract all SpecTarget nodes from an assertion (primary target, relatedTarget, condition targets).
 */
function extractTargetsFromAssertion(assertion: SpecAssertion): {
  targets: SpecTarget[];
  description: string;
} {
  const targets: SpecTarget[] = [];
  if (assertion.target) {
    targets.push(assertion.target);
  }

  if (assertion.relatedTarget) {
    targets.push(assertion.relatedTarget);
  }

  if (assertion.condition?.target) {
    targets.push(assertion.condition.target);
  }

  return { targets, description: assertion.description };
}

/**
 * Extract all SpecTarget nodes from setup actions.
 */
function extractTargetsFromSetupActions(actions: SetupAction[]): SpecTarget[] {
  const targets: SpecTarget[] = [];
  for (const action of actions) {
    if ('target' in action && action.target) {
      targets.push(action.target);
    }
  }
  return targets;
}

function buildCtrEntryFromElementId(
  elementId: string,
  meta: { component?: string; description?: string }
): CtrEntry {
  return {
    logicalName: elementId,
    selectors: [
      {
        strategy: 'data-testid',
        value: elementId,
        priority: 0,
        confidence: DEFAULT_SELECTOR_CONFIDENCE,
      },
      {
        strategy: 'id',
        value: elementId,
        priority: 1,
        confidence: DEFAULT_SELECTOR_CONFIDENCE,
      },
    ],
    metadata: {
      component: meta.component,
      description: meta.description,
    },
    version: 1,
  };
}

function buildCtrEntryFromSearch(
  logicalName: string,
  criteria: SearchCriteria,
  meta: { component?: string; description?: string }
): CtrEntry {
  return {
    logicalName,
    selectors: [
      {
        strategy: 'search',
        value: criteria,
        priority: 0,
        confidence: DEFAULT_SELECTOR_CONFIDENCE,
      },
    ],
    metadata: {
      component: meta.component,
      description: meta.description,
    },
    version: 1,
  };
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Scan a SpecConfig and extract elementId and search targets into CTR entries.
 */
export function migrateSpecToCtr(specConfig: SpecConfig, _specId?: string): CtrConfig {
  const seen = new Map<string, CollectedTarget>();
  const component = specConfig.metadata?.component;

  // Walk groups → assertions
  for (const group of specConfig.groups ?? []) {
    for (const assertion of group.assertions) {
      const { targets, description } = extractTargetsFromAssertion(assertion);
      collectTargets(targets, seen, component, description);
    }

    // Setup actions
    if (group.setupActions) {
      const setupTargets = extractTargetsFromSetupActions(group.setupActions);
      collectTargets(setupTargets, seen, component, group.description);
    }
  }

  // Walk ungrouped assertions
  for (const assertion of specConfig.assertions ?? []) {
    const { targets, description } = extractTargetsFromAssertion(assertion);
    collectTargets(targets, seen, component, description);
  }

  const entries: CtrEntry[] = [];
  for (const [name, meta] of seen) {
    if (meta.criteria) {
      entries.push(buildCtrEntryFromSearch(name, meta.criteria, meta));
    } else {
      entries.push(buildCtrEntryFromElementId(name, meta));
    }
  }

  return {
    version: CTR_CONFIG_VERSION as '1.0.0',
    entries,
    metadata: {
      author: 'migrate-specs-to-ctr',
      description: `Auto-generated from spec${_specId ? ` ${_specId}` : ''}`,
    },
  };
}

/**
 * Scan a directory for .spec.uibridge.json files and generate a merged CTR config.
 */
export function migrateDirectoryToCtr(specDir: string): MigrationResult {
  const scannedFiles: string[] = [];
  const mergedEntries = new Map<string, CtrEntry>();

  // Read all files in the directory (non-recursive first, then recursive)
  const allFiles = walkDir(specDir);
  const specFiles = allFiles.filter((f) => f.endsWith('.spec.uibridge.json'));

  for (const filePath of specFiles) {
    scannedFiles.push(filePath);
    const raw = fs.readFileSync(filePath, 'utf-8');
    const specConfig: SpecConfig = JSON.parse(raw);
    const specId = path.basename(filePath, '.spec.uibridge.json');
    const ctrConfig = migrateSpecToCtr(specConfig, specId);

    for (const entry of ctrConfig.entries) {
      if (!mergedEntries.has(entry.logicalName)) {
        mergedEntries.set(entry.logicalName, entry);
      }
    }
  }

  const entries = Array.from(mergedEntries.values());

  return {
    ctrConfig: {
      version: CTR_CONFIG_VERSION as '1.0.0',
      entries,
      metadata: {
        author: 'migrate-specs-to-ctr',
        description: `Merged from ${scannedFiles.length} spec file(s)`,
      },
    },
    totalTargets: entries.length,
    entriesCreated: entries.length,
    scannedFiles,
  };
}

/**
 * Generate a transformed SpecConfig where elementId targets are replaced with ctr targets.
 */
export function rewriteSpecWithCtr(specConfig: SpecConfig): SpecConfig {
  const cloned: SpecConfig = JSON.parse(JSON.stringify(specConfig));

  function rewriteTarget(target: SpecTarget): SpecTarget {
    if (target.type === 'elementId') {
      return { type: 'ctr', logicalName: target.elementId, label: target.label };
    }
    if (target.type === 'search') {
      const logicalName = logicalNameFromSearch(target.criteria, target.label);
      return { type: 'ctr', logicalName, label: target.label };
    }
    return target;
  }

  function rewriteCondition(condition: AssertionCondition): AssertionCondition {
    return { ...condition, target: rewriteTarget(condition.target) } as AssertionCondition;
  }

  function rewriteAssertion(assertion: SpecAssertion): void {
    assertion.target = rewriteTarget(assertion.target);
    if (assertion.relatedTarget) {
      assertion.relatedTarget = rewriteTarget(assertion.relatedTarget);
    }
    if (assertion.condition) {
      assertion.condition = rewriteCondition(assertion.condition);
    }
  }

  function rewriteSetupAction(action: SetupAction): void {
    if ('target' in action && action.target) {
      (action as { target: SpecTarget }).target = rewriteTarget(action.target);
    }
  }

  for (const group of cloned.groups ?? []) {
    for (const assertion of group.assertions) {
      rewriteAssertion(assertion);
    }
    if (group.setupActions) {
      for (const action of group.setupActions) {
        rewriteSetupAction(action);
      }
    }
  }

  for (const assertion of cloned.assertions ?? []) {
    rewriteAssertion(assertion);
  }

  return cloned;
}

// =============================================================================
// Helpers
// =============================================================================

function walkDir(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

// =============================================================================
// CLI entry point
// =============================================================================

if (typeof process !== 'undefined' && process.argv[1]?.includes('migrate-specs-to-ctr')) {
  const specDir = process.argv[2];
  const outputFile = process.argv[3];

  if (!specDir) {
    console.error('Usage: npx tsx src/ctr/migrate-specs-to-ctr.ts <spec-dir> [output-file]');
    process.exit(1);
  }

  const resolvedDir = path.resolve(specDir);
  console.log(`Scanning ${resolvedDir} for .spec.uibridge.json files...`);

  const result = migrateDirectoryToCtr(resolvedDir);

  console.log(`Scanned ${result.scannedFiles.length} spec file(s)`);
  console.log(`Found ${result.totalTargets} unique target(s)`);
  console.log(`Created ${result.entriesCreated} CTR entr(ies)`);

  const json = JSON.stringify(result.ctrConfig, null, 2);

  if (outputFile) {
    const resolvedOutput = path.resolve(outputFile);
    fs.writeFileSync(resolvedOutput, json, 'utf-8');
    console.log(`Written to ${resolvedOutput}`);
  } else {
    console.log('\n--- Generated CTR Config ---');
    console.log(json);
  }
}
