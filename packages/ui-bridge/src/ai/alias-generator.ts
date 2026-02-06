/**
 * Alias Generator
 *
 * Auto-generates element aliases from visible text, aria-label, placeholders,
 * titles, and common synonyms for natural language matching.
 */

import { tokenize } from './fuzzy-matcher';

/**
 * Configuration for alias generation
 */
export interface AliasGeneratorConfig {
  /** Include text content as alias */
  includeText: boolean;
  /** Include aria-label as alias */
  includeAriaLabel: boolean;
  /** Include placeholder text as alias */
  includePlaceholder: boolean;
  /** Include title attribute as alias */
  includeTitle: boolean;
  /** Include common synonyms */
  includeSynonyms: boolean;
  /** Maximum number of aliases to generate */
  maxAliases: number;
  /** Minimum alias length */
  minLength: number;
  /** Maximum alias length */
  maxLength: number;
}

/**
 * Default alias generator configuration
 */
export const DEFAULT_ALIAS_CONFIG: AliasGeneratorConfig = {
  includeText: true,
  includeAriaLabel: true,
  includePlaceholder: true,
  includeTitle: true,
  includeSynonyms: true,
  maxAliases: 20,
  minLength: 2,
  maxLength: 50,
};

/**
 * Common synonyms for UI actions and elements
 */
const SYNONYMS: Record<string, string[]> = {
  // Submit-related
  submit: ['send', 'go', 'confirm', 'ok', 'apply', 'save', 'done', 'finish'],
  send: ['submit', 'deliver', 'post'],
  save: ['submit', 'store', 'keep', 'apply'],
  cancel: ['close', 'dismiss', 'abort', 'back', 'exit', 'quit', 'nevermind'],
  close: ['cancel', 'dismiss', 'exit', 'x'],
  delete: ['remove', 'trash', 'erase', 'clear', 'destroy'],
  remove: ['delete', 'clear', 'discard'],
  edit: ['modify', 'change', 'update', 'alter'],
  update: ['edit', 'modify', 'save', 'refresh'],
  add: ['create', 'new', 'plus', 'insert'],
  create: ['add', 'new', 'make'],
  search: ['find', 'lookup', 'query', 'filter'],
  find: ['search', 'locate', 'lookup'],
  login: ['signin', 'sign in', 'log in', 'authenticate', 'enter'],
  logout: ['signout', 'sign out', 'log out', 'exit'],
  register: ['signup', 'sign up', 'join', 'create account'],
  next: ['continue', 'forward', 'proceed', 'advance'],
  previous: ['back', 'backward', 'return', 'prior'],
  back: ['previous', 'return', 'backward'],
  start: ['begin', 'launch', 'initiate', 'run', 'execute'],
  stop: ['end', 'halt', 'pause', 'terminate'],
  enable: ['activate', 'turn on', 'switch on'],
  disable: ['deactivate', 'turn off', 'switch off'],
  show: ['display', 'reveal', 'view', 'open'],
  hide: ['conceal', 'collapse', 'close'],
  expand: ['open', 'show', 'unfold', 'reveal'],
  collapse: ['close', 'hide', 'fold', 'minimize'],
  yes: ['ok', 'confirm', 'agree', 'accept'],
  no: ['cancel', 'decline', 'reject', 'deny'],
  help: ['support', 'assistance', 'info', 'information', 'faq'],
  settings: ['preferences', 'options', 'config', 'configuration'],
  profile: ['account', 'user', 'me'],
  download: ['export', 'save', 'get'],
  upload: ['import', 'load', 'attach'],
  refresh: ['reload', 'update', 'sync'],
  copy: ['duplicate', 'clone'],
  paste: ['insert'],
  select: ['choose', 'pick'],
  toggle: ['switch', 'flip'],

  // Form fields
  email: ['e-mail', 'mail'],
  password: ['pass', 'pwd', 'secret'],
  username: ['user', 'login', 'account', 'name'],
  firstname: ['first name', 'given name', 'forename'],
  lastname: ['last name', 'surname', 'family name'],
  fullname: ['full name', 'name', 'complete name'],
  phone: ['telephone', 'tel', 'mobile', 'cell'],
  address: ['location', 'street'],
  city: ['town'],
  country: ['nation'],
  zip: ['zipcode', 'postal', 'postal code', 'postcode'],

  // Navigation
  home: ['main', 'start', 'dashboard'],
  menu: ['navigation', 'nav'],
  sidebar: ['side bar', 'side panel', 'side menu'],
};

/**
 * Element type to action word mappings
 */
const ELEMENT_ACTION_WORDS: Record<string, string[]> = {
  button: ['button', 'btn', 'click'],
  input: ['input', 'field', 'textbox', 'box'],
  textarea: ['textarea', 'text area', 'text field', 'multiline'],
  select: ['select', 'dropdown', 'combo', 'picker', 'chooser'],
  checkbox: ['checkbox', 'check', 'tick'],
  radio: ['radio', 'option', 'choice'],
  link: ['link', 'anchor', 'href'],
  form: ['form'],
  menu: ['menu'],
  menuitem: ['menu item', 'option'],
  tab: ['tab'],
  dialog: ['dialog', 'modal', 'popup'],
  switch: ['switch', 'toggle'],
  slider: ['slider', 'range'],
};

/**
 * Normalize text for alias comparison
 */
function normalizeAlias(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract words from text, handling various naming conventions
 */
function extractWords(text: string): string[] {
  const tokens = tokenize(text);
  return tokens.filter((t) => t.length >= 2);
}

/**
 * Generate aliases from text content
 */
function generateTextAliases(
  text: string | null | undefined,
  config: AliasGeneratorConfig
): string[] {
  if (!text || !config.includeText) return [];

  const aliases: string[] = [];
  const normalized = normalizeAlias(text);

  // Add full normalized text
  if (normalized.length >= config.minLength && normalized.length <= config.maxLength) {
    aliases.push(normalized);
  }

  // Add individual words
  const words = extractWords(text);
  for (const word of words) {
    if (word.length >= config.minLength) {
      aliases.push(word);
    }
  }

  // Add word combinations
  if (words.length >= 2 && words.length <= 4) {
    // First two words
    const twoWords = words.slice(0, 2).join(' ');
    if (twoWords.length <= config.maxLength) {
      aliases.push(twoWords);
    }

    // Last two words
    if (words.length > 2) {
      const lastTwo = words.slice(-2).join(' ');
      if (lastTwo.length <= config.maxLength) {
        aliases.push(lastTwo);
      }
    }
  }

  return aliases;
}

/**
 * Generate synonyms for given aliases
 */
function generateSynonyms(aliases: string[], config: AliasGeneratorConfig): string[] {
  if (!config.includeSynonyms) return [];

  const synonyms: string[] = [];

  for (const alias of aliases) {
    const words = alias.toLowerCase().split(/\s+/);

    for (const word of words) {
      if (SYNONYMS[word]) {
        for (const synonym of SYNONYMS[word]) {
          // Replace word with synonym in the alias
          const newAlias = alias.toLowerCase().replace(word, synonym);
          if (newAlias !== alias.toLowerCase()) {
            synonyms.push(newAlias);
          }

          // Also add standalone synonym
          if (synonym.length >= config.minLength) {
            synonyms.push(synonym);
          }
        }
      }
    }
  }

  return synonyms;
}

/**
 * Generate element type aliases
 */
function generateTypeAliases(elementType: string): string[] {
  const type = elementType.toLowerCase();
  return ELEMENT_ACTION_WORDS[type] || [type];
}

/**
 * Interface for element information used in alias generation
 */
export interface AliasGeneratorInput {
  /** Element text content */
  textContent?: string | null;
  /** ARIA label */
  ariaLabel?: string | null;
  /** ARIA labelledby resolved text */
  ariaLabelledBy?: string | null;
  /** Placeholder text */
  placeholder?: string | null;
  /** Title attribute */
  title?: string | null;
  /** Element type */
  elementType?: string;
  /** Element tag name */
  tagName?: string;
  /** Input type */
  inputType?: string;
  /** Element ID */
  id?: string | null;
  /** Element name attribute */
  name?: string | null;
  /** Associated label text */
  labelText?: string | null;
  /** Value attribute */
  value?: string | null;
}

/**
 * Generate aliases for an element
 */
export function generateAliases(
  input: AliasGeneratorInput,
  config: Partial<AliasGeneratorConfig> = {}
): string[] {
  const finalConfig = { ...DEFAULT_ALIAS_CONFIG, ...config };
  const aliasSet = new Set<string>();

  // Helper to add alias with deduplication and length checks
  const addAlias = (alias: string) => {
    const normalized = normalizeAlias(alias);
    if (normalized.length >= finalConfig.minLength && normalized.length <= finalConfig.maxLength) {
      aliasSet.add(normalized);
    }
  };

  // Helper to add multiple aliases
  const addAliases = (aliases: string[]) => {
    for (const alias of aliases) {
      addAlias(alias);
    }
  };

  // Generate from text content
  if (finalConfig.includeText && input.textContent) {
    addAliases(generateTextAliases(input.textContent, finalConfig));
  }

  // Generate from ARIA label
  if (finalConfig.includeAriaLabel && input.ariaLabel) {
    addAliases(generateTextAliases(input.ariaLabel, finalConfig));
  }

  // Generate from ARIA labelledby
  if (finalConfig.includeAriaLabel && input.ariaLabelledBy) {
    addAliases(generateTextAliases(input.ariaLabelledBy, finalConfig));
  }

  // Generate from placeholder
  if (finalConfig.includePlaceholder && input.placeholder) {
    addAliases(generateTextAliases(input.placeholder, finalConfig));
  }

  // Generate from title
  if (finalConfig.includeTitle && input.title) {
    addAliases(generateTextAliases(input.title, finalConfig));
  }

  // Generate from label text
  if (input.labelText) {
    addAliases(generateTextAliases(input.labelText, finalConfig));
  }

  // Generate from element ID (often meaningful)
  if (input.id) {
    addAliases(extractWords(input.id));
  }

  // Generate from name attribute
  if (input.name) {
    addAliases(extractWords(input.name));
  }

  // Generate from value for buttons/submit inputs
  if (
    input.value &&
    (input.elementType === 'button' || input.inputType === 'submit' || input.inputType === 'button')
  ) {
    addAliases(generateTextAliases(input.value, finalConfig));
  }

  // Generate type aliases
  if (input.elementType) {
    addAliases(generateTypeAliases(input.elementType));
  }

  // Generate input type aliases
  if (input.inputType) {
    addAlias(input.inputType);

    // Common input type patterns
    if (input.inputType === 'email') {
      addAliases(['email', 'e-mail', 'email address']);
    } else if (input.inputType === 'password') {
      addAliases(['password', 'pass', 'pwd']);
    } else if (input.inputType === 'tel') {
      addAliases(['phone', 'telephone', 'mobile']);
    } else if (input.inputType === 'url') {
      addAliases(['url', 'website', 'link', 'address']);
    } else if (input.inputType === 'search') {
      addAliases(['search', 'find', 'query']);
    }
  }

  // Generate synonyms for all collected aliases
  if (finalConfig.includeSynonyms) {
    const currentAliases = Array.from(aliasSet);
    addAliases(generateSynonyms(currentAliases, finalConfig));
  }

  // Convert to array and limit
  let aliases = Array.from(aliasSet);

  // Sort by length (shorter = more likely to be useful)
  aliases.sort((a, b) => a.length - b.length);

  // Limit number of aliases
  if (aliases.length > finalConfig.maxAliases) {
    aliases = aliases.slice(0, finalConfig.maxAliases);
  }

  return aliases;
}

/**
 * Generate a human-readable description for an element
 */
export function generateDescription(input: AliasGeneratorInput): string {
  const parts: string[] = [];

  // Determine the best name for the element
  let name =
    input.ariaLabel ||
    input.labelText ||
    input.textContent ||
    input.placeholder ||
    input.title ||
    input.id ||
    input.name;

  if (name) {
    name = name.trim();
    // Truncate if too long
    if (name.length > 30) {
      name = name.substring(0, 27) + '...';
    }
    parts.push(`"${name}"`);
  }

  // Add element type
  const typeWords = ELEMENT_ACTION_WORDS[input.elementType || ''] || [
    input.elementType || 'element',
  ];
  parts.push(typeWords[0]);

  // Add input type for inputs
  if (input.inputType && input.inputType !== 'text') {
    parts.push(`(${input.inputType})`);
  }

  return parts.join(' ');
}

/**
 * Generate a purpose statement for an element
 */
export function generatePurpose(input: AliasGeneratorInput): string | undefined {
  const text = (input.textContent || input.ariaLabel || input.title || '').toLowerCase();
  const type = input.elementType?.toLowerCase() || '';
  const inputType = input.inputType?.toLowerCase() || '';

  // Check for common patterns
  if (type === 'button' || inputType === 'submit') {
    if (text.match(/submit|send|save|confirm|ok|done|finish|apply/)) {
      return 'Submits the form';
    }
    if (text.match(/cancel|close|dismiss|back|exit/)) {
      return 'Cancels or closes the current action';
    }
    if (text.match(/delete|remove|trash|clear/)) {
      return 'Deletes or removes an item';
    }
    if (text.match(/edit|modify|change|update/)) {
      return 'Edits or modifies an item';
    }
    if (text.match(/add|create|new|\+/)) {
      return 'Creates or adds a new item';
    }
    if (text.match(/search|find|lookup/)) {
      return 'Performs a search';
    }
    if (text.match(/login|sign.?in/)) {
      return 'Signs the user in';
    }
    if (text.match(/logout|sign.?out/)) {
      return 'Signs the user out';
    }
    if (text.match(/register|sign.?up|join/)) {
      return 'Creates a new account';
    }
    if (text.match(/next|continue|proceed/)) {
      return 'Proceeds to the next step';
    }
    if (text.match(/previous|back|return/)) {
      return 'Returns to the previous step';
    }
  }

  if (type === 'input' || type === 'textarea') {
    if (inputType === 'email') return 'Accepts email address input';
    if (inputType === 'password') return 'Accepts password input';
    if (inputType === 'search') return 'Accepts search query input';
    if (inputType === 'tel') return 'Accepts phone number input';
    if (inputType === 'url') return 'Accepts URL input';
    if (inputType === 'number') return 'Accepts numeric input';
    if (inputType === 'date') return 'Accepts date input';
    if (inputType === 'file') return 'Accepts file upload';
  }

  if (type === 'checkbox') {
    return 'Toggles an option on or off';
  }

  if (type === 'radio') {
    return 'Selects one option from a group';
  }

  if (type === 'select') {
    return 'Selects an option from a dropdown';
  }

  if (type === 'link') {
    return 'Navigates to another page';
  }

  return undefined;
}

/**
 * Generate suggested actions for an element
 */
export function generateSuggestedActions(input: AliasGeneratorInput): string[] {
  const type = input.elementType?.toLowerCase() || '';
  const inputType = input.inputType?.toLowerCase() || '';
  const text = (input.textContent || input.ariaLabel || '').toLowerCase();
  const actions: string[] = [];

  switch (type) {
    case 'button':
      actions.push(`click "${text || 'this button'}"`);
      break;
    case 'input':
      if (inputType === 'checkbox') {
        actions.push('check to enable', 'uncheck to disable');
      } else if (inputType === 'radio') {
        actions.push('select this option');
      } else {
        actions.push(`type into "${text || 'this field'}"`);
        actions.push('clear the field');
      }
      break;
    case 'textarea':
      actions.push(`type into "${text || 'this text area'}"`);
      actions.push('clear the content');
      break;
    case 'select':
      actions.push(`select an option from "${text || 'this dropdown'}"`);
      break;
    case 'checkbox':
      actions.push('check to enable', 'uncheck to disable');
      break;
    case 'radio':
      actions.push('select this option');
      break;
    case 'link':
      actions.push(`click to navigate to "${text || 'the linked page'}"`);
      break;
    case 'switch':
      actions.push('toggle on', 'toggle off');
      break;
    default:
      actions.push('click');
  }

  return actions;
}

/**
 * Get synonyms for a word
 */
export function getSynonyms(word: string): string[] {
  const normalized = word.toLowerCase().trim();
  return SYNONYMS[normalized] || [];
}

/**
 * Check if two words are synonyms
 */
export function areSynonyms(word1: string, word2: string): boolean {
  const w1 = word1.toLowerCase().trim();
  const w2 = word2.toLowerCase().trim();

  if (w1 === w2) return true;

  const synonyms1 = SYNONYMS[w1] || [];
  const synonyms2 = SYNONYMS[w2] || [];

  return synonyms1.includes(w2) || synonyms2.includes(w1);
}
