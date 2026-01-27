/**
 * Alias Generator
 *
 * Generates search aliases from element text, aria labels, and other attributes.
 */

import type { PluginConfig } from './config';

/**
 * Context for generating aliases
 */
export interface AliasGeneratorContext {
  /** Element tag name */
  tagName: string;
  /** Text content */
  textContent: string | null;
  /** Aria label */
  ariaLabel: string | null;
  /** Placeholder text */
  placeholder: string | null;
  /** Title attribute */
  title: string | null;
  /** Name attribute */
  name: string | null;
  /** ID attribute */
  id: string | null;
}

/**
 * Common word synonyms for UI actions
 */
const SYNONYMS: Record<string, string[]> = {
  submit: ['send', 'go', 'confirm', 'done', 'ok', 'apply'],
  cancel: ['close', 'dismiss', 'abort', 'back', 'exit'],
  delete: ['remove', 'trash', 'erase', 'clear'],
  edit: ['modify', 'change', 'update'],
  add: ['create', 'new', 'plus', 'insert'],
  save: ['store', 'keep', 'preserve'],
  search: ['find', 'lookup', 'query'],
  login: ['signin', 'sign in', 'log in'],
  logout: ['signout', 'sign out', 'log out'],
  register: ['signup', 'sign up', 'join'],
  next: ['continue', 'forward', 'proceed'],
  previous: ['back', 'prev', 'prior'],
  start: ['begin', 'launch', 'run'],
  stop: ['end', 'halt', 'pause'],
  upload: ['attach', 'import'],
  download: ['export', 'get'],
  settings: ['preferences', 'options', 'config'],
  help: ['support', 'info', 'about'],
  home: ['main', 'dashboard'],
  profile: ['account', 'user'],
};

/**
 * Normalize text for alias matching
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Tokenize text into words
 */
function tokenize(text: string): string[] {
  return normalizeText(text)
    .split(' ')
    .filter((word) => word.length > 1);
}

/**
 * Get synonyms for a word
 */
function getSynonyms(word: string): string[] {
  const normalized = word.toLowerCase();

  // Check if word is in synonyms
  if (SYNONYMS[normalized]) {
    return SYNONYMS[normalized];
  }

  // Check if word is a synonym of something
  for (const [key, values] of Object.entries(SYNONYMS)) {
    if (values.includes(normalized)) {
      return [key, ...values.filter((v) => v !== normalized)];
    }
  }

  return [];
}

/**
 * Generate n-grams from tokens
 */
function generateNgrams(tokens: string[], n: number): string[] {
  const ngrams: string[] = [];

  for (let i = 0; i <= tokens.length - n; i++) {
    ngrams.push(tokens.slice(i, i + n).join(' '));
  }

  return ngrams;
}

/**
 * Generate aliases for an element
 */
export function generateAliases(
  context: AliasGeneratorContext,
  config: Required<PluginConfig>
): string[] {
  const aliases = new Set<string>();

  // Add text content
  if (context.textContent) {
    const normalized = normalizeText(context.textContent);
    if (normalized) {
      aliases.add(normalized);

      // Add individual tokens
      const tokens = tokenize(context.textContent);
      for (const token of tokens) {
        if (token.length >= 3) {
          aliases.add(token);
        }

        // Add synonyms
        for (const synonym of getSynonyms(token)) {
          aliases.add(synonym);
        }
      }

      // Add bi-grams
      if (tokens.length >= 2) {
        for (const ngram of generateNgrams(tokens, 2)) {
          aliases.add(ngram);
        }
      }
    }
  }

  // Add aria label
  if (context.ariaLabel) {
    const normalized = normalizeText(context.ariaLabel);
    if (normalized) {
      aliases.add(normalized);
    }
  }

  // Add placeholder
  if (context.placeholder) {
    const normalized = normalizeText(context.placeholder);
    if (normalized) {
      aliases.add(normalized);
    }
  }

  // Add title
  if (context.title) {
    const normalized = normalizeText(context.title);
    if (normalized) {
      aliases.add(normalized);
    }
  }

  // Add name attribute (often semantic)
  if (context.name) {
    const normalized = normalizeText(context.name).replace(/-/g, ' ');
    if (normalized) {
      aliases.add(normalized);
    }
  }

  // Add element type
  const typeAlias = getElementTypeAlias(context.tagName);
  if (typeAlias) {
    aliases.add(typeAlias);
  }

  // Convert to array and limit
  const result = Array.from(aliases)
    .filter((alias) => alias.length >= 2 && alias.length <= 50)
    .slice(0, config.maxAliases);

  return result;
}

/**
 * Get type alias for element
 */
function getElementTypeAlias(tagName: string): string | null {
  const tag = tagName.toLowerCase();

  const typeAliases: Record<string, string> = {
    button: 'button',
    input: 'input',
    select: 'dropdown',
    textarea: 'text area',
    a: 'link',
    form: 'form',
    nav: 'navigation',
    img: 'image',
  };

  return typeAliases[tag] || null;
}

/**
 * Format aliases for attribute value
 */
export function formatAliasesAttribute(aliases: string[]): string {
  return aliases.join(',');
}

/**
 * Determine if aliases should be generated for this element
 */
export function shouldGenerateAliases(
  context: AliasGeneratorContext,
  config: Required<PluginConfig>
): boolean {
  if (!config.generateAliases) {
    return false;
  }

  // Need at least some content to generate aliases
  return !!(
    context.textContent ||
    context.ariaLabel ||
    context.placeholder ||
    context.title ||
    context.name
  );
}
