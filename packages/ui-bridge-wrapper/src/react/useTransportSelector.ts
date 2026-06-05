/**
 * `useTransportSelector`
 *
 * Small `useState`-backed selector for wrapper UIs that let users flip
 * between transport kinds at runtime (e.g. a "Run in headless / headed /
 * via runner" toggle on a wrapper's launch screen).
 *
 * Not tied to any transport instance — this is purely UI state. The
 * consumer is responsible for recreating the transport with the new kind
 * when the value changes.
 */

import { useCallback, useState } from 'react';
import type { WrapperTransportKind } from '../types.js';

export interface UseTransportSelectorOptions {
  /** Initial kind. Defaults to `"api"`. */
  initialKind?: WrapperTransportKind;
  /**
   * Restrict the selectable kinds. Default = all four. Useful when a
   * wrapper can't support one (e.g. pure-api wrappers hiding headless).
   */
  allowedKinds?: readonly WrapperTransportKind[];
  /** Callback fired whenever the kind changes. */
  onChange?: (kind: WrapperTransportKind) => void;
}

export interface UseTransportSelectorReturn {
  kind: WrapperTransportKind;
  setKind: (next: WrapperTransportKind) => void;
  allowedKinds: readonly WrapperTransportKind[];
}

const DEFAULT_ALLOWED: readonly WrapperTransportKind[] = ['api', 'headless', 'headed', 'live'];

export function useTransportSelector(
  options: UseTransportSelectorOptions = {}
): UseTransportSelectorReturn {
  const allowed = options.allowedKinds ?? DEFAULT_ALLOWED;
  const initial = options.initialKind ?? allowed[0] ?? 'api';
  const [kind, setKind] = useState<WrapperTransportKind>(initial);

  const selectKind = useCallback(
    (next: WrapperTransportKind) => {
      if (!allowed.includes(next)) return;
      setKind(next);
      options.onChange?.(next);
    },
    [allowed, options]
  );

  return { kind, setKind: selectKind, allowedKinds: allowed };
}
