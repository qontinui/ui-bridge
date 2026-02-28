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
    // UX (5) — total ~0.20
    contentOverflow: { weight: 0.05 },
    aboveFoldRatio: { weight: 0.04 },
    informationDensity: { weight: 0.04 },
    containerEfficiency: { weight: 0.04 },
    viewportUtilization: { weight: 0.03 },
    // Density (6) — total ~0.16
    elementDensity: { weight: 0.03 },
    whitespaceRatio: { weight: 0.03 },
    localDensityBalance: { weight: 0.025 },
    horizontalBalance: { weight: 0.025 },
    verticalBalance: { weight: 0.025 },
    alignmentConsistency: { weight: 0.025 },
    // Spacing (4) — total ~0.16
    spacingScaleAdherence: { weight: 0.04 },
    spacingConsistency: { weight: 0.04 },
    lineHeightRatio: { weight: 0.04 },
    interGroupSpacingRatio: { weight: 0.04 },
    // Color (4) — total ~0.16
    uniqueColorCount: { weight: 0.03 },
    wcagContrastCompliance: { weight: 0.05 },
    colorHarmony: { weight: 0.04 },
    saturationConsistency: { weight: 0.04 },
    // Typography (4) — total ~0.16
    typeScaleAdherence: { weight: 0.04 },
    fontWeightConsistency: { weight: 0.04 },
    headingHierarchy: { weight: 0.04 },
    fontFamilyCount: { weight: 0.04 },
    // Consistency (4) — total ~0.16
    buttonConsistency: { weight: 0.04 },
    cardConsistency: { weight: 0.04 },
    inputConsistency: { weight: 0.04 },
    touchTargetCompliance: { weight: 0.04 },
  }
);

const minimal = defineContext(
  'minimal',
  'Emphasizes whitespace, simplicity, and restrained use of color. Ideal for landing pages and editorial layouts.',
  {
    // UX (5) — total ~0.12 (minimalist pages use space intentionally)
    contentOverflow: { weight: 0.03 },
    aboveFoldRatio: { weight: 0.025 },
    informationDensity: { weight: 0.02 },
    containerEfficiency: { weight: 0.02 },
    viewportUtilization: { weight: 0.025 },
    // Density & Layout
    elementDensity: { weight: 0.025, thresholds: { good: 85, warning: 60 } },
    whitespaceRatio: { weight: 0.09, thresholds: { good: 85, warning: 60 } },
    localDensityBalance: { weight: 0.035 },
    horizontalBalance: { weight: 0.035 },
    verticalBalance: { weight: 0.035 },
    alignmentConsistency: { weight: 0.04 },
    // Spacing
    spacingScaleAdherence: { weight: 0.05 },
    spacingConsistency: { weight: 0.05 },
    lineHeightRatio: { weight: 0.045 },
    interGroupSpacingRatio: { weight: 0.05 },
    // Color
    uniqueColorCount: { weight: 0.05, thresholds: { good: 85, warning: 55 } },
    wcagContrastCompliance: { weight: 0.045 },
    colorHarmony: { weight: 0.05 },
    saturationConsistency: { weight: 0.04 },
    // Typography
    typeScaleAdherence: { weight: 0.05 },
    fontWeightConsistency: { weight: 0.035 },
    headingHierarchy: { weight: 0.035 },
    fontFamilyCount: { weight: 0.035 },
    // Consistency
    buttonConsistency: { weight: 0.025 },
    cardConsistency: { weight: 0.015 },
    inputConsistency: { weight: 0.025 },
    touchTargetCompliance: { weight: 0.035 },
  }
);

const dataDense = defineContext(
  'data-dense',
  'Optimized for dashboards and data-heavy UIs. Lenient on density, strict on alignment and consistency.',
  {
    // UX (5) — total ~0.25 (dashboards are where these problems appear most)
    contentOverflow: { weight: 0.06 },
    aboveFoldRatio: { weight: 0.05 },
    informationDensity: { weight: 0.05 },
    containerEfficiency: { weight: 0.05, thresholds: { good: 75, warning: 45 } },
    viewportUtilization: { weight: 0.04 },
    // Density & Layout
    elementDensity: { weight: 0.015, thresholds: { good: 70, warning: 40 } },
    whitespaceRatio: { weight: 0.015, thresholds: { good: 70, warning: 40 } },
    localDensityBalance: { weight: 0.03 },
    horizontalBalance: { weight: 0.02 },
    verticalBalance: { weight: 0.02 },
    alignmentConsistency: { weight: 0.06, thresholds: { good: 85, warning: 60 } },
    // Spacing
    spacingScaleAdherence: { weight: 0.05 },
    spacingConsistency: { weight: 0.06, thresholds: { good: 85, warning: 60 } },
    lineHeightRatio: { weight: 0.03 },
    interGroupSpacingRatio: { weight: 0.04 },
    // Color
    uniqueColorCount: { weight: 0.03 },
    wcagContrastCompliance: { weight: 0.05 },
    colorHarmony: { weight: 0.02 },
    saturationConsistency: { weight: 0.02 },
    // Typography
    typeScaleAdherence: { weight: 0.03 },
    fontWeightConsistency: { weight: 0.03 },
    headingHierarchy: { weight: 0.02 },
    fontFamilyCount: { weight: 0.03 },
    // Consistency
    buttonConsistency: { weight: 0.045 },
    cardConsistency: { weight: 0.045 },
    inputConsistency: { weight: 0.045 },
    touchTargetCompliance: { weight: 0.04 },
  }
);

const mobile = defineContext(
  'mobile',
  'Optimized for mobile devices. Prioritizes touch targets, readability, and simple hierarchy.',
  {
    // UX (5) — total ~0.22 (viewport constraints make overflow critical)
    contentOverflow: { weight: 0.06, thresholds: { good: 85, warning: 50 } },
    aboveFoldRatio: { weight: 0.05 },
    informationDensity: { weight: 0.04 },
    containerEfficiency: { weight: 0.04 },
    viewportUtilization: { weight: 0.03 },
    // Density & Layout
    elementDensity: { weight: 0.03 },
    whitespaceRatio: { weight: 0.04 },
    localDensityBalance: { weight: 0.02 },
    horizontalBalance: { weight: 0.03 },
    verticalBalance: { weight: 0.02 },
    alignmentConsistency: { weight: 0.03 },
    // Spacing
    spacingScaleAdherence: { weight: 0.04 },
    spacingConsistency: { weight: 0.04 },
    lineHeightRatio: { weight: 0.05, thresholds: { good: 85, warning: 55 } },
    interGroupSpacingRatio: { weight: 0.04 },
    // Color
    uniqueColorCount: { weight: 0.03 },
    wcagContrastCompliance: { weight: 0.05 },
    colorHarmony: { weight: 0.03 },
    saturationConsistency: { weight: 0.02 },
    // Typography
    typeScaleAdherence: { weight: 0.03 },
    fontWeightConsistency: { weight: 0.03 },
    headingHierarchy: { weight: 0.03 },
    fontFamilyCount: { weight: 0.04 },
    // Consistency
    buttonConsistency: { weight: 0.04 },
    cardConsistency: { weight: 0.03 },
    inputConsistency: { weight: 0.04 },
    touchTargetCompliance: { weight: 0.07, thresholds: { good: 90, warning: 70 } },
  }
);

const accessibility = defineContext(
  'accessibility',
  'Focused on WCAG compliance and assistive technology support. Visual-only metrics are disabled.',
  {
    // UX (5) — total ~0.15 (content reachability matters for assistive tech)
    contentOverflow: { weight: 0.04 },
    aboveFoldRatio: { weight: 0.03 },
    informationDensity: { weight: 0.03 },
    containerEfficiency: { weight: 0.02 },
    viewportUtilization: { weight: 0.03 },
    // Density — mostly disabled for accessibility
    elementDensity: { enabled: false, weight: 0 },
    whitespaceRatio: { enabled: false, weight: 0 },
    localDensityBalance: { enabled: false, weight: 0 },
    horizontalBalance: { enabled: false, weight: 0 },
    verticalBalance: { enabled: false, weight: 0 },
    alignmentConsistency: { weight: 0.03 },
    // Spacing
    spacingScaleAdherence: { weight: 0.04 },
    spacingConsistency: { weight: 0.04 },
    lineHeightRatio: { weight: 0.07, thresholds: { good: 90, warning: 65 } },
    interGroupSpacingRatio: { weight: 0.04 },
    // Color
    uniqueColorCount: { enabled: false, weight: 0 },
    wcagContrastCompliance: { weight: 0.22, thresholds: { good: 95, warning: 80 } },
    colorHarmony: { enabled: false, weight: 0 },
    saturationConsistency: { enabled: false, weight: 0 },
    // Typography
    typeScaleAdherence: { weight: 0.04 },
    fontWeightConsistency: { weight: 0.035 },
    headingHierarchy: { weight: 0.13, thresholds: { good: 90, warning: 70 } },
    fontFamilyCount: { weight: 0.04 },
    // Consistency
    buttonConsistency: { weight: 0.015 },
    cardConsistency: { weight: 0.015 },
    inputConsistency: { weight: 0.015 },
    touchTargetCompliance: { weight: 0.12, thresholds: { good: 95, warning: 80 } },
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
