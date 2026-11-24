/**
 * `isRenderedForAction` — the relay dispatch gate's (and the relay
 * `clickable` condition's) "is the node rendered at all" check. It walks the
 * FLAT tree, so a `display: none` shadow host or slot refuses, and a
 * light-DOM child that no slot takes is not rendered. Where the engine has
 * `Element.checkVisibility()` its answer is used instead of the walk (jsdom
 * has none, so the walk is what these tests exercise, plus one stubbed
 * `checkVisibility` case).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { isRenderedForAction } from './element-state';

afterEach(() => {
  document.body.innerHTML = '';
});

function host(): { host: HTMLDivElement; shadow: ShadowRoot } {
  const h = document.createElement('div');
  document.body.appendChild(h);
  return { host: h, shadow: h.attachShadow({ mode: 'open' }) };
}

describe('isRenderedForAction', () => {
  it('a plain connected control, a position:fixed one and an opacity:0 one are rendered', () => {
    const plain = document.createElement('button');
    const fixed = document.createElement('button');
    fixed.style.position = 'fixed';
    const faded = document.createElement('button');
    faded.style.opacity = '0';
    document.body.append(plain, fixed, faded);
    expect(isRenderedForAction(plain)).toBe(true);
    expect(isRenderedForAction(fixed)).toBe(true);
    expect(isRenderedForAction(faded)).toBe(true);
  });

  it('display:none or visibility:hidden on the node, a display:none ancestor and a detached node are not', () => {
    const none = document.createElement('button');
    none.style.display = 'none';
    const hidden = document.createElement('button');
    hidden.style.visibility = 'hidden';
    const shell = document.createElement('div');
    shell.style.display = 'none';
    const inner = document.createElement('button');
    shell.appendChild(inner);
    document.body.append(none, hidden, shell);
    expect(isRenderedForAction(none)).toBe(false);
    expect(isRenderedForAction(hidden)).toBe(false);
    expect(isRenderedForAction(inner)).toBe(false);
    expect(isRenderedForAction(document.createElement('button'))).toBe(false);
  });

  it('a node inside a shadow root whose host is display:none is not rendered', () => {
    const { host: h, shadow } = host();
    const btn = document.createElement('button');
    shadow.appendChild(btn);
    expect(isRenderedForAction(btn)).toBe(true);
    h.style.display = 'none';
    expect(isRenderedForAction(btn)).toBe(false);
  });

  it('a slotted light-DOM child follows its slot; an unslotted one is not rendered', () => {
    const { host: h, shadow } = host();
    const slot = document.createElement('slot');
    slot.name = 'action';
    shadow.appendChild(slot);
    const slotted = document.createElement('button');
    slotted.slot = 'action';
    const unslotted = document.createElement('button');
    unslotted.slot = 'nowhere';
    h.append(slotted, unslotted);
    expect(isRenderedForAction(slotted)).toBe(true);
    expect(isRenderedForAction(unslotted)).toBe(false);
  });

  it('a display:none slot hides what it takes', () => {
    // A fresh fixture: jsdom does not invalidate a computed style it already
    // served when an inline style inside a shadow tree changes.
    const { host: h, shadow } = host();
    const slot = document.createElement('slot');
    slot.name = 'action';
    slot.style.display = 'none';
    shadow.appendChild(slot);
    const slotted = document.createElement('button');
    slotted.slot = 'action';
    h.append(slotted);
    expect(isRenderedForAction(slotted)).toBe(false);
  });

  it('a display:contents node is judged by the walk, not checkVisibility() (which reads it as boxless)', () => {
    const wrapper = document.createElement('div');
    wrapper.style.display = 'contents';
    wrapper.tabIndex = 0;
    document.body.appendChild(wrapper);
    // A browser's checkVisibility() is false for a node with no box of its own.
    Object.defineProperty(wrapper, 'checkVisibility', { configurable: true, value: () => false });
    expect(isRenderedForAction(wrapper)).toBe(true);
  });

  it('the fallback walk cannot see into a CLOSED shadow root: an unslotted light child of a closed host reads rendered', () => {
    const h = document.createElement('div');
    document.body.appendChild(h);
    h.attachShadow({ mode: 'closed' });
    const child = document.createElement('button');
    h.appendChild(child);
    // No slot takes it, so a browser renders nothing for it — but neither
    // `assignedSlot` nor `h.shadowRoot` is readable for a closed root, so the
    // walk (documented) treats it as rendered. `checkVisibility()` answers
    // this case where the engine has it.
    expect(isRenderedForAction(child)).toBe(true);
  });

  it("uses the engine's checkVisibility() when it has one", () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    Object.defineProperty(btn, 'checkVisibility', { configurable: true, value: () => false });
    expect(isRenderedForAction(btn)).toBe(false);
  });
});
