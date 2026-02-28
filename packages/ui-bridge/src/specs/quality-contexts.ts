/**
 * Quality Contexts
 *
 * Built-in evaluation contexts that adjust metric weights and thresholds
 * for different UI design philosophies.
 */

import type { QualityContext, QualityMetricId, MetricContextConfig } from './quality-types';

// ============================================================================
// Default metric config (used when context doesn't specify a metric)
// ============================================================================

const DEFAULT_CONFIG: MetricContextConfig = {
  enabled: true,
  weight: 0.045, // ~1/22
  thresholds: { good: 80, warning: 50 },
};

// ============================================================================
// Helper
// ============================================================================

function defineContext(
  name: string,
  description: string,
  overrides: Partial<Record<QualityMetricId, Partial<MetricContextConfig>>>
): QualityContext {
  const metrics: Partial<Record<QualityMetricId, MetricContextConfig>> = {};
  for (const [id, partial] of Object.entries(overrides)) {
    metrics[id as QualityMetricId] = { ...DEFAULT_CONFIG, ...partial };
  }
  return { name, description, metrics };
}

// ============================================================================
// Built-in Contexts
// ============================================================================

const general = defineContext(
  'general',
  'Balanced evaluation suitable for most web applications.',
  {
    // Density (6) — total ~0.20
    elementDensity: { weight: 0.04 },
    whitespaceRatio: { weight: 0.04 },
    localDensityBalance: { weight: 0.03 },
    horizontalBalance: { weight: 0.03 },
    verticalBalance: { weight: 0.03 },
    alignmentConsistency: { weight: 0.03 },
    // Spacing (4) — total ~0.20
    spacingScaleAdherence: { weight: 0.05 },
    spacingConsistency: { weight: 0.05 },
    lineHeightRatio: { weight: 0.05 },
    interGroupSpacingRatio: { weight: 0.05 },
    // Color (4) — total ~0.20
    uniqueColorCount: { weight: 0.04 },
    wcagContrastCompliance: { weight: 0.06 },
    colorHarmony: { weight: 0.05 },
    saturationConsistency: { weight: 0.05 },
    // Typography (4) — total ~0.20
    typeScaleAdherence: { weight: 0.05 },
    fontWeightConsistency: { weight: 0.05 },
    headingHierarchy: { weight: 0.05 },
    fontFamilyCount: { weight: 0.05 },
    // Consistency (4) — total ~0.20
    buttonConsistency: { weight: 0.05 },
    cardConsistency: { weight: 0.05 },
    inputConsistency: { weight: 0.05 },
    touchTargetCompliance: { weight: 0.05 },
  }
);

const minimal = defineContext(
  'minimal',
  'Emphasizes whitespace, simplicity, and restrained use of color. Ideal for landing pages and editorial layouts.',
  {
    elementDensity: { weight: 0.03, thresholds: { good: 85, warning: 60 } },
    whitespaceRatio: { weight: 0.1, thresholds: { good: 85, warning: 60 } },
    localDensityBalance: { weight: 0.04 },
    horizontalBalance: { weight: 0.04 },
    verticalBalance: { weight: 0.04 },
    alignmentConsistency: { weight: 0.05 },
    spacingScaleAdherence: { weight: 0.06 },
    spacingConsistency: { weight: 0.06 },
    lineHeightRatio: { weight: 0.05 },
    interGroupSpacingRatio: { weight: 0.06 },
    uniqueColorCount: { weight: 0.06, thresholds: { good: 85, warning: 55 } },
    wcagContrastCompliance: { weight: 0.05 },
    colorHarmony: { weight: 0.06 },
    saturationConsistency: { weight: 0.05 },
    typeScaleAdherence: { weight: 0.06 },
    fontWeightConsistency: { weight: 0.04 },
    headingHierarchy: { weight: 0.04 },
    fontFamilyCount: { weight: 0.04 },
    buttonConsistency: { weight: 0.03 },
    cardConsistency: { weight: 0.02 },
    inputConsistency: { weight: 0.03 },
    touchTargetCompliance: { weight: 0.04 },
  }
);

const dataDense = defineContext(
  'data-dense',
  'Optimized for dashboards and data-heavy UIs. Lenient on density, strict on alignment and consistency.',
  {
    elementDensity: { weight: 0.02, thresholds: { good: 70, warning: 40 } },
    whitespaceRatio: { weight: 0.02, thresholds: { good: 70, warning: 40 } },
    localDensityBalance: { weight: 0.04 },
    horizontalBalance: { weight: 0.03 },
    verticalBalance: { weight: 0.03 },
    alignmentConsistency: { weight: 0.08, thresholds: { good: 85, warning: 60 } },
    spacingScaleAdherence: { weight: 0.07 },
    spacingConsistency: { weight: 0.08, thresholds: { good: 85, warning: 60 } },
    lineHeightRatio: { weight: 0.04 },
    interGroupSpacingRatio: { weight: 0.05 },
    uniqueColorCount: { weight: 0.04 },
    wcagContrastCompliance: { weight: 0.06 },
    colorHarmony: { weight: 0.03 },
    saturationConsistency: { weight: 0.03 },
    typeScaleAdherence: { weight: 0.04 },
    fontWeightConsistency: { weight: 0.04 },
    headingHierarchy: { weight: 0.03 },
    fontFamilyCount: { weight: 0.04 },
    buttonConsistency: { weight: 0.06 },
    cardConsistency: { weight: 0.06 },
    inputConsistency: { weight: 0.06 },
    touchTargetCompliance: { weight: 0.05 },
  }
);

const mobile = defineContext(
  'mobile',
  'Optimized for mobile devices. Prioritizes touch targets, readability, and simple hierarchy.',
  {
    elementDensity: { weight: 0.04 },
    whitespaceRatio: { weight: 0.05 },
    localDensityBalance: { weight: 0.03 },
    horizontalBalance: { weight: 0.04 },
    verticalBalance: { weight: 0.03 },
    alignmentConsistency: { weight: 0.04 },
    spacingScaleAdherence: { weight: 0.05 },
    spacingConsistency: { weight: 0.05 },
    lineHeightRatio: { weight: 0.06, thresholds: { good: 85, warning: 55 } },
    interGroupSpacingRatio: { weight: 0.05 },
    uniqueColorCount: { weight: 0.04 },
    wcagContrastCompliance: { weight: 0.06 },
    colorHarmony: { weight: 0.04 },
    saturationConsistency: { weight: 0.03 },
    typeScaleAdherence: { weight: 0.04 },
    fontWeightConsistency: { weight: 0.04 },
    headingHierarchy: { weight: 0.04 },
    fontFamilyCount: { weight: 0.05 },
    buttonConsistency: { weight: 0.05 },
    cardConsistency: { weight: 0.04 },
    inputConsistency: { weight: 0.05 },
    touchTargetCompliance: { weight: 0.08, thresholds: { good: 90, warning: 70 } },
  }
);

const accessibility = defineContext(
  'accessibility',
  'Focused on WCAG compliance and assistive technology support. Visual-only metrics are disabled.',
  {
    elementDensity: { enabled: false, weight: 0 },
    whitespaceRatio: { enabled: false, weight: 0 },
    localDensityBalance: { enabled: false, weight: 0 },
    horizontalBalance: { enabled: false, weight: 0 },
    verticalBalance: { enabled: false, weight: 0 },
    alignmentConsistency: { weight: 0.03 },
    spacingScaleAdherence: { weight: 0.05 },
    spacingConsistency: { weight: 0.05 },
    lineHeightRatio: { weight: 0.08, thresholds: { good: 90, warning: 65 } },
    interGroupSpacingRatio: { weight: 0.05 },
    uniqueColorCount: { enabled: false, weight: 0 },
    wcagContrastCompliance: { weight: 0.25, thresholds: { good: 95, warning: 80 } },
    colorHarmony: { enabled: false, weight: 0 },
    saturationConsistency: { enabled: false, weight: 0 },
    typeScaleAdherence: { weight: 0.05 },
    fontWeightConsistency: { weight: 0.04 },
    headingHierarchy: { weight: 0.15, thresholds: { good: 90, warning: 70 } },
    fontFamilyCount: { weight: 0.05 },
    buttonConsistency: { weight: 0.02 },
    cardConsistency: { weight: 0.02 },
    inputConsistency: { weight: 0.02 },
    touchTargetCompliance: { weight: 0.14, thresholds: { good: 95, warning: 80 } },
  }
);

// ============================================================================
// Registry
// ============================================================================

export const BUILT_IN_CONTEXTS: Record<string, QualityContext> = {
  general,
  minimal,
  'data-dense': dataDense,
  mobile,
  accessibility,
};

/**
 * Get a context by name. Returns undefined if not found.
 */
export function getContext(name: string): QualityContext | undefined {
  return BUILT_IN_CONTEXTS[name];
}

/**
 * List available context names and descriptions.
 */
export function listContexts(): Array<{ name: string; description: string }> {
  return Object.values(BUILT_IN_CONTEXTS).map((c) => ({
    name: c.name,
    description: c.description,
  }));
}

/**
 * Merge a base context with partial overrides.
 * Useful for creating custom contexts that extend built-in ones.
 */
export function mergeContext(
  base: QualityContext,
  overrides: Partial<QualityContext>
): QualityContext {
  const merged: QualityContext = {
    name: overrides.name ?? base.name,
    description: overrides.description ?? base.description,
    metrics: { ...base.metrics },
  };

  if (overrides.metrics) {
    for (const [id, config] of Object.entries(overrides.metrics)) {
      const existing = merged.metrics[id as QualityMetricId];
      merged.metrics[id as QualityMetricId] = existing
        ? { ...existing, ...config }
        : { ...DEFAULT_CONFIG, ...config };
    }
  }

  return merged;
}
