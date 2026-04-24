/**
 * Tests for classString / classList helpers — the SVG-safe accessor for
 * `Element.className`. See `src/core/class-name.ts` for motivation.
 */

import { describe, it, expect } from 'vitest';
import { classString, classList } from '../class-name';

describe('classString', () => {
  it('returns empty string for null', () => {
    expect(classString(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(classString(undefined)).toBe('');
  });

  it('returns the string className for HTML elements', () => {
    const el = document.createElement('div');
    el.className = 'foo bar baz';
    expect(classString(el)).toBe('foo bar baz');
  });

  it('returns "" for HTML element with no className set', () => {
    const el = document.createElement('div');
    expect(classString(el)).toBe('');
  });

  it('returns baseVal for SVG elements', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    // Use setAttribute because direct .className = assignment on SVG sets the
    // SVGAnimatedString's baseVal but some jsdom versions are finicky.
    svg.setAttribute('class', 'icon icon-home');
    expect(classString(svg)).toBe('icon icon-home');
  });

  it('returns "" for SVG element with no class attribute', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    expect(classString(svg)).toBe('');
  });

  it('does NOT throw when called on SVG (regression guard)', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    svg.setAttribute('class', 'pulse');
    // Raw `.className.split` would throw on SVG — our helper must not.
    expect(() => classString(svg).split(/\s+/)).not.toThrow();
  });
});

describe('classList', () => {
  it('returns [] for null/undefined', () => {
    expect(classList(null)).toEqual([]);
    expect(classList(undefined)).toEqual([]);
  });

  it('returns [] for element with no className', () => {
    const el = document.createElement('div');
    expect(classList(el)).toEqual([]);
  });

  it('splits HTML className on whitespace', () => {
    const el = document.createElement('div');
    el.className = 'foo bar  baz';
    expect(classList(el)).toEqual(['foo', 'bar', 'baz']);
  });

  it('splits SVG className (baseVal) on whitespace', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'icon icon-home pulse');
    expect(classList(svg)).toEqual(['icon', 'icon-home', 'pulse']);
  });

  it('filters empty tokens from leading/trailing whitespace', () => {
    const el = document.createElement('div');
    el.className = '  foo  bar  ';
    expect(classList(el)).toEqual(['foo', 'bar']);
  });
});
