/** Connection status to the UI Bridge server */
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/** Summary of a UI element from the bridge */
export interface ElementSummary {
  id: string;
  type: string;
  label?: string;
  hasAnnotation: boolean;
}

/** Annotation data (mirrors core ElementAnnotation) */
export interface Annotation {
  description?: string;
  purpose?: string;
  notes?: string;
  tags?: string[];
  relatedElements?: string[];
  metadata?: Record<string, unknown>;
  updatedAt?: number;
  author?: string;
}

/** Purpose dropdown options */
export const ANNOTATION_PURPOSES = [
  'Navigation',
  'Form input',
  'Action trigger',
  'Display',
  'Container',
  'Feedback',
  'Other',
] as const;

export type AnnotationPurpose = (typeof ANNOTATION_PURPOSES)[number];

/** Coverage stats */
export interface CoverageStats {
  total: number;
  annotated: number;
  percent: number;
}
