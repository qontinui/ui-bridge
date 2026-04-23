/**
 * CaptureHostFrame
 *
 * A ready-made capture-host pattern: an outer React component that keeps a
 * stable UI Bridge SDK connection while cycling an inner `<iframe>` through
 * an automation-driven URL sequence.  Solves the "SDK unmounts when we
 * navigate to page X" problem that breaks naïve navigation loops.
 *
 * How external automation drives this component:
 *   1. POST /api/ui-bridge/control/element/{urlInputId}/action
 *        {action: "setValue", params: {value: "/next/sample/url"}}
 *   2. POST /api/ui-bridge/control/element/{advanceId}/action
 *        {action: "click"}
 *   3. GET /api/ui-bridge/control/snapshot
 *        read `element.state.value` where `element.id == echoId`
 *
 * The inner iframe communicates measurement back via `window.postMessage`
 * to the parent. The message shape (matched against {kind}) is customisable
 * via `messageKind`.  Any matching message's payload is echoed into the
 * hidden {echoId} input so automation can read it from the snapshot.
 *
 * Usage:
 * ```tsx
 * import { CaptureHostFrame } from '@qontinui/ui-bridge/react';
 *
 * function MyCaptureHost() {
 *   return (
 *     <CaptureHostFrame
 *       initialSrc="/api/my-isolated?sample=0"
 *       messageKind="grounding-bbox"
 *       title="Grounding Capture"
 *     />
 *   );
 * }
 * ```
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode, useRef } from 'react';
import { useUIBridgeEcho } from './useUIBridgeEcho';
import { useUIElement } from './useUIElement';

/** Default UI Bridge element IDs. Override for multiple hosts per page. */
export const DEFAULT_CAPTURE_HOST_IDS = {
  urlInput: 'capture-next-url',
  advance: 'capture-advance',
  echo: 'capture-last-echo',
} as const;

export interface CaptureHostFrameProps {
  /** Starting URL for the iframe (before the first advance). */
  initialSrc?: string;
  /**
   * Message `kind` to listen for on postMessage events. Any event whose
   * `data.kind === messageKind` will have its full data echoed into
   * `{echoId}` input. Defaults to `'capture-host-echo'`.
   */
  messageKind?: string;
  /** Override the registered element IDs. */
  ids?: Partial<typeof DEFAULT_CAPTURE_HOST_IDS>;
  /** Optional title shown above the iframe. */
  title?: string;
  /** Optional header content rendered above the iframe (replaces title). */
  header?: ReactNode;
  /** Iframe style overrides. */
  iframeStyle?: React.CSSProperties;
  /** Iframe element title (a11y). */
  iframeTitle?: string;
  /** Optional callback fired whenever a matching postMessage arrives. */
  onEcho?: (payload: unknown) => void;
  /**
   * Optional hook for any incoming message (all `kind` values). Useful for
   * debugging — runs before `onEcho` filtering.
   */
  onMessage?: (data: unknown, ev: MessageEvent) => void;
}

/**
 * Outer capture-host React component. Renders a URL input, advance button,
 * inner iframe, and a hidden echo input. External automation drives the
 * input/button via UI Bridge and reads measurements from the echo input.
 */
export function CaptureHostFrame(props: CaptureHostFrameProps) {
  const {
    initialSrc = 'about:blank',
    messageKind = 'capture-host-echo',
    ids,
    title = 'UI Bridge Capture Host',
    header,
    iframeStyle,
    iframeTitle = 'capture-sample',
    onEcho,
    onMessage,
  } = props;

  const resolvedIds = useMemo(() => ({ ...DEFAULT_CAPTURE_HOST_IDS, ...(ids ?? {}) }), [ids]);

  const [currentUrl, setCurrentUrl] = useState(initialSrc);
  const [advanceCount, setAdvanceCount] = useState(0);
  const [lastEcho, setLastEcho] = useState<unknown>(null);
  // Uncontrolled input — automation writes via setValue + dispatched input
  // event. Reading its value at click-time via ref avoids React batching
  // races where the controlled-state update hasn't landed before click.
  const urlInputRef = useRef<HTMLInputElement>(null);

  // Register the control inputs/buttons so automation can drive them.
  useUIElement({
    id: resolvedIds.urlInput,
    label: 'Pending URL for the capture-host iframe',
    type: 'input',
  });
  useUIElement({
    id: resolvedIds.advance,
    label: 'Load the pending URL into the capture-host iframe',
    type: 'button',
  });

  // Forward iframe postMessage events to the echo input (and optional hooks).
  useEffect(() => {
    function handler(ev: MessageEvent) {
      const data = ev.data;
      if (onMessage) {
        try {
          onMessage(data, ev);
        } catch {
          /* user callback error — ignored */
        }
      }
      if (
        typeof data === 'object' &&
        data !== null &&
        (data as { kind?: unknown }).kind === messageKind
      ) {
        setLastEcho(data);
        if (onEcho) {
          try {
            onEcho(data);
          } catch {
            /* user callback error — ignored */
          }
        }
      }
    }
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [messageKind, onEcho, onMessage]);

  const advance = useCallback(() => {
    const input = urlInputRef.current;
    if (!input) return;
    const next = input.value;
    if (!next) return;
    input.value = '';
    setAdvanceCount((n) => n + 1);
    setCurrentUrl(next);
  }, []);

  // Hidden echo input surfaces lastEcho in the UI Bridge snapshot.
  const echoElement = useUIBridgeEcho(resolvedIds.echo, lastEcho, {
    label: `CaptureHostFrame echo (kind=${messageKind})`,
  });

  return (
    <div style={{ padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      {header ?? <h1 style={{ fontSize: 18, marginBottom: 8 }}>{title}</h1>}
      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          marginBottom: 12,
        }}
      >
        <label htmlFor={resolvedIds.urlInput} style={{ fontSize: 13 }}>
          Next URL:
        </label>
        <input
          id={resolvedIds.urlInput}
          ref={urlInputRef}
          type="text"
          defaultValue=""
          placeholder="/api/..."
          style={{
            flex: 1,
            padding: '4px 8px',
            border: '1px solid #ccc',
            borderRadius: 4,
            fontSize: 12,
            fontFamily: 'monospace',
          }}
        />
        <button
          id={resolvedIds.advance}
          type="button"
          onClick={advance}
          style={{
            padding: '4px 12px',
            background: '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          Advance
        </button>
      </div>
      <div style={{ fontSize: 11, color: '#666', marginBottom: 8 }}>
        advance #{advanceCount} — echo:{' '}
        <code>{lastEcho ? JSON.stringify(lastEcho).slice(0, 140) : '(none)'}</code>
      </div>
      <iframe
        src={currentUrl}
        title={iframeTitle}
        data-capture-host-iframe="true"
        style={{
          width: '100%',
          height: 'calc(100vh - 160px)',
          border: '1px solid #ddd',
          background: '#fff',
          ...(iframeStyle ?? {}),
        }}
      />
      {echoElement}
    </div>
  );
}
