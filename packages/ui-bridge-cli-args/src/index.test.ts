import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  ArgReader,
  consumeValue,
  makeLogger,
  rejectEmptyValue,
  COMMON_FLAGS,
  type ArgErrorFactory,
} from './index.js';

// A bin's domain error is constructed via a factory so thrown errors keep the
// bin's specific type. The tests use a plain Error factory.
class TestArgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TestArgError';
  }
}
const mkError: ArgErrorFactory = (m) => new TestArgError(m);

const KNOWN = new Set(['--url', '--success', '--headed', '--keep-open', ...COMMON_FLAGS]);

describe('ArgReader.value', () => {
  it('returns the value after a value-flag', () => {
    const r = new ArgReader(['--url', 'https://x', '--success', '/dash'], KNOWN, mkError);
    expect(r.value('--url')).toBe('https://x');
    expect(r.value('--success')).toBe('/dash');
  });

  it('returns null when the flag is absent', () => {
    const r = new ArgReader(['--headed'], KNOWN, mkError);
    expect(r.value('--url')).toBeNull();
  });

  it('returns null when the value-flag is the last token (no following value)', () => {
    const r = new ArgReader(['--headed', '--success'], KNOWN, mkError);
    expect(r.value('--success')).toBeNull();
  });

  it('THROWS when a value-flag is followed by another flag (the swallow fix)', () => {
    const r = new ArgReader(['--success', '--headed'], KNOWN, mkError);
    expect(() => r.value('--success')).toThrow(TestArgError);
    expect(() => r.value('--success')).toThrow(/--success expects a value but got the flag '--headed'/);
  });

  it('does NOT treat a single-dash / negative value as flag-shaped', () => {
    const known = new Set(['--n', ...COMMON_FLAGS]);
    const r = new ArgReader(['--n', '-1'], known, mkError);
    expect(r.value('--n')).toBe('-1');
  });
});

describe('ArgReader.has / unknown-flag rejection', () => {
  it('reports bare boolean flags', () => {
    const r = new ArgReader(['--headed', '--keep-open'], KNOWN, mkError);
    expect(r.has('--headed')).toBe(true);
    expect(r.has('--keep-open')).toBe(true);
    expect(r.has('--quiet')).toBe(false);
  });

  it('rejects an unknown flag up front (in the constructor)', () => {
    expect(() => new ArgReader(['--bogus'], KNOWN, mkError)).toThrow(/Unknown flag: --bogus/);
  });

  it('accepts the COMMON_FLAGS (--help / -h / --quiet) without the bin listing them', () => {
    expect(() => new ArgReader(['--help', '-h', '--quiet'], KNOWN, mkError)).not.toThrow();
  });
});

describe('consumeValue (switch-parser guard)', () => {
  it('returns the value when not flag-shaped', () => {
    expect(consumeValue('--url', 'https://x', mkError)).toBe('https://x');
  });

  it('returns null when the value is absent (end of argv)', () => {
    expect(consumeValue('--url', undefined, mkError)).toBeNull();
  });

  it('THROWS when the consumed value is flag-shaped', () => {
    expect(() => consumeValue('--url', '--headed', mkError)).toThrow(TestArgError);
    expect(() => consumeValue('--url', '--headed', mkError)).toThrow(
      /--url expects a value but got the flag '--headed'/
    );
  });

  it('does NOT treat a single-dash / negative value as flag-shaped', () => {
    expect(consumeValue('--n', '-1', mkError)).toBe('-1');
  });
});

describe('rejectEmptyValue (present-but-empty guard)', () => {
  it('passes a non-empty value through', () => {
    expect(rejectEmptyValue('--success', '/dashboard', mkError)).toBe('/dashboard');
  });

  it('passes null (flag absent — caller defaults) through', () => {
    expect(rejectEmptyValue('--success', null, mkError)).toBeNull();
  });

  it('THROWS on an empty value (the false-success hole)', () => {
    expect(() => rejectEmptyValue('--success', '', mkError)).toThrow(TestArgError);
    expect(() => rejectEmptyValue('--success', '', mkError)).toThrow(
      /--success was given an empty value/
    );
  });

  it('THROWS on a whitespace-only value', () => {
    expect(() => rejectEmptyValue('--success', '   ', mkError)).toThrow(TestArgError);
  });
});

describe('makeLogger', () => {
  afterEach(() => vi.restoreAllMocks());

  it('writes "<prefix> <message>" to stderr when not quiet', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    makeLogger('[x]', false)('hi');
    expect(spy).toHaveBeenCalledWith('[x] hi\n');
  });

  it('writes just the message when prefix is empty', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    makeLogger('', false)('hi');
    expect(spy).toHaveBeenCalledWith('hi\n');
  });

  it('drops every line when quiet', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    makeLogger('[x]', true)('hi');
    expect(spy).not.toHaveBeenCalled();
  });
});
