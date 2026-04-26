'use strict';

var fs = require('fs');
var path = require('path');

function _interopNamespace(e) {
  if (e && e.__esModule) return e;
  var n = Object.create(null);
  if (e) {
    Object.keys(e).forEach(function (k) {
      if (k !== 'default') {
        var d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: function () { return e[k]; }
        });
      }
    });
  }
  n.default = e;
  return Object.freeze(n);
}

var fs__namespace = /*#__PURE__*/_interopNamespace(fs);
var path__namespace = /*#__PURE__*/_interopNamespace(path);

// src/ctr/migrate-specs-to-ctr.ts

// src/ctr/types.ts
var CTR_CONFIG_VERSION = "1.0.0";
var DEFAULT_SELECTOR_CONFIDENCE = 0.8;

// src/ctr/migrate-specs-to-ctr.ts
function slugify(input) {
  return input.toLowerCase().replace(/[\s_]+/g, "-").replace(/[^a-z0-9\-.]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
}
function logicalNameFromSearch(criteria, label) {
  if (label) {
    return slugify(label);
  }
  const role = criteria.role;
  const textPart = criteria.text ?? criteria.textContent ?? criteria.accessibleName ?? criteria.textContains;
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
  const keys = Object.keys(criteria).sort().join("-");
  return slugify(`search-${keys}`) || "search-unknown";
}
function collectTargets(targets, seen, component, description) {
  for (const target of targets) {
    if (!target) continue;
    if (target.type === "elementId") {
      if (!seen.has(target.elementId)) {
        seen.set(target.elementId, { component, description });
      }
    } else if (target.type === "search") {
      const name = logicalNameFromSearch(target.criteria, target.label);
      if (!seen.has(name)) {
        seen.set(name, { component, description, criteria: target.criteria });
      }
    }
  }
}
function extractTargetsFromAssertion(assertion) {
  const targets = [];
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
function extractTargetsFromSetupActions(actions) {
  const targets = [];
  for (const action of actions) {
    if ("target" in action && action.target) {
      targets.push(action.target);
    }
  }
  return targets;
}
function buildCtrEntryFromElementId(elementId, meta) {
  return {
    logicalName: elementId,
    selectors: [
      {
        strategy: "data-testid",
        value: elementId,
        priority: 0,
        confidence: DEFAULT_SELECTOR_CONFIDENCE
      },
      {
        strategy: "id",
        value: elementId,
        priority: 1,
        confidence: DEFAULT_SELECTOR_CONFIDENCE
      }
    ],
    metadata: {
      component: meta.component,
      description: meta.description
    },
    version: 1
  };
}
function buildCtrEntryFromSearch(logicalName, criteria, meta) {
  return {
    logicalName,
    selectors: [
      {
        strategy: "search",
        value: criteria,
        priority: 0,
        confidence: DEFAULT_SELECTOR_CONFIDENCE
      }
    ],
    metadata: {
      component: meta.component,
      description: meta.description
    },
    version: 1
  };
}
function migrateSpecToCtr(specConfig, _specId) {
  const seen = /* @__PURE__ */ new Map();
  const component = specConfig.metadata?.component;
  for (const group of specConfig.groups ?? []) {
    for (const assertion of group.assertions) {
      const { targets, description } = extractTargetsFromAssertion(assertion);
      collectTargets(targets, seen, component, description);
    }
    if (group.setupActions) {
      const setupTargets = extractTargetsFromSetupActions(group.setupActions);
      collectTargets(setupTargets, seen, component, group.description);
    }
  }
  for (const assertion of specConfig.assertions ?? []) {
    const { targets, description } = extractTargetsFromAssertion(assertion);
    collectTargets(targets, seen, component, description);
  }
  const entries = [];
  for (const [name, meta] of seen) {
    if (meta.criteria) {
      entries.push(buildCtrEntryFromSearch(name, meta.criteria, meta));
    } else {
      entries.push(buildCtrEntryFromElementId(name, meta));
    }
  }
  return {
    version: CTR_CONFIG_VERSION,
    entries,
    metadata: {
      author: "migrate-specs-to-ctr",
      description: `Auto-generated from spec${_specId ? ` ${_specId}` : ""}`
    }
  };
}
function migrateDirectoryToCtr(specDir) {
  const scannedFiles = [];
  const mergedEntries = /* @__PURE__ */ new Map();
  const allFiles = walkDir(specDir);
  const specFiles = allFiles.filter((f) => f.endsWith(".spec.uibridge.json"));
  for (const filePath of specFiles) {
    scannedFiles.push(filePath);
    const raw = fs__namespace.readFileSync(filePath, "utf-8");
    const specConfig = JSON.parse(raw);
    const specId = path__namespace.basename(filePath, ".spec.uibridge.json");
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
      version: CTR_CONFIG_VERSION,
      entries,
      metadata: {
        author: "migrate-specs-to-ctr",
        description: `Merged from ${scannedFiles.length} spec file(s)`
      }
    },
    totalTargets: entries.length,
    entriesCreated: entries.length,
    scannedFiles
  };
}
function rewriteSpecWithCtr(specConfig) {
  const cloned = JSON.parse(JSON.stringify(specConfig));
  function rewriteTarget(target) {
    if (target.type === "elementId") {
      return { type: "ctr", logicalName: target.elementId, label: target.label };
    }
    if (target.type === "search") {
      const logicalName = logicalNameFromSearch(target.criteria, target.label);
      return { type: "ctr", logicalName, label: target.label };
    }
    return target;
  }
  function rewriteCondition(condition) {
    return { ...condition, target: rewriteTarget(condition.target) };
  }
  function rewriteAssertion(assertion) {
    assertion.target = rewriteTarget(assertion.target);
    if (assertion.relatedTarget) {
      assertion.relatedTarget = rewriteTarget(assertion.relatedTarget);
    }
    if (assertion.condition) {
      assertion.condition = rewriteCondition(assertion.condition);
    }
  }
  function rewriteSetupAction(action) {
    if ("target" in action && action.target) {
      action.target = rewriteTarget(action.target);
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
function walkDir(dir) {
  const results = [];
  if (!fs__namespace.existsSync(dir)) return results;
  const entries = fs__namespace.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path__namespace.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}
if (typeof process !== "undefined" && process.argv[1]?.includes("migrate-specs-to-ctr")) {
  const specDir = process.argv[2];
  const outputFile = process.argv[3];
  if (!specDir) {
    console.error("Usage: npx tsx src/ctr/migrate-specs-to-ctr.ts <spec-dir> [output-file]");
    process.exit(1);
  }
  const resolvedDir = path__namespace.resolve(specDir);
  console.log(`Scanning ${resolvedDir} for .spec.uibridge.json files...`);
  const result = migrateDirectoryToCtr(resolvedDir);
  console.log(`Scanned ${result.scannedFiles.length} spec file(s)`);
  console.log(`Found ${result.totalTargets} unique target(s)`);
  console.log(`Created ${result.entriesCreated} CTR entr(ies)`);
  const json = JSON.stringify(result.ctrConfig, null, 2);
  if (outputFile) {
    const resolvedOutput = path__namespace.resolve(outputFile);
    fs__namespace.writeFileSync(resolvedOutput, json, "utf-8");
    console.log(`Written to ${resolvedOutput}`);
  } else {
    console.log("\n--- Generated CTR Config ---");
    console.log(json);
  }
}

exports.logicalNameFromSearch = logicalNameFromSearch;
exports.migrateDirectoryToCtr = migrateDirectoryToCtr;
exports.migrateSpecToCtr = migrateSpecToCtr;
exports.rewriteSpecWithCtr = rewriteSpecWithCtr;
exports.slugify = slugify;
//# sourceMappingURL=migrate.js.map
//# sourceMappingURL=migrate.js.map