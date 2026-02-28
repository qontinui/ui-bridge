/**
 * Quality Metrics
 *
 * 22 metric functions measuring holistic UI quality across
 * density, spacing, color, typography, and consistency.
 * All functions are pure — no DOM or browser APIs.
 */

import type { ElementDesignData } from '../core/types';
import type { QualityMetricId, MetricResult, MetricFinding, MetricFunction } from './quality-types';
import {
  parseColor,
  rgbToHsl,
  contrastRatio,
  clusterColors,
  isGrayscale,
  hueDistance,
  type RGBA,
} from './color-utils';

// ============================================================================
// Helpers
// ============================================================================

function parsePx(value: string): number {
  const n = parseFloat(value);
  return isNaN(n) ? 0 : n;
}

function coefficientOfVariation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  if (mean === 0) return 0;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / Math.abs(mean);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function elementArea(el: ElementDesignData): number {
  return el.rect.width * el.rect.height;
}

function isInteractive(el: ElementDesignData): boolean {
  const t = el.type.toLowerCase();
  return (
    t === 'button' ||
    t === 'input' ||
    t === 'select' ||
    t === 'textarea' ||
    t === 'link' ||
    t === 'a' ||
    t === 'checkbox' ||
    t === 'radio' ||
    t === 'switch' ||
    t === 'pressable' ||
    t === 'touchable'
  );
}

function makeResult(
  metricId: QualityMetricId,
  label: string,
  category: MetricResult['category'],
  score: number,
  findings: MetricFinding[],
  rawData?: Record<string, unknown>
): MetricResult {
  return {
    metricId,
    score: Math.round(clamp(score, 0, 100)),
    label,
    category,
    enabled: true,
    weight: 0, // set by evaluator from context
    findings,
    rawData,
  };
}

// ============================================================================
// Density & Layout (6 metrics)
// ============================================================================

export const elementDensity: MetricFunction = (elements, viewport) => {
  const viewportArea = viewport.width * viewport.height;
  if (viewportArea === 0)
    return makeResult('elementDensity', 'Element Density', 'density', 100, []);

  const totalElementArea = elements.reduce((sum, el) => sum + elementArea(el), 0);
  const coverage = totalElementArea / viewportArea;
  const findings: MetricFinding[] = [];

  // Ideal range: 30-70% coverage
  let score: number;
  if (coverage >= 0.3 && coverage <= 0.7) {
    score = 100;
  } else if (coverage < 0.3) {
    score = (coverage / 0.3) * 100;
    findings.push({
      severity: 'warning',
      message: `Low element density (${(coverage * 100).toFixed(1)}%). Page may feel empty.`,
      recommendation: 'Consider adding content or reducing whitespace.',
    });
  } else {
    score = Math.max(0, 100 - ((coverage - 0.7) / 0.3) * 100);
    findings.push({
      severity: 'warning',
      message: `High element density (${(coverage * 100).toFixed(1)}%). Page may feel cluttered.`,
      recommendation: 'Consider reducing content density or increasing spacing.',
    });
  }

  return makeResult('elementDensity', 'Element Density', 'density', score, findings, { coverage });
};

export const whitespaceRatio: MetricFunction = (elements, viewport) => {
  const viewportArea = viewport.width * viewport.height;
  if (viewportArea === 0)
    return makeResult('whitespaceRatio', 'Whitespace Ratio', 'density', 100, []);

  const totalElementArea = elements.reduce((sum, el) => sum + elementArea(el), 0);
  const ratio = 1 - Math.min(1, totalElementArea / viewportArea);
  const findings: MetricFinding[] = [];

  let score: number;
  if (ratio >= 0.25 && ratio <= 0.75) {
    score = 100;
  } else if (ratio < 0.25) {
    score = (ratio / 0.25) * 100;
    findings.push({
      severity: 'warning',
      message: `Very low whitespace (${(ratio * 100).toFixed(1)}%). UI feels cramped.`,
      recommendation: 'Increase padding and margins between elements.',
    });
  } else {
    score = Math.max(0, 100 - ((ratio - 0.75) / 0.25) * 100);
    findings.push({
      severity: 'info',
      message: `Very high whitespace (${(ratio * 100).toFixed(1)}%). Page may feel sparse.`,
      recommendation: 'Consider whether the empty space serves a purpose.',
    });
  }

  return makeResult('whitespaceRatio', 'Whitespace Ratio', 'density', score, findings, { ratio });
};

export const localDensityBalance: MetricFunction = (elements, viewport) => {
  if (elements.length < 4)
    return makeResult('localDensityBalance', 'Local Density Balance', 'density', 100, []);

  const gridCols = 4;
  const gridRows = 4;
  const cellW = viewport.width / gridCols;
  const cellH = viewport.height / gridRows;
  const densities: number[] = [];

  for (let row = 0; row < gridRows; row++) {
    for (let col = 0; col < gridCols; col++) {
      const cellX = col * cellW;
      const cellY = row * cellH;
      let cellArea = 0;
      for (const el of elements) {
        const overlapX = Math.max(
          0,
          Math.min(el.rect.x + el.rect.width, cellX + cellW) - Math.max(el.rect.x, cellX)
        );
        const overlapY = Math.max(
          0,
          Math.min(el.rect.y + el.rect.height, cellY + cellH) - Math.max(el.rect.y, cellY)
        );
        cellArea += overlapX * overlapY;
      }
      densities.push(cellArea / (cellW * cellH));
    }
  }

  const cv = coefficientOfVariation(densities);
  const findings: MetricFinding[] = [];

  let score: number;
  if (cv <= 0.3) {
    score = 100;
  } else if (cv >= 1.0) {
    score = 0;
    findings.push({
      severity: 'error',
      message: `Highly unbalanced density distribution (CV=${cv.toFixed(2)}). Some regions are much denser than others.`,
      recommendation: 'Redistribute content more evenly across the page.',
    });
  } else {
    score = 100 - ((cv - 0.3) / 0.7) * 100;
    if (score < 60) {
      findings.push({
        severity: 'warning',
        message: `Uneven density distribution (CV=${cv.toFixed(2)}).`,
        recommendation: 'Balance content distribution across page regions.',
      });
    }
  }

  return makeResult('localDensityBalance', 'Local Density Balance', 'density', score, findings, {
    cv,
    gridDensities: densities,
  });
};

export const horizontalBalance: MetricFunction = (elements, viewport) => {
  if (elements.length === 0)
    return makeResult('horizontalBalance', 'Horizontal Balance', 'density', 100, []);

  const midX = viewport.width / 2;
  let leftArea = 0;
  let rightArea = 0;

  for (const el of elements) {
    const elMidX = el.rect.x + el.rect.width / 2;
    const area = elementArea(el);
    if (elMidX < midX) leftArea += area;
    else rightArea += area;
  }

  const total = leftArea + rightArea;
  if (total === 0) return makeResult('horizontalBalance', 'Horizontal Balance', 'density', 100, []);

  const ratio = Math.min(leftArea, rightArea) / Math.max(leftArea, rightArea);
  const findings: MetricFinding[] = [];

  // Ratio 0.8-1.0 = good
  let score: number;
  if (ratio >= 0.8) {
    score = 100;
  } else {
    score = (ratio / 0.8) * 100;
    const heavier = leftArea > rightArea ? 'left' : 'right';
    findings.push({
      severity: ratio < 0.5 ? 'warning' : 'info',
      message: `Horizontal imbalance: ${heavier} side is heavier (ratio=${ratio.toFixed(2)}).`,
      recommendation: `Consider redistributing visual weight toward the ${heavier === 'left' ? 'right' : 'left'} side.`,
    });
  }

  return makeResult('horizontalBalance', 'Horizontal Balance', 'density', score, findings, {
    ratio,
    leftArea,
    rightArea,
  });
};

export const verticalBalance: MetricFunction = (elements, viewport) => {
  if (elements.length === 0)
    return makeResult('verticalBalance', 'Vertical Balance', 'density', 100, []);

  const midY = viewport.height / 2;
  let topArea = 0;
  let bottomArea = 0;

  for (const el of elements) {
    const elMidY = el.rect.y + el.rect.height / 2;
    const area = elementArea(el);
    if (elMidY < midY) topArea += area;
    else bottomArea += area;
  }

  const total = topArea + bottomArea;
  if (total === 0) return makeResult('verticalBalance', 'Vertical Balance', 'density', 100, []);

  const ratio = Math.min(topArea, bottomArea) / Math.max(topArea, bottomArea);
  const findings: MetricFinding[] = [];

  let score: number;
  if (ratio >= 0.8) {
    score = 100;
  } else {
    score = (ratio / 0.8) * 100;
    const heavier = topArea > bottomArea ? 'top' : 'bottom';
    findings.push({
      severity: ratio < 0.5 ? 'warning' : 'info',
      message: `Vertical imbalance: ${heavier} half is heavier (ratio=${ratio.toFixed(2)}).`,
      recommendation: `Consider redistributing visual weight toward the ${heavier === 'top' ? 'bottom' : 'top'}.`,
    });
  }

  return makeResult('verticalBalance', 'Vertical Balance', 'density', score, findings, {
    ratio,
    topArea,
    bottomArea,
  });
};

export const alignmentConsistency: MetricFunction = (elements, _viewport) => {
  if (elements.length < 3)
    return makeResult('alignmentConsistency', 'Alignment Consistency', 'density', 100, []);

  const tolerance = 2; // px
  const xEdges = elements.map((el) => el.rect.x);
  const yEdges = elements.map((el) => el.rect.y);

  function countOnLines(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    let onLine = 0;
    let i = 0;
    while (i < sorted.length) {
      let j = i + 1;
      while (j < sorted.length && sorted[j] - sorted[i] <= tolerance) j++;
      if (j - i >= 2) onLine += j - i; // at least 2 elements share this line
      i = j;
    }
    return onLine;
  }

  const xOnLine = countOnLines(xEdges);
  const yOnLine = countOnLines(yEdges);
  const totalChecks = elements.length * 2;
  const aligned = xOnLine + yOnLine;
  const ratio = totalChecks > 0 ? aligned / totalChecks : 1;

  const score = ratio * 100;
  const findings: MetricFinding[] = [];

  if (score < 60) {
    findings.push({
      severity: 'warning',
      message: `Only ${(ratio * 100).toFixed(0)}% of elements align to shared grid lines.`,
      recommendation: 'Use a consistent grid system to align element edges.',
    });
  }

  return makeResult('alignmentConsistency', 'Alignment Consistency', 'density', score, findings, {
    ratio,
    xOnLine,
    yOnLine,
  });
};

// ============================================================================
// Spacing (4 metrics)
// ============================================================================

export const spacingScaleAdherence: MetricFunction = (elements) => {
  const spacingValues: number[] = [];

  for (const el of elements) {
    for (const prop of [
      'marginTop',
      'marginRight',
      'marginBottom',
      'marginLeft',
      'paddingTop',
      'paddingRight',
      'paddingBottom',
      'paddingLeft',
    ] as const) {
      const v = parsePx(el.styles[prop]);
      if (v > 0) spacingValues.push(v);
    }
  }

  if (spacingValues.length === 0)
    return makeResult('spacingScaleAdherence', 'Spacing Scale Adherence', 'spacing', 100, []);

  const onGrid = spacingValues.filter((v) => v % 4 === 0).length;
  const ratio = onGrid / spacingValues.length;
  const score = ratio * 100;
  const findings: MetricFinding[] = [];

  if (score < 70) {
    const offGrid = spacingValues.filter((v) => v % 4 !== 0);
    const uniqueOffGrid = [...new Set(offGrid)].sort((a, b) => a - b).slice(0, 5);
    findings.push({
      severity: 'warning',
      message: `${((1 - ratio) * 100).toFixed(0)}% of spacing values are not multiples of 4px.`,
      recommendation: `Off-grid values: ${uniqueOffGrid.map((v) => v + 'px').join(', ')}. Snap to 4px grid.`,
    });
  }

  return makeResult(
    'spacingScaleAdherence',
    'Spacing Scale Adherence',
    'spacing',
    score,
    findings,
    { ratio, total: spacingValues.length }
  );
};

export const spacingConsistency: MetricFunction = (elements) => {
  if (elements.length < 3)
    return makeResult('spacingConsistency', 'Spacing Consistency', 'spacing', 100, []);

  // Group elements by shared Y band (horizontal siblings)
  const yTolerance = 5;
  const sorted = [...elements].sort((a, b) => a.rect.y - b.rect.y);
  const rows: ElementDesignData[][] = [];
  let currentRow: ElementDesignData[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    if (Math.abs(sorted[i].rect.y - sorted[i - 1].rect.y) <= yTolerance) {
      currentRow.push(sorted[i]);
    } else {
      if (currentRow.length >= 2) rows.push(currentRow);
      currentRow = [sorted[i]];
    }
  }
  if (currentRow.length >= 2) rows.push(currentRow);

  if (rows.length === 0)
    return makeResult('spacingConsistency', 'Spacing Consistency', 'spacing', 100, []);

  // Compute gap variance within each row
  const allGaps: number[] = [];
  for (const row of rows) {
    const byX = [...row].sort((a, b) => a.rect.x - b.rect.x);
    for (let i = 1; i < byX.length; i++) {
      const gap = byX[i].rect.x - (byX[i - 1].rect.x + byX[i - 1].rect.width);
      if (gap > 0) allGaps.push(gap);
    }
  }

  if (allGaps.length < 2)
    return makeResult('spacingConsistency', 'Spacing Consistency', 'spacing', 100, []);

  const cv = coefficientOfVariation(allGaps);
  const score = Math.max(0, 100 - cv * 100);
  const findings: MetricFinding[] = [];

  if (score < 60) {
    findings.push({
      severity: 'warning',
      message: `Inconsistent horizontal spacing between sibling elements (CV=${cv.toFixed(2)}).`,
      recommendation: 'Use uniform gap values for elements in the same row.',
    });
  }

  return makeResult('spacingConsistency', 'Spacing Consistency', 'spacing', score, findings, {
    cv,
    gapCount: allGaps.length,
  });
};

export const lineHeightRatio: MetricFunction = (elements) => {
  const ratios: number[] = [];
  const badElements: string[] = [];

  for (const el of elements) {
    const fontSize = parsePx(el.styles.fontSize);
    const lh = parsePx(el.styles.lineHeight);
    if (fontSize > 0 && lh > 0) {
      const r = lh / fontSize;
      ratios.push(r);
      if (r < 1.2 || r > 1.8) badElements.push(el.elementId);
    }
  }

  if (ratios.length === 0)
    return makeResult('lineHeightRatio', 'Line Height Ratio', 'spacing', 100, []);

  const inRange = ratios.filter((r) => r >= 1.2 && r <= 1.8).length;
  const score = (inRange / ratios.length) * 100;
  const findings: MetricFinding[] = [];

  if (score < 80) {
    findings.push({
      severity: 'warning',
      message: `${ratios.length - inRange} text elements have line-height outside the 1.2-1.8x range.`,
      recommendation: 'Aim for line-height between 1.4-1.6x font-size for body text.',
      elementIds: badElements.slice(0, 10),
    });
  }

  return makeResult('lineHeightRatio', 'Line Height Ratio', 'spacing', score, findings, {
    total: ratios.length,
    inRange,
  });
};

export const interGroupSpacingRatio: MetricFunction = (elements) => {
  if (elements.length < 4)
    return makeResult('interGroupSpacingRatio', 'Inter-Group Spacing Ratio', 'spacing', 100, []);

  // Compute all pairwise distances (center-to-center)
  const distances: number[] = [];
  for (let i = 0; i < elements.length; i++) {
    for (let j = i + 1; j < elements.length; j++) {
      const dx =
        elements[i].rect.x +
        elements[i].rect.width / 2 -
        (elements[j].rect.x + elements[j].rect.width / 2);
      const dy =
        elements[i].rect.y +
        elements[i].rect.height / 2 -
        (elements[j].rect.y + elements[j].rect.height / 2);
      distances.push(Math.sqrt(dx * dx + dy * dy));
    }
  }

  if (distances.length === 0)
    return makeResult('interGroupSpacingRatio', 'Inter-Group Spacing Ratio', 'spacing', 100, []);

  distances.sort((a, b) => a - b);
  const median = distances[Math.floor(distances.length / 2)];
  const threshold = median * 1.5;

  const intraGroup = distances.filter((d) => d <= threshold);
  const interGroup = distances.filter((d) => d > threshold);

  if (intraGroup.length === 0 || interGroup.length === 0)
    return makeResult('interGroupSpacingRatio', 'Inter-Group Spacing Ratio', 'spacing', 100, []);

  const avgIntra = intraGroup.reduce((s, d) => s + d, 0) / intraGroup.length;
  const avgInter = interGroup.reduce((s, d) => s + d, 0) / interGroup.length;
  const ratio = avgIntra > 0 ? avgInter / avgIntra : 1;

  // Ideal: ratio >= 2.5
  const score = ratio >= 2.5 ? 100 : (ratio / 2.5) * 100;
  const findings: MetricFinding[] = [];

  if (score < 60) {
    findings.push({
      severity: 'warning',
      message: `Weak visual grouping: inter-group spacing is only ${ratio.toFixed(1)}x intra-group spacing.`,
      recommendation: 'Increase spacing between groups to at least 2.5x the spacing within groups.',
    });
  }

  return makeResult(
    'interGroupSpacingRatio',
    'Inter-Group Spacing Ratio',
    'spacing',
    score,
    findings,
    { ratio }
  );
};

// ============================================================================
// Color (4 metrics)
// ============================================================================

export const uniqueColorCount: MetricFunction = (elements) => {
  const colors: RGBA[] = [];

  for (const el of elements) {
    for (const prop of ['color', 'backgroundColor'] as const) {
      const parsed = parseColor(el.styles[prop]);
      if (parsed && parsed.a > 0.1) colors.push(parsed);
    }
  }

  if (colors.length === 0)
    return makeResult('uniqueColorCount', 'Unique Color Count', 'color', 100, []);

  const clusters = clusterColors(colors, 25);
  const count = clusters.length;
  const findings: MetricFinding[] = [];

  // Ideal: 3-8 color clusters
  let score: number;
  if (count >= 3 && count <= 8) {
    score = 100;
  } else if (count < 3) {
    score = 60 + (count / 3) * 40;
    findings.push({
      severity: 'info',
      message: `Only ${count} distinct color(s). Palette may be too limited.`,
      recommendation: 'Consider adding accent colors for visual hierarchy.',
    });
  } else {
    score = Math.max(0, 100 - (count - 8) * 8);
    findings.push({
      severity: 'warning',
      message: `${count} distinct colors used. Palette may be too varied.`,
      recommendation: 'Consolidate similar colors and limit palette to 5-8 colors.',
    });
  }

  return makeResult('uniqueColorCount', 'Unique Color Count', 'color', score, findings, {
    count,
    totalSampled: colors.length,
  });
};

export const wcagContrastCompliance: MetricFunction = (elements) => {
  let passing = 0;
  let total = 0;
  const failingElements: string[] = [];

  for (const el of elements) {
    const fg = parseColor(el.styles.color);
    let bg = parseColor(el.styles.backgroundColor);

    // Skip non-text elements (no foreground color)
    if (!fg) continue;

    // Default background: white
    if (!bg || bg.a < 0.1) bg = { r: 255, g: 255, b: 255, a: 1 };

    total++;
    const ratio = contrastRatio(fg, bg);

    if (ratio >= 4.5) {
      passing++;
    } else {
      failingElements.push(el.elementId);
    }
  }

  if (total === 0)
    return makeResult('wcagContrastCompliance', 'WCAG Contrast Compliance', 'color', 100, []);

  const score = (passing / total) * 100;
  const findings: MetricFinding[] = [];

  if (failingElements.length > 0) {
    findings.push({
      severity: 'error',
      message: `${failingElements.length} of ${total} text elements fail WCAG AA contrast (4.5:1 minimum).`,
      recommendation: 'Increase contrast between text color and background color.',
      elementIds: failingElements.slice(0, 10),
    });
  }

  return makeResult(
    'wcagContrastCompliance',
    'WCAG Contrast Compliance',
    'color',
    score,
    findings,
    { passing, total }
  );
};

export const colorHarmony: MetricFunction = (elements) => {
  const hues: number[] = [];

  for (const el of elements) {
    for (const prop of ['color', 'backgroundColor'] as const) {
      const parsed = parseColor(el.styles[prop]);
      if (parsed && parsed.a > 0.1 && !isGrayscale(parsed)) {
        const hsl = rgbToHsl(parsed);
        hues.push(hsl.h);
      }
    }
  }

  if (hues.length < 2) return makeResult('colorHarmony', 'Color Harmony', 'color', 100, []);

  // Cluster hues to find distinct hue groups
  const uniqueHues = [...new Set(hues.map((h) => Math.round(h / 10) * 10))];
  if (uniqueHues.length < 2) return makeResult('colorHarmony', 'Color Harmony', 'color', 100, []);

  // Test harmony patterns
  const patterns = [
    { name: 'monochromatic', test: () => checkMonochromatic(uniqueHues) },
    { name: 'complementary', test: () => checkComplementary(uniqueHues) },
    { name: 'analogous', test: () => checkAnalogous(uniqueHues) },
    { name: 'triadic', test: () => checkTriadic(uniqueHues) },
  ];

  let bestScore = 0;
  let bestPattern = 'none';

  for (const p of patterns) {
    const s = p.test();
    if (s > bestScore) {
      bestScore = s;
      bestPattern = p.name;
    }
  }

  const findings: MetricFinding[] = [];
  if (bestScore < 50) {
    findings.push({
      severity: 'warning',
      message: `Color palette does not follow a clear harmony pattern.`,
      recommendation:
        'Use complementary (opposite hues), analogous (adjacent hues), or triadic (evenly spaced hues) color schemes.',
    });
  }

  return makeResult('colorHarmony', 'Color Harmony', 'color', bestScore, findings, {
    bestPattern,
    distinctHues: uniqueHues.length,
  });
};

function checkMonochromatic(hues: number[]): number {
  if (hues.length <= 1) return 100;
  const base = hues[0];
  const maxDist = Math.max(...hues.map((h) => hueDistance(h, base)));
  return maxDist <= 15 ? 100 : maxDist <= 30 ? 70 : 30;
}

function checkComplementary(hues: number[]): number {
  // Find best pair with ~180° separation
  let bestFit = 0;
  for (let i = 0; i < hues.length; i++) {
    for (let j = i + 1; j < hues.length; j++) {
      const dist = hueDistance(hues[i], hues[j]);
      const fit = dist >= 165 && dist <= 195 ? 100 : Math.max(0, 100 - Math.abs(dist - 180) * 2);
      if (fit > bestFit) bestFit = fit;
    }
  }
  // Penalize if too many hue groups don't fit the pair
  return hues.length <= 3 ? bestFit : bestFit * 0.7;
}

function checkAnalogous(hues: number[]): number {
  const sorted = [...hues].sort((a, b) => a - b);
  let maxGap = 0;
  for (let i = 1; i < sorted.length; i++) {
    maxGap = Math.max(maxGap, sorted[i] - sorted[i - 1]);
  }
  // Wraparound gap
  if (sorted.length > 1) {
    maxGap = Math.max(maxGap, 360 - sorted[sorted.length - 1] + sorted[0]);
  }
  const span = 360 - maxGap;
  return span <= 60 ? 100 : span <= 90 ? 70 : span <= 120 ? 40 : 20;
}

function checkTriadic(hues: number[]): number {
  if (hues.length < 3) return 0;
  // Check if hues fit roughly 120° apart
  const sorted = [...hues].sort((a, b) => a - b);
  let bestScore = 0;

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      for (let k = j + 1; k < sorted.length; k++) {
        const d1 = hueDistance(sorted[i], sorted[j]);
        const d2 = hueDistance(sorted[j], sorted[k]);
        const d3 = hueDistance(sorted[i], sorted[k]);
        const avgDeviation = (Math.abs(d1 - 120) + Math.abs(d2 - 120) + Math.abs(d3 - 120)) / 3;
        const s = Math.max(0, 100 - avgDeviation * 2);
        if (s > bestScore) bestScore = s;
      }
    }
  }

  return bestScore;
}

export const saturationConsistency: MetricFunction = (elements) => {
  const saturations: number[] = [];

  for (const el of elements) {
    for (const prop of ['color', 'backgroundColor'] as const) {
      const parsed = parseColor(el.styles[prop]);
      if (parsed && parsed.a > 0.1 && !isGrayscale(parsed)) {
        const hsl = rgbToHsl(parsed);
        saturations.push(hsl.s);
      }
    }
  }

  if (saturations.length < 2)
    return makeResult('saturationConsistency', 'Saturation Consistency', 'color', 100, []);

  const cv = coefficientOfVariation(saturations);
  const score = Math.max(0, 100 - cv * 100);
  const findings: MetricFinding[] = [];

  if (score < 60) {
    findings.push({
      severity: 'info',
      message: `Inconsistent color saturation levels (CV=${cv.toFixed(2)}).`,
      recommendation: 'Use a consistent saturation level across your color palette.',
    });
  }

  return makeResult('saturationConsistency', 'Saturation Consistency', 'color', score, findings, {
    cv,
    count: saturations.length,
  });
};

// ============================================================================
// Typography (4 metrics)
// ============================================================================

export const typeScaleAdherence: MetricFunction = (elements) => {
  const fontSizes = new Set<number>();

  for (const el of elements) {
    const size = parsePx(el.styles.fontSize);
    if (size > 0) fontSizes.add(Math.round(size * 10) / 10);
  }

  const sizes = [...fontSizes].sort((a, b) => a - b);
  if (sizes.length < 2)
    return makeResult('typeScaleAdherence', 'Type Scale Adherence', 'typography', 100, []);

  // Common type scales
  const scales = [
    { name: 'minor-second', ratio: 1.067 },
    { name: 'major-second', ratio: 1.125 },
    { name: 'minor-third', ratio: 1.2 },
    { name: 'major-third', ratio: 1.25 },
    { name: 'perfect-fourth', ratio: 1.333 },
    { name: 'augmented-fourth', ratio: 1.414 },
    { name: 'perfect-fifth', ratio: 1.5 },
  ];

  let bestScore = 0;
  let bestScale = 'none';

  for (const scale of scales) {
    // For each base size, check how many sizes fit the scale
    for (const base of sizes) {
      let onScale = 0;
      for (const size of sizes) {
        // Check if size = base * ratio^n for some integer n
        if (size <= 0 || base <= 0) continue;
        const n = Math.log(size / base) / Math.log(scale.ratio);
        if (Math.abs(n - Math.round(n)) < 0.15) onScale++;
      }
      const fit = (onScale / sizes.length) * 100;
      if (fit > bestScore) {
        bestScore = fit;
        bestScale = scale.name;
      }
    }
  }

  const findings: MetricFinding[] = [];
  if (bestScore < 60) {
    findings.push({
      severity: 'warning',
      message: `Font sizes (${sizes.join(', ')}px) don't follow a consistent type scale.`,
      recommendation:
        'Adopt a standard type scale (e.g., Major Third 1.25x or Perfect Fourth 1.333x).',
    });
  }

  return makeResult(
    'typeScaleAdherence',
    'Type Scale Adherence',
    'typography',
    bestScore,
    findings,
    {
      bestScale,
      distinctSizes: sizes.length,
      sizes,
    }
  );
};

export const fontWeightConsistency: MetricFunction = (elements) => {
  const weights = new Set<string>();

  for (const el of elements) {
    if (el.styles.fontWeight) weights.add(el.styles.fontWeight);
  }

  const count = weights.size;
  const findings: MetricFinding[] = [];

  let score: number;
  if (count >= 2 && count <= 3) {
    score = 100;
  } else if (count === 1) {
    score = 70;
    findings.push({
      severity: 'info',
      message: 'Only one font weight used. Consider adding a bold weight for hierarchy.',
      recommendation: 'Use 2-3 font weights (e.g., 400 regular, 600 semi-bold, 700 bold).',
    });
  } else if (count === 4) {
    score = 80;
  } else {
    score = Math.max(0, 100 - (count - 3) * 20);
    findings.push({
      severity: 'warning',
      message: `${count} different font weights used. Too many weights reduce visual consistency.`,
      recommendation: 'Limit to 2-3 font weights for a cleaner hierarchy.',
    });
  }

  return makeResult(
    'fontWeightConsistency',
    'Font Weight Consistency',
    'typography',
    score,
    findings,
    {
      count,
      weights: [...weights],
    }
  );
};

export const headingHierarchy: MetricFunction = (elements) => {
  // Find heading elements
  const headings: Array<{ level: number; fontSize: number; elementId: string }> = [];

  for (const el of elements) {
    const type = el.type.toLowerCase();
    let level = 0;

    if (type === 'heading' || type.startsWith('h')) {
      const match = type.match(/h(\d)/);
      if (match) level = parseInt(match[1], 10);
    }
    // Also check by id pattern
    if (level === 0 && el.elementId) {
      const match = el.elementId.match(/h(\d)/i);
      if (match) level = parseInt(match[1], 10);
    }

    if (level >= 1 && level <= 6) {
      headings.push({ level, fontSize: parsePx(el.styles.fontSize), elementId: el.elementId });
    }
  }

  if (headings.length < 2)
    return makeResult('headingHierarchy', 'Heading Hierarchy', 'typography', 100, []);

  // Sort by level
  const sorted = [...headings].sort((a, b) => a.level - b.level);
  let checks = 0;
  let passing = 0;
  const issues: string[] = [];

  // Check: higher level = larger font
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].level > sorted[i - 1].level) {
      checks++;
      if (sorted[i].fontSize < sorted[i - 1].fontSize) {
        passing++;
      } else {
        issues.push(
          `h${sorted[i].level} (${sorted[i].fontSize}px) is not smaller than h${sorted[i - 1].level} (${sorted[i - 1].fontSize}px)`
        );
      }
    }
  }

  // Check: no skipped levels
  const levels = [...new Set(headings.map((h) => h.level))].sort();
  for (let i = 1; i < levels.length; i++) {
    checks++;
    if (levels[i] - levels[i - 1] === 1) {
      passing++;
    } else {
      issues.push(`Skipped heading level: h${levels[i - 1]} to h${levels[i]}`);
    }
  }

  const score = checks > 0 ? (passing / checks) * 100 : 100;
  const findings: MetricFinding[] = [];

  if (issues.length > 0) {
    findings.push({
      severity: 'warning',
      message: `Heading hierarchy issues: ${issues.join('; ')}.`,
      recommendation: 'Ensure heading sizes decrease with level and no levels are skipped.',
    });
  }

  return makeResult('headingHierarchy', 'Heading Hierarchy', 'typography', score, findings, {
    headingCount: headings.length,
    levels,
  });
};

export const fontFamilyCount: MetricFunction = (elements) => {
  const families = new Set<string>();

  for (const el of elements) {
    if (el.styles.fontFamily) {
      // Normalize: take first family in stack, strip quotes
      const first = el.styles.fontFamily.split(',')[0].trim().replace(/["']/g, '').toLowerCase();
      if (first) families.add(first);
    }
  }

  const count = families.size;
  const findings: MetricFinding[] = [];

  let score: number;
  if (count >= 1 && count <= 2) {
    score = 100;
  } else if (count === 3) {
    score = 75;
    findings.push({
      severity: 'info',
      message: `3 font families used (${[...families].join(', ')}). Consider reducing to 2.`,
      recommendation: 'Use one font for body text and optionally one for headings.',
    });
  } else if (count === 0) {
    score = 80;
  } else {
    score = Math.max(0, 100 - (count - 2) * 25);
    findings.push({
      severity: 'warning',
      message: `${count} font families used. Too many fonts reduce visual coherence.`,
      recommendation: 'Limit to 1-2 font families.',
    });
  }

  return makeResult('fontFamilyCount', 'Font Family Count', 'typography', score, findings, {
    count,
    families: [...families],
  });
};

// ============================================================================
// Consistency (4 metrics)
// ============================================================================

function computeConsistencyScore(
  elements: ElementDesignData[],
  getValues: (el: ElementDesignData) => number[]
): { score: number; cv: number } {
  if (elements.length < 2) return { score: 100, cv: 0 };

  const allValues = elements.map(getValues);
  const numProps = allValues[0]?.length ?? 0;
  if (numProps === 0) return { score: 100, cv: 0 };

  const cvs: number[] = [];
  for (let p = 0; p < numProps; p++) {
    const vals = allValues.map((v) => v[p]).filter((v) => v > 0);
    if (vals.length >= 2) cvs.push(coefficientOfVariation(vals));
  }

  if (cvs.length === 0) return { score: 100, cv: 0 };

  const avgCv = cvs.reduce((s, v) => s + v, 0) / cvs.length;
  return { score: Math.max(0, 100 - avgCv * 200), cv: avgCv };
}

export const buttonConsistency: MetricFunction = (elements) => {
  const buttons = elements.filter((el) => {
    const t = el.type.toLowerCase();
    return t === 'button' || t === 'pressable';
  });

  if (buttons.length < 2)
    return makeResult('buttonConsistency', 'Button Consistency', 'consistency', 100, []);

  const { score, cv } = computeConsistencyScore(buttons, (el) => [
    parsePx(el.styles.height),
    parsePx(el.styles.paddingTop) + parsePx(el.styles.paddingBottom),
    parsePx(el.styles.paddingLeft) + parsePx(el.styles.paddingRight),
    parsePx(el.styles.borderRadius),
    parsePx(el.styles.fontSize),
  ]);

  const findings: MetricFinding[] = [];
  if (score < 70) {
    findings.push({
      severity: 'warning',
      message: `Buttons have inconsistent styling (CV=${cv.toFixed(2)}).`,
      recommendation: 'Standardize button height, padding, border-radius, and font-size.',
      elementIds: buttons.map((el) => el.elementId).slice(0, 10),
    });
  }

  return makeResult('buttonConsistency', 'Button Consistency', 'consistency', score, findings, {
    buttonCount: buttons.length,
    cv,
  });
};

export const cardConsistency: MetricFunction = (elements) => {
  // Heuristic: elements with background + borderRadius + padding + area > 100x80
  const cards = elements.filter((el) => {
    const hasBg = parseColor(el.styles.backgroundColor) !== null;
    const hasRadius = parsePx(el.styles.borderRadius) > 0;
    const hasPadding = parsePx(el.styles.paddingTop) > 0 || parsePx(el.styles.paddingLeft) > 0;
    const largeEnough = el.rect.width >= 100 && el.rect.height >= 80;
    return hasBg && hasRadius && hasPadding && largeEnough;
  });

  if (cards.length < 2)
    return makeResult('cardConsistency', 'Card Consistency', 'consistency', 100, []);

  const { score, cv } = computeConsistencyScore(cards, (el) => [
    parsePx(el.styles.borderRadius),
    parsePx(el.styles.paddingTop),
    parsePx(el.styles.paddingLeft),
    el.rect.width,
  ]);

  const findings: MetricFinding[] = [];
  if (score < 70) {
    findings.push({
      severity: 'warning',
      message: `Card-like elements have inconsistent styling (CV=${cv.toFixed(2)}).`,
      recommendation: 'Standardize border-radius, padding, and width for card components.',
      elementIds: cards.map((el) => el.elementId).slice(0, 10),
    });
  }

  return makeResult('cardConsistency', 'Card Consistency', 'consistency', score, findings, {
    cardCount: cards.length,
    cv,
  });
};

export const inputConsistency: MetricFunction = (elements) => {
  const inputs = elements.filter((el) => {
    const t = el.type.toLowerCase();
    return t === 'input' || t === 'textarea' || t === 'select';
  });

  if (inputs.length < 2)
    return makeResult('inputConsistency', 'Input Consistency', 'consistency', 100, []);

  const { score, cv } = computeConsistencyScore(inputs, (el) => [
    parsePx(el.styles.height),
    parsePx(el.styles.paddingTop) + parsePx(el.styles.paddingBottom),
    parsePx(el.styles.paddingLeft) + parsePx(el.styles.paddingRight),
    parsePx(el.styles.borderRadius),
    parsePx(el.styles.fontSize),
  ]);

  const findings: MetricFinding[] = [];
  if (score < 70) {
    findings.push({
      severity: 'warning',
      message: `Input fields have inconsistent styling (CV=${cv.toFixed(2)}).`,
      recommendation: 'Standardize input height, padding, border-radius, and font-size.',
      elementIds: inputs.map((el) => el.elementId).slice(0, 10),
    });
  }

  return makeResult('inputConsistency', 'Input Consistency', 'consistency', score, findings, {
    inputCount: inputs.length,
    cv,
  });
};

export const touchTargetCompliance: MetricFunction = (elements) => {
  const interactive = elements.filter(isInteractive);

  if (interactive.length === 0)
    return makeResult('touchTargetCompliance', 'Touch Target Compliance', 'consistency', 100, []);

  const minSize = 44; // WCAG 2.5.8 minimum
  let compliant = 0;
  const failingElements: string[] = [];

  for (const el of interactive) {
    if (el.rect.width >= minSize && el.rect.height >= minSize) {
      compliant++;
    } else {
      failingElements.push(el.elementId);
    }
  }

  const score = (compliant / interactive.length) * 100;
  const findings: MetricFinding[] = [];

  if (failingElements.length > 0) {
    findings.push({
      severity: 'error',
      message: `${failingElements.length} interactive elements are smaller than ${minSize}x${minSize}px.`,
      recommendation: `Ensure all interactive elements are at least ${minSize}x${minSize}px for accessibility.`,
      elementIds: failingElements.slice(0, 10),
    });
  }

  return makeResult(
    'touchTargetCompliance',
    'Touch Target Compliance',
    'consistency',
    score,
    findings,
    {
      total: interactive.length,
      compliant,
    }
  );
};

// ============================================================================
// Metric Registry
// ============================================================================

export const METRIC_FUNCTIONS: Record<QualityMetricId, MetricFunction> = {
  // Density
  elementDensity,
  whitespaceRatio,
  localDensityBalance,
  horizontalBalance,
  verticalBalance,
  alignmentConsistency,
  // Spacing
  spacingScaleAdherence,
  spacingConsistency,
  lineHeightRatio,
  interGroupSpacingRatio,
  // Color
  uniqueColorCount,
  wcagContrastCompliance,
  colorHarmony,
  saturationConsistency,
  // Typography
  typeScaleAdherence,
  fontWeightConsistency,
  headingHierarchy,
  fontFamilyCount,
  // Consistency
  buttonConsistency,
  cardConsistency,
  inputConsistency,
  touchTargetCompliance,
};
