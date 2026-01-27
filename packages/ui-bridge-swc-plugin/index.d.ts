/**
 * UI Bridge SWC Plugin Configuration
 */
export interface UIBridgeSwcPluginConfig {
  /**
   * Elements to automatically instrument
   * @default ['button', 'input', 'select', 'textarea', 'a', 'form']
   */
  elements?: string[];

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
 * Path to the WASM plugin file
 */
declare const pluginPath: string;
export default pluginPath;
