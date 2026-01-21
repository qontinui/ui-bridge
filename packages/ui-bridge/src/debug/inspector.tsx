/**
 * Element Inspector
 *
 * Visual debugging tools for inspecting UI elements.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { RegisteredElement, ElementState, ElementIdentifier } from '../core/types';
import { createElementIdentifier, getBestIdentifier } from '../core/element-identifier';

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

/**
 * Get element state
 */
function getElementState(element: HTMLElement): ElementState {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);

  const state: ElementState = {
    visible: rect.width > 0 && rect.height > 0 && style.display !== 'none',
    enabled: !('disabled' in element && (element as HTMLInputElement).disabled),
    focused: document.activeElement === element,
    rect: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
    },
    computedStyles: {
      display: style.display,
      visibility: style.visibility,
      opacity: style.opacity,
      pointerEvents: style.pointerEvents,
    },
  };

  if (element instanceof HTMLInputElement) {
    state.value = element.value;
    if (element.type === 'checkbox' || element.type === 'radio') {
      state.checked = element.checked;
    }
  }

  return state;
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
        left: bounds.left + window.scrollX,
        top: bounds.top + window.scrollY,
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

  const identifier = createElementIdentifier(element);
  const state = getElementState(element);
  const bestId = getBestIdentifier(element);

  return (
    <div style={panelStyles}>
      <div style={headerStyles}>
        <span style={{ fontWeight: 'bold', color: '#60a5fa' }}>
          UI Bridge Inspector
        </span>
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
        <div style={{ marginBottom: '8px', fontWeight: 'bold', color: '#f3f4f6' }}>
          Element
        </div>
        <div>
          <span style={labelKeyStyles}>Tag:</span>
          <span style={valueStyles}>{element.tagName.toLowerCase()}</span>
        </div>
        <div>
          <span style={labelKeyStyles}>Best ID:</span>
          <span style={valueStyles}>{bestId}</span>
        </div>
        {identifier.uiId && (
          <div>
            <span style={labelKeyStyles}>data-ui-id:</span>
            <span style={valueStyles}>{identifier.uiId}</span>
          </div>
        )}
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

      <div style={sectionStyles}>
        <div style={{ marginBottom: '8px', fontWeight: 'bold', color: '#f3f4f6' }}>
          State
        </div>
        <div>
          <span style={labelKeyStyles}>Visible:</span>
          <span style={{ color: state.visible ? '#10b981' : '#ef4444' }}>
            {state.visible ? 'Yes' : 'No'}
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
        <div style={{ marginBottom: '8px', fontWeight: 'bold', color: '#f3f4f6' }}>
          Bounds
        </div>
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

      <div style={{ ...sectionStyles, borderBottom: 'none' }}>
        <div style={{ marginBottom: '8px', fontWeight: 'bold', color: '#f3f4f6' }}>
          Selectors
        </div>
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
        <div style={{ ...sectionStyles, borderBottom: 'none' }}>
          <div style={{ marginBottom: '8px', fontWeight: 'bold', color: '#f3f4f6' }}>
            Actions
          </div>
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
          label={
            inspector.displayElement
              ? getBestIdentifier(inspector.displayElement)
              : ''
          }
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
