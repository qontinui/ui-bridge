/** Default UI Bridge server URL */
export const DEFAULT_SERVER_URL = 'http://localhost:9876';

/** API path prefix */
export const API_PATH = '/ui-bridge';

/** Colors used throughout the extension */
export const COLORS = {
  /** Blue highlight for hovered/selected elements */
  highlight: '#3b82f6',
  highlightBg: 'rgba(59, 130, 246, 0.1)',
  /** Orange for unannotated elements in inspector mode */
  unannotated: '#f97316',
  unannotatedBorder: '2px dotted #f97316',
  /** Green for annotated elements */
  annotated: '#10b981',
  /** Dark theme background */
  bgPrimary: '#1f2937',
  bgSecondary: '#111827',
  bgTertiary: '#374151',
  /** Text colors */
  textPrimary: '#f3f4f6',
  textSecondary: '#9ca3af',
  textAccent: '#60a5fa',
  textWarning: '#fbbf24',
} as const;

/** Keyboard shortcuts */
export const SHORTCUTS = {
  toggleInspector: 'toggle-inspector',
} as const;

/** Storage keys */
export const STORAGE_KEYS = {
  serverUrl: 'uib-server-url',
  localAnnotations: 'uib-local-annotations',
  inspectorEnabled: 'uib-inspector-enabled',
} as const;
