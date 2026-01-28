/**
 * Plugin Configuration
 *
 * Configuration options for the UI Bridge Babel plugin.
 */

/**
 * Elements to instrument
 */
export type InstrumentableElement =
  | 'button'
  | 'input'
  | 'select'
  | 'textarea'
  | 'a'
  | 'form'
  | 'label'
  | 'img'
  | 'video'
  | 'audio'
  | 'dialog'
  | 'details'
  | 'summary'
  | 'nav'
  | 'header'
  | 'footer'
  | 'main'
  | 'aside'
  | 'section'
  | 'article';

/**
 * Plugin configuration options
 */
export interface PluginConfig {
  /**
   * Include specific file patterns (glob)
   * @default ['**\/*.tsx', '**\/*.jsx']
   */
  include?: string[];

  /**
   * Exclude specific file patterns (glob)
   * @default ['**\/node_modules/**', '**\/*.test.*', '**\/*.spec.*']
   */
  exclude?: string[];

  /**
   * Elements to automatically instrument
   * @default ['button', 'input', 'select', 'textarea', 'a', 'form']
   */
  elements?: InstrumentableElement[];

  /**
   * Prefix for generated IDs
   * @default 'ui'
   */
  idPrefix?: string;

  /**
   * Attribute name for the generated ID
   * @default 'data-ui-id'
   */
  idAttribute?: string;

  /**
   * Attribute name for aliases
   * @default 'data-ui-aliases'
   */
  aliasesAttribute?: string;

  /**
   * Attribute name for element type
   * @default 'data-ui-type'
   */
  typeAttribute?: string;

  /**
   * Generate aliases from text content
   * @default true
   */
  generateAliases?: boolean;

  /**
   * Include component name in generated ID
   * @default true
   */
  includeComponentName?: boolean;

  /**
   * Include file path in generated ID
   * @default false
   */
  includeFilePath?: boolean;

  /**
   * Hash the generated ID for shorter strings
   * @default false
   */
  hashIds?: boolean;

  /**
   * Maximum alias count per element
   * @default 5
   */
  maxAliases?: number;

  /**
   * Skip elements that already have data-ui-id
   * @default true
   */
  skipExisting?: boolean;

  /**
   * Only instrument elements inside components with specific names
   * @default []
   */
  onlyInComponents?: string[];

  /**
   * Skip instrumentation for elements inside these components
   * @default []
   */
  skipInComponents?: string[];

  /**
   * Enable verbose logging during build
   * @default false
   */
  verbose?: boolean;
}

/**
 * Default configuration
 */
export const DEFAULT_CONFIG: Required<PluginConfig> = {
  include: ['**/*.tsx', '**/*.jsx'],
  exclude: ['**/node_modules/**', '**/*.test.*', '**/*.spec.*', '**/*.stories.*'],
  elements: ['button', 'input', 'select', 'textarea', 'a', 'form'],
  idPrefix: 'ui',
  idAttribute: 'data-ui-id',
  aliasesAttribute: 'data-ui-aliases',
  typeAttribute: 'data-ui-type',
  generateAliases: true,
  includeComponentName: true,
  includeFilePath: false,
  hashIds: false,
  maxAliases: 5,
  skipExisting: true,
  onlyInComponents: [],
  skipInComponents: [],
  verbose: false,
};

/**
 * Merge user config with defaults
 */
export function mergeConfig(userConfig: PluginConfig = {}): Required<PluginConfig> {
  return {
    ...DEFAULT_CONFIG,
    ...userConfig,
    // Ensure arrays are properly merged
    include: userConfig.include ?? DEFAULT_CONFIG.include,
    exclude: userConfig.exclude ?? DEFAULT_CONFIG.exclude,
    elements: userConfig.elements ?? DEFAULT_CONFIG.elements,
    onlyInComponents: userConfig.onlyInComponents ?? DEFAULT_CONFIG.onlyInComponents,
    skipInComponents: userConfig.skipInComponents ?? DEFAULT_CONFIG.skipInComponents,
  };
}

/**
 * Check if a file should be processed based on include/exclude patterns
 */
export function shouldProcessFile(
  filename: string,
  config: Required<PluginConfig>
): boolean {
  // Simple pattern matching (for full glob support, use micromatch)
  const matchPattern = (pattern: string, path: string): boolean => {
    // Simple extension-based matching for common patterns
    // **/*.tsx -> match any .tsx file
    // **/*.test.* -> match any file with .test. in name

    // Handle **/*.ext pattern (match files with extension anywhere)
    if (pattern.startsWith('**/')) {
      const restOfPattern = pattern.slice(3); // Remove **/

      // Handle **/dir/** patterns
      if (restOfPattern.includes('/**')) {
        const dir = restOfPattern.replace('/**', '');
        return path.includes('/' + dir + '/') || path.startsWith(dir + '/');
      }

      // Handle **/*.test.* or **/*.spec.* (files with .test. or .spec. in name)
      // Must check this BEFORE the simple extension check
      if (restOfPattern.startsWith('*.') && restOfPattern.endsWith('.*') && restOfPattern.length > 3) {
        const middle = restOfPattern.slice(2, -2); // Get middle part like "test" or "spec"
        const fileName = path.includes('/') ? path.split('/').pop() || path : path;
        return fileName.includes('.' + middle + '.');
      }

      // Handle **/*.ext (any file with simple extension like .tsx, .jsx)
      if (restOfPattern.startsWith('*.') && !restOfPattern.slice(2).includes('*')) {
        const ext = restOfPattern.slice(1); // Get .ext part
        return path.endsWith(ext);
      }
    }

    // Fallback: exact match
    return path === pattern;
  };

  // Normalize path
  const normalizedPath = filename.replace(/\\/g, '/');

  // Check exclude patterns first
  for (const pattern of config.exclude) {
    if (matchPattern(pattern, normalizedPath)) {
      return false;
    }
  }

  // Check include patterns
  for (const pattern of config.include) {
    if (matchPattern(pattern, normalizedPath)) {
      return true;
    }
  }

  return false;
}
