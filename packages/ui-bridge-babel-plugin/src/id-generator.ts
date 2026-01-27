/**
 * ID Generator
 *
 * Generates stable, unique IDs for UI elements based on component path,
 * element type, and content.
 */

import type { PluginConfig } from './config';

/**
 * Context for generating element IDs
 */
export interface IdGeneratorContext {
  /** Component name */
  componentName: string | null;
  /** File path */
  filePath: string;
  /** Element tag name */
  tagName: string;
  /** Element text content */
  textContent: string | null;
  /** Aria label */
  ariaLabel: string | null;
  /** Placeholder text */
  placeholder: string | null;
  /** Title attribute */
  title: string | null;
  /** Element index in component (for uniqueness) */
  elementIndex: number;
  /** Existing id attribute */
  existingId: string | null;
}

/**
 * Simple hash function for ID generation
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  // Convert to positive hex string
  return Math.abs(hash).toString(16).substring(0, 8);
}

/**
 * Normalize text for use in ID
 */
function normalizeForId(text: string): string {
  return text
    .toLowerCase()
    .trim()
    // Replace non-alphanumeric with dash
    .replace(/[^a-z0-9]+/g, '-')
    // Remove leading/trailing dashes
    .replace(/^-+|-+$/g, '')
    // Collapse multiple dashes
    .replace(/-+/g, '-')
    // Limit length
    .substring(0, 30);
}

/**
 * Extract component name from file path
 */
export function extractComponentFromPath(filePath: string): string | null {
  // Normalize path separators
  const normalized = filePath.replace(/\\/g, '/');

  // Get filename without extension
  const match = normalized.match(/\/([^/]+)\.(tsx?|jsx?)$/);
  if (!match) return null;

  const filename = match[1];

  // Skip index files
  if (filename === 'index') {
    // Try to get parent folder name
    const parentMatch = normalized.match(/\/([^/]+)\/index\.(tsx?|jsx?)$/);
    if (parentMatch) {
      return normalizeForId(parentMatch[1]);
    }
  }

  return normalizeForId(filename);
}

/**
 * Get semantic type for element
 */
export function getSemanticType(tagName: string, context: IdGeneratorContext): string {
  const tag = tagName.toLowerCase();

  // Check for specific input types
  if (tag === 'input') {
    // Would need to check type attribute, for now just return 'input'
    return 'input';
  }

  // Check for specific button purposes
  if (tag === 'button') {
    const text = context.textContent?.toLowerCase() || '';
    if (text.includes('submit') || text.includes('save')) return 'submit-button';
    if (text.includes('cancel') || text.includes('close')) return 'cancel-button';
    if (text.includes('delete') || text.includes('remove')) return 'delete-button';
    return 'button';
  }

  // Map tags to semantic types
  const typeMap: Record<string, string> = {
    a: 'link',
    select: 'dropdown',
    textarea: 'textarea',
    form: 'form',
    nav: 'navigation',
    header: 'header',
    footer: 'footer',
    main: 'main',
    aside: 'sidebar',
    dialog: 'dialog',
    img: 'image',
  };

  return typeMap[tag] || tag;
}

/**
 * Generate a unique ID for an element
 */
export function generateId(
  context: IdGeneratorContext,
  config: Required<PluginConfig>
): string {
  const parts: string[] = [];

  // Add prefix
  if (config.idPrefix) {
    parts.push(config.idPrefix);
  }

  // Add file path component
  if (config.includeFilePath) {
    const fileComponent = extractComponentFromPath(context.filePath);
    if (fileComponent) {
      parts.push(fileComponent);
    }
  }

  // Add component name
  if (config.includeComponentName && context.componentName) {
    parts.push(normalizeForId(context.componentName));
  }

  // Add descriptive part from text/aria/placeholder
  const descriptiveText =
    context.textContent ||
    context.ariaLabel ||
    context.placeholder ||
    context.title ||
    context.existingId;

  if (descriptiveText) {
    parts.push(normalizeForId(descriptiveText));
  }

  // Add semantic type
  const semanticType = getSemanticType(context.tagName, context);
  parts.push(semanticType);

  // Generate base ID
  let id = parts.filter(Boolean).join('-');

  // If ID is empty or too short, use index
  if (id.length < 5) {
    id = `${config.idPrefix}-${context.tagName}-${context.elementIndex}`;
  }

  // Hash if configured
  if (config.hashIds) {
    const hash = simpleHash(id + context.filePath + context.elementIndex);
    id = `${config.idPrefix}-${hash}`;
  }

  return id;
}

/**
 * Counter for element indices per file
 */
const fileElementCounters = new Map<string, Map<string, number>>();

/**
 * Get next element index for a file/tag combination
 */
export function getNextElementIndex(filePath: string, tagName: string): number {
  if (!fileElementCounters.has(filePath)) {
    fileElementCounters.set(filePath, new Map());
  }

  const fileCounters = fileElementCounters.get(filePath)!;
  const current = fileCounters.get(tagName) || 0;
  fileCounters.set(tagName, current + 1);

  return current;
}

/**
 * Reset counters for a file (call at start of file processing)
 */
export function resetFileCounters(filePath: string): void {
  fileElementCounters.delete(filePath);
}
