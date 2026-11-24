/**
 * Element Inspector
 *
 * Visual debugging tools for inspecting UI elements.
 */

import React, { useState, useEffect, useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import type { RegisteredElement, ElementState, ElementIdentifier } from '../core/types';
import { createElementIdentifier, getBestIdentifier } from '../core/element-identifier';
import { getGlobalAnnotationStore } from '../annotations';
// The ONE `ElementState` reader (plan
// `2026-11-08-ui-bridge-element-state-has-two-readers-and-no-aria-busy`, D1):
// the inspector shows the state the registry snapshot reports, not a private
// reading whose `visible` had no viewport, visibility or occlusion arm.
import { getElementState } from '../core/element-state';
import { INSPECTOR_PANEL_ATTR } from '../core/inspector-panel';

/**
 * Inspector state
 */
export interface InspectorState {
  /** Whether inspector is active */
  active: boolean;
  /** Currently hovered element */
  hoveredElement: HTMLElement | null;
  /** Selected element */
  selectedElement: HTMLElement | null;
  /** Highlight bounds */
  highlightBounds: DOMRect | null;
}

/**
 * Element info for display
 */
export interface ElementInfo {
  identifier: ElementIdentifier;
  bestId: string;
  tagName: string;
  role?: string;
  state: ElementState;
  registered?: RegisteredElement;
}

/**
 * Inspector overlay styles
 */
const overlayStyles: React.CSSProperties = {
  position: 'fixed',
  pointerEvents: 'none',
  zIndex: 999999,
  border: '2px solid #3b82f6',
  backgroundColor: 'rgba(59, 130, 246, 0.1)',
  transition: 'all 0.1s ease-out',
};

const labelStyles: React.CSSProperties = {
  position: 'absolute',
  top: '-24px',
  left: '0',
  padding: '2px 8px',
  backgroundColor: '#3b82f6',
  color: 'white',
  fontSize: '12px',
  fontFamily: 'monospace',
  whiteSpace: 'nowrap',
  borderRadius: '4px 4px 0 0',
};

/**
 * The info panel's root. `readInspectorState` sets `pointer-events: none` on
 * this ROOT only, and its descendants inherit it, so the hit-test skips the
 * whole panel. A panel descendant must therefore never set its own
 * `pointer-events: auto` (or any value but inherit): it would stay hittable
 * during the read and be reported as the target's occluder.
 */
const panelStyles: React.CSSProperties = {
  position: 'fixed',
  bottom: '20px',
  right: '20px',
  width: '400px',
  maxHeight: '500px',
  overflow: 'auto',
  backgroundColor: '#1f2937',
  color: '#f3f4f6',
  borderRadius: '8px',
  boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
  fontFamily: 'monospace',
  fontSize: '12px',
  zIndex: 999998,
};

const headerStyles: React.CSSProperties = {
  padding: '12px 16px',
  backgroundColor: '#111827',
  borderBottom: '1px solid #374151',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  borderRadius: '8px 8px 0 0',
};

const sectionStyles: React.CSSProperties = {
  padding: '12px 16px',
  borderBottom: '1px solid #374151',
};

const labelKeyStyles: React.CSSProperties = {
  color: '#9ca3af',
  marginRight: '8px',
};

const valueStyles: React.CSSProperties = {
  color: '#60a5fa',
};

/** The inspector's reading of an element, with its own panel taken out of the picture. */
export interface InspectorStateReading {
  /** The canonical state, computed as if the inspector panel were absent. */
  state: ElementState;
  /** True when a plain read differs because the inspector panel covers the element. */
  coveredByPanel: boolean;
}

/**
 * Read `element`'s state with every inspector panel root (the panel root is
 * marked with `INSPECTOR_PANEL_ATTR`, a fixed box with pointer events on, so a
 * candidate occluder of whatever it inspects) set to
 * `pointer-events: none` for the duration of the call, so hit-testing skips
 * the panel and the occlusion verdict is the page's, not the inspector's —
 * while any OTHER occluder is still found and named. The canonical reader is
 * unchanged: excluding the panel is the inspector's concern, not the core
 * verdict's (plan `2026-11-23-ui-bridge-element-state-collapse-follow-ups`, D3).
 */
export function readInspectorState(element: HTMLElement): InspectorStateReading {
  const plain = getElementState(element);
  const panels = Array.from(
    document.querySelectorAll<HTMLElement>(`[${INSPECTOR_PANEL_ATTR}]`)
  ).filter(
    // An element INSIDE a panel is read as it is: hiding its own panel from
    // the hit-test would make the element itself unhittable.
    (panel) => !panel.contains(element)
  );
  if (panels.length === 0) return { state: plain, coveredByPanel: false };

  const saved = panels.map((panel) => ({
    value: panel.style.getPropertyValue('pointer-events'),
    priority: panel.style.getPropertyPriority('pointer-events'),
  }));
  let state: ElementState;
  try {
    for (const panel of panels) panel.style.setProperty('pointer-events', 'none', 'important');
    state = getElementState(element);
  } finally {
    panels.forEach((panel, i) => {
      const { value, priority } = saved[i];
      if (value) panel.style.setProperty('pointer-events', value, priority);
      else panel.style.removeProperty('pointer-events');
    });
  }
  const coveredByPanel =
    plain.visible !== state.visible ||
    plain.visibilityReason !== state.visibilityReason ||
    plain.occludedBy !== state.occludedBy ||
    plain.occludedPct !== state.occludedPct;
  return { state, coveredByPanel };
}

/**
 * Inspector overlay component
 */
export interface InspectorOverlayProps {
  bounds: DOMRect;
  label: string;
}

export function InspectorOverlay({ bounds, label }: InspectorOverlayProps) {
  return (
    <div
      style={{
        ...overlayStyles,
        // `position: fixed` is viewport-relative, as is `getBoundingClientRect()`:
        // adding a scroll offset would push the box off its element on any
        // scrolled page.
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height,
      }}
    >
      <span style={labelStyles}>{label}</span>
    </div>
  );
}

/**
 * Element info panel component
 */
export interface InfoPanelProps {
  element: HTMLElement | null;
  onClose: () => void;
  registeredElement?: RegisteredElement;
}

export function InfoPanel({ element, onClose, registeredElement }: InfoPanelProps) {
  if (!element) return null;
  return (
    <InfoPanelContent element={element} onClose={onClose} registeredElement={registeredElement} />
  );
}

/**
 * Mutation records that can change what the panel reports for `element`: every
 * record except those inside an inspector panel that does not hold `element`
 * (the panel's own re-render, and the `pointer-events` toggle on its root).
 */
function pageRecords(records: MutationRecord[], element: HTMLElement): MutationRecord[] {
  return records.filter((record) => {
    const node = record.target;
    const panel = (node instanceof Element ? node : node.parentElement)?.closest(
      `[${INSPECTOR_PANEL_ATTR}]`
    );
    return !panel || panel.contains(element);
  });
}

/** Attributes that can show, hide or cover the selected element from elsewhere in the page. */
const PAGE_VISIBILITY_ATTRS = ['class', 'style', 'hidden', 'aria-hidden', 'open'];

/**
 * Everything {@link StateSections} displays, in the form it displays it (the
 * rect rounded). Two readings with the same signature render identically, so
 * a re-read that changes only something the panel does not show (an animated
 * opacity, sub-pixel motion, the subtree text) stores nothing and schedules
 * nothing — without that, an animated element would re-read, commit and
 * re-schedule every frame.
 */
function displayedSignature(reading: InspectorStateReading): string {
  const { state, coveredByPanel } = reading;
  return JSON.stringify([
    coveredByPanel,
    state.visible,
    state.visibilityReason ?? null,
    state.occludedBy ?? null,
    state.occludedPct ?? null,
    state.enabled,
    state.disabled,
    state.ariaDisabled,
    state.focused,
    state.value ?? null,
    state.checked ?? null,
    Math.round(state.rect.x),
    Math.round(state.rect.y),
    Math.round(state.rect.width),
    Math.round(state.rect.height),
  ]);
}

/** Two readings that would render identically. */
function sameReading(a: InspectorStateReading, b: InspectorStateReading): boolean {
  return displayedSignature(a) === displayedSignature(b);
}

/**
 * The state is read AT COMMIT, never in the render body: `readInspectorState`
 * toggles the panel root's `pointer-events`, which is a DOM write, and only a
 * committed panel can be excluded from the hit-test.
 *
 * - The first read runs in the panel root's callback ref (React's documented
 *   "measure a DOM node" pattern: commit phase, before paint, and again
 *   whenever the element changes because the callback is keyed on it).
 * - EVERY commit of the panel then schedules a re-read (a layout effect with
 *   no dependency list, whose state update happens in the frame callback,
 *   never synchronously in the effect). That keeps the old render-body read's
 *   freshness: each re-render of the panel or the inspector (every hover)
 *   re-reads once per frame, including the commit that replaces the
 *   "Reading state" placeholder, so the panel-exclusion verdict reflects the
 *   panel's final size.
 * - Between re-renders the state is re-read when the page moves (scroll in
 *   the capture phase, resize), when the selected element changes (a
 *   MutationObserver on its attributes, text and subtree, and its `input`,
 *   `change`, `focusin` and `focusout` events), and when anything in the page
 *   gains or loses a node anywhere under `document.body`, or when any element
 *   there changes its `class`, `style`, `hidden`, `aria-hidden` or `open`
 *   attribute (a MutationObserver on the `document.body` subtree), so an
 *   ancestor hidden that way or an overlay inserted updates Visible and
 *   Occluded by. Other page changes (another attribute on some other element,
 *   a stylesheet rule, a CSS animation) are not watched: they show up at the
 *   next trigger or re-render.
 * - Every trigger is coalesced through one `requestAnimationFrame`, so a burst
 *   costs one read per frame, and a reading is stored only when what the panel
 *   DISPLAYS differs from the one shown. Re-reads therefore settle once the
 *   displayed fields stop changing. An element that keeps moving (its rounded
 *   rect changes every frame) keeps a live Bounds readout at one read per
 *   frame for as long as it moves.
 *   Records inside an inspector panel that does not hold the element (its own
 *   re-render and its root's toggle) are not triggers. Everything is torn down
 *   on element change and unmount; a pending frame is cancelled in a layout
 *   cleanup, before the next element's first re-read is scheduled.
 */
function InfoPanelContent({
  element,
  onClose,
  registeredElement,
}: InfoPanelProps & { element: HTMLElement }) {
  const [read, setRead] = useState<{ element: HTMLElement; reading: InspectorStateReading } | null>(
    null
  );
  const store = useCallback(
    (reading: InspectorStateReading) =>
      setRead((prev) =>
        prev && prev.element === element && sameReading(prev.reading, reading)
          ? prev
          : { element, reading }
      ),
    [element]
  );
  const panelRootRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (node) store(readInspectorState(element));
    },
    [element, store]
  );

  // One pending frame for every re-read trigger.
  const frameRef = useRef<number | null>(null);
  const scheduleRead = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      store(readInspectorState(element));
    });
  }, [element, store]);
  // A frame pending for the previous element is cancelled in a LAYOUT cleanup:
  // it runs before this commit's layout effects, so the next element's first
  // re-read is not blocked by the old frame (a passive cleanup would run after).
  useLayoutEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    },
    [element]
  );

  useEffect(() => {
    window.addEventListener('scroll', scheduleRead, true);
    window.addEventListener('resize', scheduleRead);
    const events = ['input', 'change', 'focusin', 'focusout'] as const;
    for (const type of events) element.addEventListener(type, scheduleRead);
    const onMutations = (records: MutationRecord[]) => {
      if (pageRecords(records, element).length > 0) scheduleRead();
    };
    const elementObserver = new MutationObserver(onMutations);
    elementObserver.observe(element, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
    const pageObserver = new MutationObserver(onMutations);
    pageObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: PAGE_VISIBILITY_ATTRS,
    });
    return () => {
      window.removeEventListener('scroll', scheduleRead, true);
      window.removeEventListener('resize', scheduleRead);
      for (const type of events) element.removeEventListener(type, scheduleRead);
      elementObserver.disconnect();
      pageObserver.disconnect();
    };
  }, [element, scheduleRead]);

  // Every commit re-reads once per frame (see the component doc).
  useLayoutEffect(() => {
    scheduleRead();
  });

  // A reading taken for a previous element is never shown for this one.
  const reading = read && read.element === element ? read.reading : null;

  const identifier = createElementIdentifier(element);
  const bestId = getBestIdentifier(element);

  return (
    <div ref={panelRootRef} style={panelStyles} {...{ [INSPECTOR_PANEL_ATTR]: '' }}>
      <div style={headerStyles}>
        <span style={{ fontWeight: 'bold', color: '#60a5fa' }}>UI Bridge Inspector</span>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: '#9ca3af',
            cursor: 'pointer',
            fontSize: '16px',
          }}
        >
          ×
        </button>
      </div>

      <div style={sectionStyles}>
        <div style={{ marginBottom: '8px', fontWeight: 'bold', color: '#f3f4f6' }}>Element</div>
        <div>
          <span style={labelKeyStyles}>Tag:</span>
          <span style={valueStyles}>{element.tagName.toLowerCase()}</span>
        </div>
        <div>
          <span style={labelKeyStyles}>Best ID:</span>
          <span style={valueStyles}>{bestId}</span>
        </div>
        {identifier.testId && (
          <div>
            <span style={labelKeyStyles}>data-testid:</span>
            <span style={valueStyles}>{identifier.testId}</span>
          </div>
        )}
        {identifier.htmlId && (
          <div>
            <span style={labelKeyStyles}>id:</span>
            <span style={valueStyles}>{identifier.htmlId}</span>
          </div>
        )}
        {registeredElement && (
          <div>
            <span style={labelKeyStyles}>Registered:</span>
            <span style={{ color: '#10b981' }}>Yes ({registeredElement.type})</span>
          </div>
        )}
      </div>

      {reading ? (
        <StateSections reading={reading} />
      ) : (
        <div style={sectionStyles}>
          <span style={labelKeyStyles}>Reading state…</span>
        </div>
      )}

      <div style={{ ...sectionStyles, borderBottom: 'none' }}>
        <div style={{ marginBottom: '8px', fontWeight: 'bold', color: '#f3f4f6' }}>Selectors</div>
        <div style={{ wordBreak: 'break-all', marginBottom: '4px' }}>
          <span style={labelKeyStyles}>CSS:</span>
          <span style={valueStyles}>{identifier.selector}</span>
        </div>
        <div style={{ wordBreak: 'break-all' }}>
          <span style={labelKeyStyles}>XPath:</span>
          <span style={valueStyles}>{identifier.xpath}</span>
        </div>
      </div>

      {registeredElement && registeredElement.actions.length > 0 && (
        <div style={sectionStyles}>
          <div style={{ marginBottom: '8px', fontWeight: 'bold', color: '#f3f4f6' }}>Actions</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {registeredElement.actions.map((action) => (
              <span
                key={action}
                style={{
                  padding: '2px 8px',
                  backgroundColor: '#374151',
                  borderRadius: '4px',
                  color: '#60a5fa',
                }}
              >
                {action}
              </span>
            ))}
          </div>
        </div>
      )}

      <AnnotationSection elementId={bestId} />
    </div>
  );
}

/** The State and Bounds sections, rendered from a committed {@link InspectorStateReading}. */
function StateSections({ reading }: { reading: InspectorStateReading }) {
  const { state, coveredByPanel } = reading;
  return (
    <>
      <div style={sectionStyles}>
        <div style={{ marginBottom: '8px', fontWeight: 'bold', color: '#f3f4f6' }}>State</div>
        <div>
          <span style={labelKeyStyles}>Visible:</span>
          <span style={{ color: state.visible ? '#10b981' : '#ef4444' }}>
            {state.visible ? 'Yes' : 'No'}
          </span>
          {coveredByPanel && (
            <span style={{ color: '#fbbf24', marginLeft: '8px' }}>
              (covered by inspector panel)
            </span>
          )}
        </div>
        <div>
          <span style={labelKeyStyles}>Visibility reason:</span>
          <span style={valueStyles}>{state.visibilityReason ?? '-'}</span>
        </div>
        <div>
          <span style={labelKeyStyles}>Occluded by:</span>
          <span style={valueStyles}>
            {state.occludedBy
              ? `${state.occludedBy}${state.occludedPct !== undefined ? ` (${state.occludedPct}%)` : ''}`
              : '-'}
          </span>
        </div>
        <div>
          <span style={labelKeyStyles}>Enabled:</span>
          <span style={{ color: state.enabled ? '#10b981' : '#ef4444' }}>
            {state.enabled ? 'Yes' : 'No'}
          </span>
        </div>
        <div>
          <span style={labelKeyStyles}>Focused:</span>
          <span style={{ color: state.focused ? '#10b981' : '#9ca3af' }}>
            {state.focused ? 'Yes' : 'No'}
          </span>
        </div>
        {state.value !== undefined && (
          <div>
            <span style={labelKeyStyles}>Value:</span>
            <span style={valueStyles}>&quot;{state.value}&quot;</span>
          </div>
        )}
        {state.checked !== undefined && (
          <div>
            <span style={labelKeyStyles}>Checked:</span>
            <span style={{ color: state.checked ? '#10b981' : '#9ca3af' }}>
              {state.checked ? 'Yes' : 'No'}
            </span>
          </div>
        )}
      </div>

      <div style={sectionStyles}>
        <div style={{ marginBottom: '8px', fontWeight: 'bold', color: '#f3f4f6' }}>Bounds</div>
        <div>
          <span style={labelKeyStyles}>Position:</span>
          <span style={valueStyles}>
            ({Math.round(state.rect.x)}, {Math.round(state.rect.y)})
          </span>
        </div>
        <div>
          <span style={labelKeyStyles}>Size:</span>
          <span style={valueStyles}>
            {Math.round(state.rect.width)} × {Math.round(state.rect.height)}
          </span>
        </div>
      </div>
    </>
  );
}

/**
 * Annotation section in the inspector panel.
 * Only renders if an annotation exists for the element.
 */
function AnnotationSection({ elementId }: { elementId: string }) {
  const annotation = getGlobalAnnotationStore().get(elementId);
  if (!annotation) return null;

  return (
    <div style={{ ...sectionStyles, borderBottom: 'none' }}>
      <div style={{ marginBottom: '8px', fontWeight: 'bold', color: '#f3f4f6' }}>Annotation</div>
      {annotation.description && (
        <div style={{ marginBottom: '4px' }}>
          <span style={labelKeyStyles}>Description:</span>
          <span style={valueStyles}>{annotation.description}</span>
        </div>
      )}
      {annotation.purpose && (
        <div style={{ marginBottom: '4px' }}>
          <span style={labelKeyStyles}>Purpose:</span>
          <span style={valueStyles}>{annotation.purpose}</span>
        </div>
      )}
      {annotation.notes && (
        <div style={{ marginBottom: '4px' }}>
          <span style={labelKeyStyles}>Notes:</span>
          <span style={{ color: '#fbbf24' }}>{annotation.notes}</span>
        </div>
      )}
      {annotation.tags && annotation.tags.length > 0 && (
        <div>
          <span style={labelKeyStyles}>Tags:</span>
          <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: '4px' }}>
            {annotation.tags.map((tag) => (
              <span
                key={tag}
                style={{
                  padding: '1px 6px',
                  backgroundColor: '#1e3a5f',
                  borderRadius: '4px',
                  color: '#93c5fd',
                  fontSize: '11px',
                }}
              >
                {tag}
              </span>
            ))}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * useInspector hook options
 */
export interface UseInspectorOptions {
  /** Callback when element is selected */
  onSelect?: (element: HTMLElement) => void;
  /** Get registered element by DOM element */
  getRegisteredElement?: (element: HTMLElement) => RegisteredElement | undefined;
  /** Keyboard shortcut to toggle (default: Ctrl+Shift+I) */
  shortcut?: { key: string; ctrl?: boolean; shift?: boolean; alt?: boolean };
}

/**
 * useInspector hook
 *
 * Provides inspector functionality for debugging.
 */
export function useInspector(options: UseInspectorOptions = {}) {
  const [active, setActive] = useState(false);
  const [hoveredElement, setHoveredElement] = useState<HTMLElement | null>(null);
  const [selectedElement, setSelectedElement] = useState<HTMLElement | null>(null);

  const shortcut = useMemo(
    () => options.shortcut ?? { key: 'i', ctrl: true, shift: true },
    [options.shortcut]
  );

  // Toggle handler
  const toggle = useCallback(() => {
    setActive((prev) => !prev);
    if (active) {
      setHoveredElement(null);
      setSelectedElement(null);
    }
  }, [active]);

  // Keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key.toLowerCase() === shortcut.key &&
        e.ctrlKey === !!shortcut.ctrl &&
        e.shiftKey === !!shortcut.shift &&
        e.altKey === !!shortcut.alt
      ) {
        e.preventDefault();
        toggle();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggle, shortcut]);

  // Mouse handlers
  useEffect(() => {
    if (!active) return;

    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target && target !== hoveredElement) {
        setHoveredElement(target);
      }
    };

    const handleClick = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const target = e.target as HTMLElement;
      setSelectedElement(target);
      options.onSelect?.(target);
    };

    document.addEventListener('mouseover', handleMouseOver, true);
    document.addEventListener('click', handleClick, true);

    return () => {
      document.removeEventListener('mouseover', handleMouseOver, true);
      document.removeEventListener('click', handleClick, true);
    };
  }, [active, hoveredElement, options]);

  // Build display element (selected takes precedence over hovered)
  const displayElement = selectedElement || hoveredElement;

  // `bounds` is read at render time, so a scroll or resize under a still mouse
  // would leave the fixed overlay where the element used to be. Re-render on
  // any scroll (capture phase, so a scrolling `<body>` or inner container
  // counts too) or resize while something is highlighted.
  const [layoutTick, setLayoutTick] = useState(0);
  useEffect(() => {
    if (!active || !displayElement) return;
    const relayout = () => setLayoutTick((n) => n + 1);
    window.addEventListener('scroll', relayout, true);
    window.addEventListener('resize', relayout);
    return () => {
      window.removeEventListener('scroll', relayout, true);
      window.removeEventListener('resize', relayout);
    };
  }, [active, displayElement]);
  // `layoutTick` is read only so a scroll/resize re-render re-reads the rect.
  void layoutTick;
  const bounds = displayElement?.getBoundingClientRect() || null;
  const registeredElement = displayElement
    ? options.getRegisteredElement?.(displayElement)
    : undefined;

  return {
    active,
    toggle,
    hoveredElement,
    selectedElement,
    setSelectedElement,
    displayElement,
    bounds,
    registeredElement,
    clearSelection: () => {
      setSelectedElement(null);
    },
  };
}

/**
 * Inspector component
 *
 * Full inspector UI with overlay and info panel.
 */
export interface InspectorProps {
  /** Get registered element by DOM element */
  getRegisteredElement?: (element: HTMLElement) => RegisteredElement | undefined;
  /** Initial active state */
  initialActive?: boolean;
}

export function Inspector({ getRegisteredElement, initialActive }: InspectorProps) {
  const inspector = useInspector({
    getRegisteredElement,
  });

  // Set initial state
  useEffect(() => {
    if (initialActive && !inspector.active) {
      inspector.toggle();
    }
  }, [initialActive]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!inspector.active) return null;

  return (
    <>
      {inspector.bounds && (
        <InspectorOverlay
          bounds={inspector.bounds}
          label={inspector.displayElement ? getBestIdentifier(inspector.displayElement) : ''}
        />
      )}
      {inspector.selectedElement && (
        <InfoPanel
          element={inspector.selectedElement}
          onClose={inspector.clearSelection}
          registeredElement={inspector.registeredElement}
        />
      )}
    </>
  );
}
