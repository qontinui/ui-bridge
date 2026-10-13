/**
 * jsdom media fixtures shared by the media tests.
 *
 * jsdom does no layout and loads no images, so every fact the SDK reads off a
 * real image (`complete`, `naturalWidth`, `currentSrc`, the box) is stubbed
 * per instance here — the minimum to make an `<img>` look loaded, pending or
 * broken at a known size.
 */

import type { UIBridgeRegistry } from '../../core/registry';
import { captureMediaMetadata, captureBackgroundImageMetadata } from '../media-capture';

/** Give `el` a box (viewport-relative CSS px) and make it count as rendered. */
export function stubBox(el: Element, width: number, height: number, x = 0, y = 0): void {
  const rect = {
    x,
    y,
    width,
    height,
    top: y,
    left: x,
    right: x + width,
    bottom: y + height,
    toJSON() {
      return { x, y, width, height };
    },
  };
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => rect,
  });
  // The canonical filter's live visibility check reads offsetParent, which
  // jsdom leaves null for every element.
  Object.defineProperty(el, 'offsetParent', {
    configurable: true,
    get: () => document.body,
  });
}

export interface ImageInit {
  /** `null` = no alt attribute at all. */
  alt?: string | null;
  /** The `src` ATTRIBUTE (what ids derive from). */
  src?: string;
  /** The URL actually displayed. Defaults to the absolute form of `src`. */
  currentSrc?: string;
  /** Intrinsic size; omitted = not decoded (pending, or broken when `complete`). */
  natural?: [number, number];
  /** Rendered border box. */
  rendered?: [number, number];
  /** Defaults to true. */
  complete?: boolean;
  attrs?: Record<string, string>;
  parent?: Element;
}

/** An `<img>` with the given facts, appended to `parent` (default: body). */
export function makeImage(init: ImageInit = {}): HTMLImageElement {
  const img = document.createElement('img');
  if (init.alt !== null && init.alt !== undefined) img.setAttribute('alt', init.alt);
  if (init.src !== undefined) img.setAttribute('src', init.src);
  for (const [k, v] of Object.entries(init.attrs ?? {})) img.setAttribute(k, v);
  const absolute = init.src ? new URL(init.src, location.href).href : '';
  const currentSrc = init.currentSrc ?? absolute;
  const [nw, nh] = init.natural ?? [0, 0];
  Object.defineProperty(img, 'complete', { configurable: true, get: () => init.complete ?? true });
  Object.defineProperty(img, 'naturalWidth', { configurable: true, get: () => nw });
  Object.defineProperty(img, 'naturalHeight', { configurable: true, get: () => nh });
  Object.defineProperty(img, 'currentSrc', { configurable: true, get: () => currentSrc });
  const [rw, rh] = init.rendered ?? [100, 100];
  stubBox(img, rw, rh);
  (init.parent ?? document.body).appendChild(img);
  return img;
}

/** Set `window.devicePixelRatio`; returns the restore. */
export function setDevicePixelRatio(dpr: number): () => void {
  const prior = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: dpr });
  return () => {
    if (prior) Object.defineProperty(window, 'devicePixelRatio', prior);
    else delete (window as { devicePixelRatio?: number }).devicePixelRatio;
  };
}

/**
 * Register `el` as a media element exactly as `useAutoRegister` does: the
 * initial capture plus the refresh callback, so `getState()` and the find
 * filter re-capture.
 */
export function registerMedia(
  registry: UIBridgeRegistry,
  id: string,
  el: HTMLElement,
  label?: string
): void {
  const isBackground = !el.matches('img, picture, video, canvas, svg, [role="img"]');
  const capture = isBackground
    ? (node: HTMLElement) => captureBackgroundImageMetadata(node)!
    : captureMediaMetadata;
  const meta = capture(el);
  registry.registerMediaElement(id, el, {
    mediaType: meta.status === 'measured' ? meta.value.mediaType : 'image',
    mediaMetadata: meta,
    label,
    refreshMetadata: capture,
  });
}
