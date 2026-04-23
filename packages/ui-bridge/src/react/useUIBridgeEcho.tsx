/**
 * useUIBridgeEcho Hook
 *
 * Register a hidden readOnly `<input>` whose value is the serialised form of
 * an arbitrary JSON-compatible state. The value is surfaced in every UI
 * Bridge `/control/snapshot` response, which lets external automation read
 * state that doesn't have a natural DOM surface (e.g. data received via
 * `window.postMessage` from an iframe, or internal React state that should
 * be observable by an automation driver).
 *
 * The snapshot does NOT expose `<body>` data-attributes, so mirroring state
 * there is invisible to automation. An echo input solves that: the input is
 * registered with UI Bridge via `useUIElement`, so its value appears on
 * `element.state.value` in the snapshot.
 *
 * Usage:
 * ```tsx
 * function CaptureHost() {
 *   const [bbox, setBbox] = useState<Bbox | null>(null);
 *   const echo = useUIBridgeEcho('capture-last-bbox', bbox);
 *   return (
 *     <>
 *       <iframe ... />
 *       {echo}
 *     </>
 *   );
 * }
 * ```
 *
 * The external driver reads the echoed value from the snapshot:
 * ```python
 * snap = client.get_control_snapshot()
 * for el in snap['elements']:
 *     if el['id'] == 'capture-last-bbox':
 *         bbox = json.loads(el['state']['value'])
 * ```
 */

import { useMemo, type ReactElement } from 'react';
import { useUIElement } from './useUIElement';

/** Options for {@link useUIBridgeEcho}. */
export interface UseUIBridgeEchoOptions<T> {
  /** Human-readable label exposed via UI Bridge. */
  label?: string;
  /**
   * Custom serializer for *value*.  Defaults to `JSON.stringify`, which
   * returns `"null"`/`"undefined"`/`""` for falsy values (see behaviour).
   */
  serialize?: (value: T) => string;
  /**
   * Behaviour for `null`/`undefined` values.
   *   - `"empty"` (default): echo an empty string.
   *   - `"serialize"`: pass through to *serialize* (which returns `"null"`).
   */
  onNullish?: 'empty' | 'serialize';
  /** Override the rendered input's style. */
  style?: React.CSSProperties;
}

// Keep the input rendered with non-zero geometry so UI Bridge's snapshot
// visibility filter picks it up. `sr-only` style with clip:rect(0 0 0 0)
// causes AutoRegisterProvider to skip the element as invisible, which
// prevents automation drivers from reading its value via /control/snapshot.
const HIDDEN_INPUT_STYLE: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: 2,
  height: 2,
  padding: 0,
  border: 0,
  opacity: 0.01,
  pointerEvents: 'none',
};

/**
 * Register a hidden echo input and return a ReactElement the caller should
 * render into their tree.  The input's `value` is `serialize(value)`, kept
 * in sync with the prop via React's normal render cycle.
 *
 * @param id     UI Bridge element id (must be unique within the page).
 * @param value  JSON-compatible state to echo.
 * @param options Optional overrides (label, serializer, nullish behaviour).
 * @returns A `<input>` element the caller renders anywhere in their tree.
 */
export function useUIBridgeEcho<T>(
  id: string,
  value: T,
  options?: UseUIBridgeEchoOptions<T>
): ReactElement {
  const { label, serialize, onNullish = 'empty', style } = options ?? {};

  // Register with UI Bridge — `useUIElement` handles attach/detach via
  // data-ui-bridge-id once the DOM node mounts.
  useUIElement({
    id,
    label: label ?? `UI Bridge echo: ${id}`,
    type: 'input',
  });

  const serialized = useMemo(() => {
    if (value === null || value === undefined) {
      if (onNullish === 'empty') return '';
    }
    try {
      return serialize ? serialize(value) : JSON.stringify(value);
    } catch {
      // Defensive — e.g. BigInt or circular refs.  Callers should provide a
      // custom serialize in these cases, but we don't want to break render.
      return '';
    }
  }, [value, serialize, onNullish]);

  const mergedStyle = useMemo(() => ({ ...HIDDEN_INPUT_STYLE, ...(style ?? {}) }), [style]);

  return (
    <input
      id={id}
      type="text"
      readOnly
      value={serialized}
      aria-hidden="true"
      tabIndex={-1}
      style={mergedStyle}
    />
  );
}
