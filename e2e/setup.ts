/**
 * E2E Test Setup
 *
 * This file is run before each test file.
 * It sets up global polyfills and mocks needed for jsdom testing.
 */

// Polyfill CSS.escape for jsdom
if (typeof CSS === 'undefined') {
  (globalThis as unknown as { CSS: typeof CSS }).CSS = {} as typeof CSS;
}

if (typeof CSS.escape !== 'function') {
  CSS.escape = function (value: string): string {
    if (arguments.length === 0) {
      throw new TypeError('`CSS.escape` requires an argument.');
    }
    const string = String(value);
    const length = string.length;
    let index = -1;
    let codeUnit: number;
    let result = '';
    const firstCodeUnit = string.charCodeAt(0);

    if (length === 1 && firstCodeUnit === 0x002d) {
      return '\\' + string;
    }

    while (++index < length) {
      codeUnit = string.charCodeAt(index);

      if (codeUnit === 0x0000) {
        result += '\uFFFD';
        continue;
      }

      if (
        (codeUnit >= 0x0001 && codeUnit <= 0x001f) ||
        codeUnit === 0x007f ||
        (index === 0 && codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
        (index === 1 && codeUnit >= 0x0030 && codeUnit <= 0x0039 && firstCodeUnit === 0x002d)
      ) {
        result += '\\' + codeUnit.toString(16) + ' ';
        continue;
      }

      if (
        codeUnit >= 0x0080 ||
        codeUnit === 0x002d ||
        codeUnit === 0x005f ||
        (codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
        (codeUnit >= 0x0041 && codeUnit <= 0x005a) ||
        (codeUnit >= 0x0061 && codeUnit <= 0x007a)
      ) {
        result += string.charAt(index);
        continue;
      }

      result += '\\' + string.charAt(index);
    }

    return result;
  };
}

// Mock performance.now for consistency
if (typeof performance === 'undefined') {
  (globalThis as unknown as { performance: Performance }).performance = {
    now: () => Date.now(),
  } as Performance;
}
