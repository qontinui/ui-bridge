/**
 * Format Analysis
 *
 * Analyzes the display format of data values and detects
 * format mismatches between source and target pages.
 */

import type { AIDiscoveredElement, DataType, FormatDescriptor, FormatMismatch } from './types';
import { classifyDataType } from './data-extraction';

export interface FormatAnalysisConfig {
  /** Treat minor format differences (e.g., comma vs period for thousands) as warnings rather than errors */
  lenientFormatting: boolean;
}

export const DEFAULT_FORMAT_ANALYSIS_CONFIG: FormatAnalysisConfig = {
  lenientFormatting: true,
};

/**
 * Detect the format pattern of a value.
 */
export function detectFormatPattern(value: string, dataType: DataType): string {
  const trimmed = value.trim();

  switch (dataType) {
    case 'currency': {
      // Detect currency symbol position and thousand/decimal separators
      const hasLeadingSymbol = /^[£$€¥₹]/.test(trimmed);
      const hasTrailingSymbol = /[£$€¥₹]$/.test(trimmed);
      const usesCommaThousands = /\d{1,3}(,\d{3})+/.test(trimmed);
      const usesPeriodThousands = /\d{1,3}(\.\d{3})+,/.test(trimmed);

      let pattern = hasLeadingSymbol ? '$' : '';
      if (usesCommaThousands) pattern += '#,###';
      else if (usesPeriodThousands) pattern += '#.###';
      else pattern += '#';

      if (/\.\d{2}$/.test(trimmed)) pattern += '.##';
      else if (/,\d{2}$/.test(trimmed)) pattern += ',##';

      if (hasTrailingSymbol) pattern += '$';
      return pattern;
    }

    case 'date': {
      if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return 'YYYY-MM-DD';
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) return 'MM/DD/YYYY';
      if (/^\d{2}\.\d{2}\.\d{4}$/.test(trimmed)) return 'DD.MM.YYYY';
      if (/^\d{1,2}\/\d{1,2}\/\d{2}$/.test(trimmed)) return 'M/D/YY';
      if (/^\w{3,9}\s+\d{1,2},?\s+\d{4}$/.test(trimmed)) return 'Month DD, YYYY';
      return 'date';
    }

    case 'percentage':
      return /\s%$/.test(trimmed) ? '#.## %' : '#.##%';

    case 'number': {
      const hasCommas = /,/.test(trimmed);
      const decimalPlaces = trimmed.includes('.') ? trimmed.split('.')[1]?.length || 0 : 0;
      return (
        (hasCommas ? '#,###' : '#') + (decimalPlaces > 0 ? '.' + '#'.repeat(decimalPlaces) : '')
      );
    }

    case 'phone': {
      // Detect phone format
      if (/^\(\d{3}\)\s?\d{3}-\d{4}$/.test(trimmed)) return '(###) ###-####';
      if (/^\d{3}-\d{3}-\d{4}$/.test(trimmed)) return '###-###-####';
      if (/^\+\d/.test(trimmed)) return '+# ###...';
      return 'phone';
    }

    default:
      return dataType;
  }
}

/**
 * Analyze format of a single element's value.
 */
export function analyzeFormat(
  elementId: string,
  label: string,
  rawValue: string
): FormatDescriptor {
  const { type: dataType } = classifyDataType(rawValue);
  const pattern = detectFormatPattern(rawValue, dataType);

  return {
    elementId,
    label,
    dataType,
    pattern,
    example: rawValue.trim(),
  };
}

/**
 * Analyze formats for all data-bearing elements on a page.
 */
export function analyzePageFormats(elements: AIDiscoveredElement[]): FormatDescriptor[] {
  const descriptors: FormatDescriptor[] = [];

  for (const el of elements) {
    const rawValue = el.state?.value ?? el.state?.textContent ?? '';
    if (!rawValue) continue;

    const label = el.accessibleName || el.labelText || el.label || el.description || el.id;
    descriptors.push(analyzeFormat(el.id, label, rawValue));
  }

  return descriptors;
}

/**
 * Compare formats between source and target descriptors with matching labels.
 */
export function compareFormats(
  sourceFormats: FormatDescriptor[],
  targetFormats: FormatDescriptor[],
  config: FormatAnalysisConfig = DEFAULT_FORMAT_ANALYSIS_CONFIG
): FormatMismatch[] {
  const mismatches: FormatMismatch[] = [];

  // Index target by label
  const targetByLabel = new Map<string, FormatDescriptor>();
  for (const t of targetFormats) {
    targetByLabel.set(t.label.toLowerCase(), t);
  }

  for (const source of sourceFormats) {
    const target = targetByLabel.get(source.label.toLowerCase());
    if (!target) continue; // No matching field in target

    // Same data type?
    if (source.dataType !== target.dataType) {
      mismatches.push({
        label: source.label,
        sourceFormat: source,
        targetFormat: target,
        severity: 'error',
        description: `Data type mismatch: source is ${source.dataType}, target is ${target.dataType}`,
      });
      continue;
    }

    // Same pattern?
    if (source.pattern !== target.pattern) {
      const severity = config.lenientFormatting ? 'warning' : 'error';
      mismatches.push({
        label: source.label,
        sourceFormat: source,
        targetFormat: target,
        severity,
        description: `Format differs: source uses "${source.pattern}", target uses "${target.pattern}"`,
      });
    }
  }

  return mismatches;
}
