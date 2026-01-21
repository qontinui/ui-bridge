/**
 * UI Bridge Render Log Module
 *
 * DOM observation and logging functionality.
 */

// DOM capture utilities
export {
  captureDOMSnapshot,
  captureInteractiveElements,
  DOMChangeObserver,
  type CapturedElement,
  type DOMSnapshot,
  type DOMChange,
  type CaptureOptions,
} from './dom-capture';

// Render log management
export {
  RenderLogManager,
  InMemoryRenderLogStorage,
  createRenderLogManager,
  type RenderLogEntry,
  type SnapshotEntry,
  type ChangeEntry,
  type NavigationEntry,
  type InteractionEntry,
  type ErrorEntry,
  type RenderLogEntryType,
  type RenderLogStorage,
  type RenderLogOptions,
} from './snapshot';
