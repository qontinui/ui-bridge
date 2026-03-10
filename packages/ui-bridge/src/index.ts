/**
 * UI Bridge
 *
 * A unified, modular framework for AI-driven UI observation, control, and debugging.
 *
 * @packageDocumentation
 */

// Core module - types and infrastructure
export * from './core';

// React module - hooks and providers
export * from './react';

// Control module - action execution and workflows
export * from './control';

// Render log module - DOM observation
export * from './render-log';

// Debug module - inspector and metrics
export * from './debug';

// AI module - natural language interaction
export * from './ai';

// Annotations module - semantic element annotations
export * from './annotations';

// Specs module - declarative UI element specifications
export * from './specs';

// Idle detection module - app idle/busy detection
export * from './idle';

// Navigation module - page/route awareness
export * from './navigation';

// Shortcuts module - keyboard shortcut discovery
export * from './shortcuts';

// Adapters module - opt-in form framework adapters
export * from './adapters';

// Modal module - modal/dialog stack detection
export * from './modal';

// Toast module - toast/notification capture
export * from './toast';

// Relationships module - element relationship tracking
export * from './relationships';

// Drag-drop module - drag source and drop zone discovery
export * from './drag-drop';

// Network module - request lifecycle monitoring
export * from './network';

// Undo module - undo/redo awareness
export * from './undo';
