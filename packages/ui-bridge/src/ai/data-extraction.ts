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
 * How a numeric string was written: the value it denotes and the separators
 * that wrote it. `thousands` and `decimal` are `null` when the text uses none.
 */
export interface NumberForm {
  value: number;
  thousands: ',' | '.' | null;
  decimal: ',' | '.' | null;
  /** Digits after the decimal separator (0 without one). */
  decimals: number;
}

/**
 * Read a bare numeric string (no currency symbol, no percent sign) in any of
 * the forms pages write numbers in:
 *
 *  - plain digits with an optional leading `-` (`42`, `-3`);
 *  - a `.` decimal with optional `,` thousands (`1,234.56`, `123456.78`);
 *  - a `,` decimal with optional `.` thousands (`1.234,56`, `1234,56`, `12,5`).
 *
 * Two single-separator forms are ambiguous, and keep the reading they always
 * had: a lone `,` followed by exactly three digits is a thousands separator
 * (`1,234` is 1234), and a lone `.` is a decimal point (`1.234` is 1.234).
 *
 * Returns `null` for anything else. Shared by `classifyDataType`,
 * `normalizeValue` and `detectFormatPattern`; it is not part of the package's
 * public surface (`ai/index.ts` does not re-export it).
 */
export function parseNumberForm(text: string): NumberForm | null {
  // A bare leading decimal point ($.99, .5%) is the fraction of zero.
  const bare = /^(-?)\.(\d+)$/.exec(text);
  if (bare) {
    const value = Number(`${bare[1]}0.${bare[2]}`);
    return { value, thousands: null, decimal: '.', decimals: bare[2].length };
  }

  const m = /^(-?)(\d[\d.,]*)$/.exec(text);
  if (!m) return null;
  const sign = m[1];
  const body = m[2];

  const read = (
    intPart: string,
    fraction: string,
    thousands: NumberForm['thousands'],
    decimal: NumberForm['decimal']
  ): NumberForm => {
    const digits = thousands ? intPart.split(thousands).join('') : intPart;
    const value = Number(`${sign}${digits}${fraction ? `.${fraction}` : ''}`);
    return { value, thousands, decimal, decimals: fraction.length };
  };

  // 15 significant digits is the most a double is guaranteed to round-trip.
  // Past that, two different long ids may read as one number, so such a run
  // is no number.
  if (body.replace(/\D/g, '').length > 15) return null;

  // A run of six or more digits with a leading zero before another digit
  // (0301234567, 0001234567) is an id or a phone, not a number: reading it as
  // one would drop the zeros and merge distinct ids. A short zero-padded
  // value (05, 007, $05.00) is still a number.
  if (/^0\d/.test(body) && body.replace(/\D/g, '').length >= 6) return null;

  // Plain digits.
  if (/^\d+$/.test(body)) return read(body, '', null, null);

  // A lone `,` before exactly three digits: a thousands separator (`0,123`
  // has no thousands and reads as a decimal comma below).
  let f = /^([1-9]\d*),(\d{3})$/.exec(body);
  if (f) return read(`${f[1]},${f[2]}`, '', ',', null);

  // A lone `.`: a decimal point.
  f = /^(\d+)\.(\d+)$/.exec(body);
  if (f) return read(f[1], f[2], null, '.');

  // `,` thousands, optional `.` decimal: 1,234,567 / 1,234.56.
  f = /^([1-9]\d{0,2}(?:,\d{3})+)(?:\.(\d+))?$/.exec(body);
  if (f) return read(f[1], f[2] ?? '', ',', f[2] !== undefined ? '.' : null);

  // Indian (lakh) grouping, optional `.` decimal: 1,23,456 / 12,34,567.50.
  f = /^([1-9]\d?(?:,\d{2})+,\d{3})(?:\.(\d+))?$/.exec(body);
  if (f) return read(f[1], f[2] ?? '', ',', f[2] !== undefined ? '.' : null);

  // `.` thousands, optional `,` decimal: 1.234.567 / 1.234,56.
  f = /^([1-9]\d{0,2}(?:\.\d{3})+)(?:,(\d+))?$/.exec(body);
  if (f) return read(f[1], f[2] ?? '', '.', f[2] !== undefined ? ',' : null);

  // A `,` decimal with no thousands: 1234,56 / 12,5.
  f = /^(\d+),(\d+)$/.exec(body);
  if (f) return read(f[1], f[2], null, ',');

  return null;
}

/** A leading symbol, optionally after a minus sign: $5, € 12,50, -$5.00. */
const LEADING_CURRENCY = /^(-?)\s?[£$€¥₹]\s?(.+)$/;
const TRAILING_CURRENCY = /^(.+?)\s?[£$€¥₹]$/;
const PERCENTAGE = /^(.+?)\s?%$/;

/** The numeric body of a currency amount, or `null` when it is not one. */
function currencyBody(text: string): string | null {
  const lead = LEADING_CURRENCY.exec(text);
  if (lead && !lead[2].startsWith('-') && parseNumberForm(lead[2])) return lead[1] + lead[2];
  if (lead && !lead[1] && parseNumberForm(lead[2])) return lead[2];
  const trail = TRAILING_CURRENCY.exec(text);
  if (trail && parseNumberForm(trail[1])) return trail[1];
  return null;
}

/** The numeric body of a percentage, or `null` when it is not one. */
function percentageBody(text: string): string | null {
  const m = PERCENTAGE.exec(text);
  return m && parseNumberForm(m[1]) ? m[1] : null;
}

/**
 * ISO date, optionally followed by a time: 2026-10-16, 2026-10-16T08:00. The
 * normal form is the calendar date AS WRITTEN: an offset in a following time
 * is not applied, so 2026-10-16T23:30:00-05:00 normalises to 2026-10-16, not
 * to the UTC date. A page shows the date its author meant, and that is what a
 * cross-app comparison must compare. Anchored at both ends, so an id that only
 * begins with a date (2024-01-15-0042) is not one.
 */
const ISO_DATE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:\s?[AaPp][Mm])?(?:\s?(?:Z|[A-Z]{2,5}|[+-]\d{2}:?\d{2}))?)?$/;
/** Slash form, read month first (`MM/DD/YYYY`, as `detectFormatPattern` names it). */
const SLASH_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/;
/** Dotted form, day first: 16.10.2026. */
const DOTTED_DATE = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/;
/** Hyphenated form, day first: 16-10-2026. */
const HYPHEN_DATE = /^(\d{1,2})-(\d{1,2})-(\d{4})$/;
/**
 * Month-name form: Oct 16, 2026 / October 16 2026. Letters only, so a spaced
 * digit run such as `555 12 1234` stays a phone.
 */
const MONTH_NAME_DATE = /^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/;

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/**
 * 0-based month for an English month name, or for an abbreviation of at least
 * three letters that begins exactly one month name (`Oct`, `Sept`); -1 otherwise.
 */
function monthIndex(name: string): number {
  const lower = name.toLowerCase();
  if (lower.length < 3) return -1;
  const matches = MONTH_NAMES.filter((n) => n.startsWith(lower));
  return matches.length === 1 ? MONTH_NAMES.indexOf(matches[0]) : -1;
}

/**
 * A two-digit year read the way the legacy `Date` parser read it, which is
 * what this normaliser replaced: 00-49 is 20xx, 50-99 is 19xx. Any length
 * other than two or four is no year.
 */
function fullYear(digits: string): number | null {
  if (digits.length === 4) return Number(digits);
  if (digits.length !== 2) return null;
  const yy = Number(digits);
  return yy < 50 ? 2000 + yy : 1900 + yy;
}

/**
 * A value is a date exactly when its normal form can be built: a recognised
 * form that names a real calendar day. So the classifier and `normalizeValue`
 * never disagree, and digit groups that only look like a date (`31.02.2026`,
 * `2026-13-45`, `12-34-5678`) fall through to the number and phone branches.
 */
function isDateShaped(text: string): boolean {
  return isoDateFromParts(text) !== null;
}

/**
 * The day-first hyphen form overlaps phone shapes (`11-12-2345`), so its year
 * must be a plausible calendar year.
 */
const HYPHEN_YEAR_MIN = 1900;
const HYPHEN_YEAR_MAX = 2199;

/**
 * `YYYY-MM-DD` built from the parts of a recognised date form, with no `Date`
 * parse of the text (which reads local time and shifts the day east of UTC).
 * `null` when the form is not recognised or names no real calendar day.
 */
function isoDateFromParts(text: string): string | null {
  let year: number | null;
  let month: number;
  let day: number;
  let m: RegExpExecArray | null;

  if ((m = ISO_DATE.exec(text))) {
    [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else if ((m = DOTTED_DATE.exec(text))) {
    [day, month, year] = [Number(m[1]), Number(m[2]), fullYear(m[3])];
  } else if ((m = HYPHEN_DATE.exec(text))) {
    [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (year < HYPHEN_YEAR_MIN || year > HYPHEN_YEAR_MAX) return null;
  } else if ((m = SLASH_DATE.exec(text))) {
    // Month first, unless the first field cannot be a month and the second
    // can: 25/12/2026 has only the day-first reading.
    const [a, b] = [Number(m[1]), Number(m[2])];
    [month, day] = a > 12 && b <= 12 ? [b, a] : [a, b];
    year = fullYear(m[3]);
  } else if ((m = MONTH_NAME_DATE.exec(text))) {
    const index = monthIndex(m[1]);
    if (index < 0) return null;
    [month, day, year] = [index + 1, Number(m[2]), Number(m[3])];
  } else {
    return null;
  }

  if (year === null || month < 1 || month > 12 || day < 1) return null;
  // Day 0 of the next month is the last day of this one.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > lastDay) return null;

  const pad = (n: number, width: number) => String(n).padStart(width, '0');
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/**
 * A phone number is digits with an optional leading `+` and spaces, hyphens,
 * parentheses or dots between them, holding 7 to 15 digits (`+49 30 1234567`,
 * `(555) 123-4567`, `555.123.4567`). The branch runs after the number and date
 * branches, so bare digits (`1234567`) and every number form (`123456.78`)
 * have already been claimed as numbers, and dotted dates as dates.
 */
function isPhoneShaped(text: string): boolean {
  if (!/^\+?[\d\s\-().]+$/.test(text)) return false;
  const digits = text.replace(/\D/g, '').length;
  return digits >= 7 && digits <= 15;
}

/**
 * Classify the data type of a raw string value.
 *
 * The branches run in a fixed order, and a value takes the first that claims
 * it: boolean, email, URL, currency, percentage, date, number, phone, text.
 * A value is a phone only when nothing earlier claimed it.
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

  // Currency ($1,234.56, € 12,50, 1.234,56 € ...)
  if (currencyBody(trimmed) !== null) {
    return { type: 'currency', confidence: 0.9 };
  }

  // Percentage (50%, 12,5 %)
  if (percentageBody(trimmed) !== null) {
    return { type: 'percentage', confidence: 0.95 };
  }

  // Date (ISO, US slash, day-first dotted and hyphenated, month name)
  if (isDateShaped(trimmed)) {
    return { type: 'date', confidence: 0.85 };
  }

  // Number (plain, either decimal separator)
  if (parseNumberForm(trimmed)) {
    return { type: 'number', confidence: 0.9 };
  }

  // Phone
  if (isPhoneShaped(trimmed)) {
    return { type: 'phone', confidence: 0.7 };
  }

  // Default to text
  return { type: 'text', confidence: 0.5 };
}

/** The first digit run in free text, signed by any minus sign before it. */
function firstNumericRun(text: string): string {
  const run = /\d[\d.,]*/.exec(text);
  if (!run) return '';
  // Only a minus sign directly before the run (spaces allowed) negates it, so
  // `Year-to-date 1,234` stays positive.
  const sign = /(?:^|[^\w])[-−]\s*$/.test(text.slice(0, run.index)) ? '-' : '';
  return sign + run[0].replace(/[.,]+$/, '');
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
      // Read the numeric body in whichever decimal convention it was written.
      // A caller may pass a type for text it classified itself (`approx. 5`,
      // `1,234 (est.)`, `- 5`): read the first numeric run in it, without
      // trailing separators, negative when a minus sign comes before it.
      const body =
        currencyBody(trimmed) ??
        percentageBody(trimmed) ??
        (parseNumberForm(trimmed) ? trimmed : firstNumericRun(trimmed));
      const form = parseNumberForm(body);
      return form ? form.value.toString() : trimmed.toLowerCase();
    }
    case 'date':
      return isoDateFromParts(trimmed) ?? trimmed.toLowerCase();
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
