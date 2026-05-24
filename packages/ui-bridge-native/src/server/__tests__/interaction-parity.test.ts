import { describe, it, expect } from 'vitest';
import { NativeUIBridgeRegistry } from '../../core/registry';
import { DefaultNativeActionExecutor } from '../../control/action-executor';
import type { NativeElementRef } from '../../core/types';
import { createServerHandlers } from '../handlers';

/**
 * App-agnostic interaction parity on native (clickByText / typeInto /
 * findByText / clickBySelector / readValue).
 *
 * These mirror the cross-platform `/control/page/*` contract shared with the
 * web/runner bridge. Text/label interactions compose the registry's text
 * matching + the real `DefaultNativeActionExecutor` (press/type) end-to-end;
 * the selector-only variants must return a structured NOT_SUPPORTED envelope
 * on native (no DOM).
 */

function makeRef(): React.RefObject<NativeElementRef> {
  return { current: {} as NativeElementRef };
}

function ctx(body: unknown) {
  return { params: {}, query: {}, body };
}

describe('native interaction parity', () => {
  it('clickByText presses the element whose label matches', async () => {
    const registry = new NativeUIBridgeRegistry();
    const executor = new DefaultNativeActionExecutor(registry);
    let pressed = false;
    registry.registerElement('save-btn', makeRef(), {
      type: 'pressable',
      label: 'Save Changes',
      props: { onPress: () => { pressed = true; } },
    });

    const handlers = createServerHandlers(registry, executor);
    const res = await handlers.clickByText(ctx({ text: 'Save' }));

    expect(res.success).toBe(true);
    expect(pressed).toBe(true);
    const data = res.data as { clicked: boolean; element?: { id?: string } };
    expect(data.clicked).toBe(true);
    expect(data.element?.id).toBe('save-btn');
  });

  it('clickByText returns ELEMENT_NOT_FOUND when nothing matches', async () => {
    const registry = new NativeUIBridgeRegistry();
    const executor = new DefaultNativeActionExecutor(registry);
    const handlers = createServerHandlers(registry, executor);

    const res = await handlers.clickByText(ctx({ text: 'nonexistent' }));
    expect(res.success).toBe(false);
    expect(res.code).toBe('ELEMENT_NOT_FOUND');
  });

  it('typeInto writes text into the input matched by label', async () => {
    const registry = new NativeUIBridgeRegistry();
    const executor = new DefaultNativeActionExecutor(registry);
    let typed = '';
    registry.registerElement('email-field', makeRef(), {
      type: 'input',
      label: 'Email Address',
      props: { onChangeText: (t: string) => { typed = t; } },
    });

    const handlers = createServerHandlers(registry, executor);
    const res = await handlers.typeInto(ctx({ label: 'Email', text: 'a@b.com' }));

    expect(res.success).toBe(true);
    expect(typed).toBe('a@b.com');
  });

  it('findByText lists matching elements without acting', async () => {
    const registry = new NativeUIBridgeRegistry();
    const executor = new DefaultNativeActionExecutor(registry);
    registry.registerElement('a', makeRef(), { type: 'text', label: 'Save Draft' });
    registry.registerElement('b', makeRef(), { type: 'text', label: 'Save Now' });
    registry.registerElement('c', makeRef(), { type: 'text', label: 'Cancel' });

    const handlers = createServerHandlers(registry, executor);
    const res = await handlers.findByText(ctx({ text: 'Save' }));

    expect(res.success).toBe(true);
    const data = res.data as Array<{ id: string }>;
    expect(data.map((d) => d.id).sort()).toEqual(['a', 'b']);
  });

  it('clickBySelector returns NOT_SUPPORTED on native', async () => {
    const registry = new NativeUIBridgeRegistry();
    const executor = new DefaultNativeActionExecutor(registry);
    const handlers = createServerHandlers(registry, executor);

    const res = await handlers.clickBySelector(ctx({ selector: '#x' }));
    expect(res.success).toBe(false);
    expect(res.code).toBe('NOT_SUPPORTED');
  });

  it('readValue returns NOT_SUPPORTED on native', async () => {
    const registry = new NativeUIBridgeRegistry();
    const executor = new DefaultNativeActionExecutor(registry);
    const handlers = createServerHandlers(registry, executor);

    const res = await handlers.readValue(ctx({ selector: '#x' }));
    expect(res.success).toBe(false);
    expect(res.code).toBe('NOT_SUPPORTED');
  });
});
