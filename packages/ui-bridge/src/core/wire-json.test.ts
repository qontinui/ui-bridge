/**
 * `safeJsonStringify` — the one wire serializer. A TRUE cycle is cut; a
 * SHARED reference is written in full. The three copies it replaced cut every
 * second appearance of an object, so a media row's top-level observation (the
 * same object as `state.mediaMetadata`) reached the relay as "[Circular]".
 */

import { describe, it, expect } from 'vitest';
import { safeJsonStringify } from './wire-json';

describe('safeJsonStringify', () => {
  it('writes a shared (non-cyclic) object in full every time it appears', () => {
    const observation = { status: 'measured', value: { src: '/a.png' } };
    const row = { state: { mediaMetadata: observation }, mediaMetadata: observation };

    expect(JSON.parse(safeJsonStringify({ elements: [row, row] }))).toEqual({
      elements: [
        { state: { mediaMetadata: observation }, mediaMetadata: observation },
        { state: { mediaMetadata: observation }, mediaMetadata: observation },
      ],
    });
  });

  it('cuts a true cycle — an object reached again from inside itself', () => {
    const node: { name: string; self?: unknown; children: unknown[] } = { name: 'a', children: [] };
    node.self = node;
    node.children.push({ parent: node });

    expect(JSON.parse(safeJsonStringify(node))).toEqual({
      name: 'a',
      children: [{ parent: '[Circular]' }],
      self: '[Circular]',
    });
  });

  it('writes a DOM node as its class name and drops functions', () => {
    const div = document.createElement('div');
    expect(JSON.parse(safeJsonStringify({ el: div, fn: () => 1, n: 1 }))).toEqual({
      el: '[HTMLDivElement]',
      n: 1,
    });
  });

  it('handles a root that is a primitive or an array', () => {
    expect(safeJsonStringify(3)).toBe('3');
    const shared = { k: 1 };
    expect(JSON.parse(safeJsonStringify([shared, shared]))).toEqual([{ k: 1 }, { k: 1 }]);
  });
});
