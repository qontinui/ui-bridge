import { describe, it, expect, afterEach } from 'vitest';
import { findElementsByText } from './dom-fallback';
import { findByTextPrimitive } from './page-primitives';
import {
  REDACTED_VALUE,
  textOutsideBoundaries,
  hasRedactionBoundaryBelow,
  withBoundaryIndex,
} from '../core/redaction';

/**
 * `findElementsByText` indexes the redaction boundaries under its container
 * once (`withBoundaryIndex`) instead of searching and walking each candidate's
 * subtree. The index is a pure cost change: every reader must answer exactly
 * what the unscoped readers answer, and no find payload may carry boundary text.
 */
const SECRET = 'tok-SECRET-123';

const PAGE = `
  <main id="app">
    <header id="head">Account <b data-bridge-redact="true">${SECRET}</b> settings</header>
    <section id="outer-b" data-bridge-redact="true">
      outer-${SECRET}
      <div id="inner-b" data-bridge-redact="true">inner-${SECRET}</div>
    </section>
    <ul id="list">
      <li id="a">alpha <i>one</i></li>
      <li id="b">beta <span><em data-bridge-redact="true">${SECRET}</em> tail</span></li>
      <li id="c">gamma <!-- comment-${SECRET} --> delta</li>
    </ul>
    <p id="plain">needle in a plain paragraph</p>
  </main>`;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('withBoundaryIndex — identical answers to the unscoped readers', () => {
  it('hasRedactionBoundaryBelow and textOutsideBoundaries agree for every element', () => {
    document.body.innerHTML = PAGE;
    const all = [document.body, ...Array.from(document.body.querySelectorAll('*'))];
    const unscoped = all.map((el) => [hasRedactionBoundaryBelow(el), textOutsideBoundaries(el)]);
    const scoped = withBoundaryIndex(document.body, () =>
      all.map((el) => [hasRedactionBoundaryBelow(el), textOutsideBoundaries(el)])
    );
    expect(scoped).toEqual(unscoped);
    // The page really exercises the sentinel, nested boundaries and a comment.
    expect(scoped.some(([, t]) => typeof t === 'string' && t.includes(REDACTED_VALUE))).toBe(true);
    // Only a boundary element's own read (nothing below it) is its raw text.
    expect(
      scoped.every(
        ([, t], i) =>
          !String(t).includes(SECRET) || all[i].getAttribute('data-bridge-redact') === 'true'
      )
    ).toBe(true);
  });

  it('an element outside the indexed root is read unscoped, and the scope is restored', () => {
    document.body.innerHTML = `<div id="in">x <b data-bridge-redact="true">${SECRET}</b></div><div id="out">y <b data-bridge-redact="true">${SECRET}</b></div>`;
    const inRoot = document.getElementById('in')!;
    const out = document.getElementById('out')!;
    withBoundaryIndex(inRoot, () => {
      expect(textOutsideBoundaries(out)).toBe(`y ${REDACTED_VALUE}`);
      expect(hasRedactionBoundaryBelow(out)).toBe(true);
      withBoundaryIndex(out, () => expect(textOutsideBoundaries(out)).toBe(`y ${REDACTED_VALUE}`));
      expect(textOutsideBoundaries(inRoot)).toBe(`x ${REDACTED_VALUE}`);
    });
    expect(textOutsideBoundaries(inRoot)).toBe(`x ${REDACTED_VALUE}`);
  });

  it('a deep chain of ancestors above a boundary does not recurse', () => {
    const depth = 1500;
    const root = document.createElement('div');
    let parent: HTMLElement = root;
    for (let i = 0; i < depth; i++) {
      const d = document.createElement('div');
      if (i % 100 === 0) d.append('w ');
      parent.appendChild(d);
      parent = d;
    }
    const b = document.createElement('b');
    b.setAttribute('data-bridge-redact', 'true');
    b.textContent = SECRET;
    parent.appendChild(b);
    document.body.appendChild(root);
    const text = withBoundaryIndex(root, () => textOutsideBoundaries(root));
    expect(text).not.toContain(SECRET);
    expect(text).toContain(REDACTED_VALUE);
  });
});

describe('find-by-text payloads carry no boundary text', () => {
  it('the hit set equals the one computed with the unscoped readers', () => {
    document.body.innerHTML = PAGE;
    const hits = (q: string) => findElementsByText(q, {}).map((el) => el.id || el.tagName);
    expect(hits('account')).toEqual(['app', 'head']);
    expect(hits('tail')).toEqual(['app', 'list', 'b', 'SPAN']);
    expect(hits(SECRET)).toEqual([]);
    expect(hits('needle')).toContain('plain');
  });

  it('findByText never serialises the secret, searching for it or for its neighbours', () => {
    document.body.innerHTML = PAGE;
    for (const q of [SECRET, 'inner-', 'outer-', 'comment-', 'Account', 'beta', 'gamma', 'tail']) {
      const r = findByTextPrimitive(q, {});
      expect(JSON.stringify(r)).not.toContain(SECRET);
    }
    const head = findByTextPrimitive('Account', { exact: false });
    expect(head.ok && head.data.map((h) => h.text)).toContain(`Account ${REDACTED_VALUE} settings`);
    const secret = findByTextPrimitive(SECRET, {});
    expect(secret.ok && secret.data).toEqual([]);
  });
});
