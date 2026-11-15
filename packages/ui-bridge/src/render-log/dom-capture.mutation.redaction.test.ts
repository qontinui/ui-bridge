/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { DOMChangeObserver, type DOMChange } from './dom-capture';
import { REDACTED_VALUE } from '../core/redaction';

const SECRET = 'SECRET-mutation-6180';

afterEach(() => {
  document.body.innerHTML = '';
});

/** Wait for the observer's microtask delivery, then return what it recorded. */
async function observe(mutate: () => void): Promise<DOMChange[]> {
  const observer = new DOMChangeObserver();
  observer.start(document.body);
  mutate();
  await new Promise((r) => setTimeout(r, 0));
  observer.stop();
  return observer.getChanges();
}

/**
 * §4.6: the change observer records the OLD and NEW attribute value of every
 * mutation; they ride into the render log's `ChangeEntry` and its export.
 */
describe('DOMChangeObserver attribute mutations — redaction', () => {
  it('an attribute changed inside a boundary records the sentinel, not the values', async () => {
    document.body.innerHTML = `<div data-bridge-redact="true"><button id="b" aria-label="old ${SECRET}">x</button></div>`;
    const b = document.getElementById('b')!;
    const changes = await observe(() => b.setAttribute('aria-label', `new ${SECRET}`));
    const attr = changes.find((c) => c.type === 'attribute');
    expect(attr?.details?.oldValue).toBe(REDACTED_VALUE);
    expect(attr?.details?.newValue).toBe(REDACTED_VALUE);
    expect(JSON.stringify(changes)).not.toContain(SECRET);
  });

  it('a password input value attribute change records the sentinel', async () => {
    document.body.innerHTML = `<input id="pw" type="password" value="${SECRET}-old" />`;
    const pw = document.getElementById('pw')!;
    const changes = await observe(() => pw.setAttribute('value', `${SECRET}-new`));
    expect(JSON.stringify(changes)).not.toContain(SECRET);
    expect(changes.find((c) => c.type === 'attribute')?.details?.newValue).toBe(REDACTED_VALUE);
  });

  it('[negative control] a plain attribute change keeps both values', async () => {
    document.body.innerHTML = `<button id="b" title="before">x</button>`;
    const b = document.getElementById('b')!;
    const changes = await observe(() => b.setAttribute('title', 'after'));
    const attr = changes.find((c) => c.type === 'attribute');
    expect(attr?.details?.oldValue).toBe('before');
    expect(attr?.details?.newValue).toBe('after');
  });
});
