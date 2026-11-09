/**
 * useIsomorphicLayoutEffect
 *
 * `useLayoutEffect` in the browser, `useEffect` where there is no DOM (SSR),
 * so a layout effect never warns on the server. Layout cleanups run in the
 * commit's mutation phase, together with the DOM removal, instead of in a
 * later passive task.
 */
import { useEffect, useLayoutEffect } from 'react';

export const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;
