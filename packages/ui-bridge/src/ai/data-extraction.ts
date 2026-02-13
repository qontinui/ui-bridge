/**
 * Data Extraction
 *
 * Extracts labeled data values from page elements, classifies their types,
 * and normalizes values for cross-app comparison.
 */

import type { AIDiscoveredElement, DataType, ExtractedDataValue, PageDataMap } from './types';

export interface DataExtractionConfig {
  /** Minimum confidence to include a value */
  minConfidence: number;
  /** Whether to normalize whitespace */
  normalizeWhitespace: boolean;
}

export const DEFAULT_DATA_EXTRACTION_CONFIG: DataExtractionConfig = {
  minConfidence: 0.3,
  normalizeWhitespace: true,
};

/**
 * Classify the data type of a raw string value.
 */
export function classifyDataType(value: string): { type: DataType; confidence: number } {
  const trimmed = value.trim();
  if (!trimmed) return { type: 'unknown', confidence: 0 };

  // Boolean
  if (/^(true|false|yes|no|on|off)$/i.test(trimmed)) {
    return { type: 'boolean', confidence: 0.95 };
  }

  // Email
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { type: 'email', confidence: 0.95 };
  }

  // URL
  if (/^https?:\/\/\S+/.test(trimmed)) {
    return { type: 'url', confidence: 0.95 };
  }

  // Phone (various formats)
  if (/^[+]?[\d\s\-().]{7,20}$/.test(trimmed) && /\d{3,}/.test(trimmed)) {
    return { type: 'phone', confidence: 0.7 };
  }

  // Currency ($1,234.56 or €1.234,56 etc.)
  if (/^[£$€¥₹][\s]?[\d,.]+$/.test(trimmed) || /^[\d,.]+[\s]?[£$€¥₹]$/.test(trimmed)) {
    return { type: 'currency', confidence: 0.9 };
  }

  // Percentage
  if (/^[\d,.]+\s?%$/.test(trimmed)) {
    return { type: 'percentage', confidence: 0.95 };
  }

  // Date (ISO, US, EU formats)
  if (
    /^\d{4}-\d{2}-\d{2}/.test(trimmed) ||
    /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(trimmed) ||
    /^\d{1,2}\.\d{1,2}\.\d{2,4}$/.test(trimmed) ||
    /^\w{3,9}\s+\d{1,2},?\s+\d{4}$/.test(trimmed)
  ) {
    return { type: 'date', confidence: 0.85 };
  }

  // Number (plain)
  if (/^-?[\d,]+\.?\d*$/.test(trimmed) && trimmed !== '') {
    return { type: 'number', confidence: 0.9 };
  }

  // Default to text
  return { type: 'text', confidence: 0.5 };
}

/**
 * Normalize a value for comparison by stripping formatting differences.
 */
export function normalizeValue(value: string, dataType: DataType): string {
  const trimmed = value.trim();

  switch (dataType) {
    case 'number':
    case 'currency':
    case 'percentage': {
      // Strip currency symbols, commas, percent signs; keep digits and decimal
      const numeric = trimmed.replace(/[^0-9.-]/g, '');
      const parsed = parseFloat(numeric);
      return isNaN(parsed) ? trimmed.toLowerCase() : parsed.toString();
    }
    case 'date': {
      // Try to parse into ISO date for comparison
      const d = new Date(trimmed);
      return isNaN(d.getTime()) ? trimmed.toLowerCase() : d.toISOString().split('T')[0];
    }
    case 'boolean':
      return /^(true|yes|on)$/i.test(trimmed) ? 'true' : 'false';
    case 'email':
      return trimmed.toLowerCase();
    case 'url':
      // Strip trailing slash for comparison
      return trimmed.replace(/\/+$/, '').toLowerCase();
    case 'phone':
      // Keep only digits
      return trimmed.replace(/[^\d+]/g, '');
    default:
      return trimmed.toLowerCase().replace(/\s+/g, ' ');
  }
}

/**
 * Extract the displayable text/value from an element.
 */
function extractElementValue(element: AIDiscoveredElement): string {
  const state = element.state;
  if (state?.value !== undefined && state.value !== '') {
    return String(state.value);
  }
  if (state?.textContent !== undefined && state.textContent !== '') {
    return String(state.textContent);
  }
  return '';
}

/**
 * Extract a label for an element.
 */
function extractLabel(element: AIDiscoveredElement): string {
  return (
    element.accessibleName ||
    element.labelText ||
    element.label ||
    element.description ||
    element.id
  );
}

/**
 * Extract labeled data values from all page elements.
 */
export function extractPageData(
  elements: AIDiscoveredElement[],
  config: DataExtractionConfig = DEFAULT_DATA_EXTRACTION_CONFIG
): PageDataMap {
  const values: Record<string, ExtractedDataValue> = {};
  let extractedCount = 0;

  for (const element of elements) {
    const rawValue = extractElementValue(element);
    if (!rawValue) continue;

    const label = extractLabel(element);
    const { type: dataType, confidence } = classifyDataType(rawValue);

    if (confidence < config.minConfidence) continue;

    const normalizedValue = normalizeValue(rawValue, dataType);

    values[label] = {
      elementId: element.id,
      label,
      rawValue: config.normalizeWhitespace ? rawValue.replace(/\s+/g, ' ').trim() : rawValue,
      normalizedValue,
      dataType,
      confidence,
    };
    extractedCount++;
  }

  return {
    values,
    scannedCount: elements.length,
    extractedCount,
  };
}
