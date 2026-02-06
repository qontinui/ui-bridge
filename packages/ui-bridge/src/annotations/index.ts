/**
 * Annotations Module
 *
 * Semantic annotation system for attaching rich human-authored
 * context to UI elements.
 */

export type {
  ElementAnnotation,
  AnnotationConfig,
  AnnotationCoverage,
  AnnotationEventType,
  AnnotationEvent,
} from './types';

export { ANNOTATION_CONFIG_VERSION } from './types';

export {
  AnnotationStore,
  getGlobalAnnotationStore,
  resetGlobalAnnotationStore,
  type AnnotationListener,
} from './store';
