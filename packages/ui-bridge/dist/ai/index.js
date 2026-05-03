'use strict';

// src/ai/fuzzy-matcher.ts
var DEFAULT_FUZZY_CONFIG = {
  threshold: 0.7,
  levenshteinWeight: 0.3,
  jaroWinklerWeight: 0.4,
  ngramWeight: 0.3,
  ngramSize: 2,
  caseSensitive: false,
  ignoreWhitespace: true
};
function levenshteinDistance(s1, s2) {
  const len1 = s1.length;
  const len2 = s2.length;
  const matrix = Array(len1 + 1).fill(null).map(() => Array(len2 + 1).fill(0));
  for (let i = 0; i <= len1; i++) matrix[i][0] = i;
  for (let j = 0; j <= len2; j++) matrix[0][j] = j;
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        // deletion
        matrix[i][j - 1] + 1,
        // insertion
        matrix[i - 1][j - 1] + cost
        // substitution
      );
    }
  }
  return matrix[len1][len2];
}
function levenshteinSimilarity(s1, s2) {
  if (s1.length === 0 && s2.length === 0) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;
  const distance = levenshteinDistance(s1, s2);
  const maxLength = Math.max(s1.length, s2.length);
  return 1 - distance / maxLength;
}
function jaroSimilarity(s1, s2) {
  if (s1.length === 0 && s2.length === 0) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;
  const matchDistance = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
  const s1Matches = new Array(s1.length).fill(false);
  const s2Matches = new Array(s2.length).fill(false);
  let matches = 0;
  let transpositions = 0;
  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, s2.length);
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }
  return (matches / s1.length + matches / s2.length + (matches - transpositions / 2) / matches) / 3;
}
function jaroWinklerSimilarity(s1, s2, prefixScale = 0.1) {
  const jaroSim = jaroSimilarity(s1, s2);
  let prefixLength = 0;
  const maxPrefix = Math.min(4, Math.min(s1.length, s2.length));
  for (let i = 0; i < maxPrefix; i++) {
    if (s1[i] === s2[i]) {
      prefixLength++;
    } else {
      break;
    }
  }
  return jaroSim + prefixLength * prefixScale * (1 - jaroSim);
}
function generateNgrams(s, n) {
  const ngrams = /* @__PURE__ */ new Set();
  if (s.length < n) {
    ngrams.add(s);
    return ngrams;
  }
  for (let i = 0; i <= s.length - n; i++) {
    ngrams.add(s.substring(i, i + n));
  }
  return ngrams;
}
function ngramSimilarity(s1, s2, n = 2) {
  if (s1.length === 0 && s2.length === 0) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;
  const ngrams1 = generateNgrams(s1, n);
  const ngrams2 = generateNgrams(s2, n);
  let intersection = 0;
  for (const ngram of ngrams1) {
    if (ngrams2.has(ngram)) {
      intersection++;
    }
  }
  const union = ngrams1.size + ngrams2.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
function normalizeString(s, config = {}) {
  let normalized = s;
  if (!config.caseSensitive) {
    normalized = normalized.toLowerCase();
  }
  if (config.ignoreWhitespace !== false) {
    normalized = normalized.replace(/\s+/g, " ").trim();
  }
  return normalized;
}
function fuzzyMatch(source, target, config = {}) {
  const finalConfig = { ...DEFAULT_FUZZY_CONFIG, ...config };
  const normalizedSource = normalizeString(source, finalConfig);
  const normalizedTarget = normalizeString(target, finalConfig);
  const levenshteinScore = levenshteinSimilarity(normalizedSource, normalizedTarget);
  const jaroWinklerScore = jaroWinklerSimilarity(normalizedSource, normalizedTarget);
  const ngramScore = ngramSimilarity(normalizedSource, normalizedTarget, finalConfig.ngramSize);
  const similarity = levenshteinScore * finalConfig.levenshteinWeight + jaroWinklerScore * finalConfig.jaroWinklerWeight + ngramScore * finalConfig.ngramWeight;
  return {
    similarity,
    isMatch: similarity >= finalConfig.threshold,
    scores: {
      levenshtein: levenshteinScore,
      jaroWinkler: jaroWinklerScore,
      ngram: ngramScore
    },
    normalizedSource,
    normalizedTarget
  };
}
function findBestMatch(source, candidates, config = {}) {
  if (candidates.length === 0) {
    return { match: null, index: -1, result: null };
  }
  let bestMatch = null;
  let bestIndex = -1;
  let bestResult = null;
  for (let i = 0; i < candidates.length; i++) {
    const result = fuzzyMatch(source, candidates[i], config);
    if (result.isMatch && (!bestResult || result.similarity > bestResult.similarity)) {
      bestMatch = candidates[i];
      bestIndex = i;
      bestResult = result;
    }
  }
  return { match: bestMatch, index: bestIndex, result: bestResult };
}
function findAllMatches(source, candidates, config = {}) {
  const matches = [];
  for (let i = 0; i < candidates.length; i++) {
    const result = fuzzyMatch(source, candidates[i], config);
    if (result.isMatch) {
      matches.push({ candidate: candidates[i], index: i, result });
    }
  }
  matches.sort((a, b) => b.result.similarity - a.result.similarity);
  return matches;
}
function fuzzyContains(source, target, config = {}) {
  const finalConfig = { ...DEFAULT_FUZZY_CONFIG, ...config };
  const normalizedSource = normalizeString(source, finalConfig);
  const normalizedTarget = normalizeString(target, finalConfig);
  if (normalizedSource.includes(normalizedTarget)) {
    return true;
  }
  const sourceWords = normalizedSource.split(/\s+/);
  const targetWords = normalizedTarget.split(/\s+/);
  for (const targetWord of targetWords) {
    const hasMatch = sourceWords.some((sourceWord) => {
      const result = fuzzyMatch(sourceWord, targetWord, { ...finalConfig, threshold: 0.8 });
      return result.isMatch;
    });
    if (!hasMatch) {
      return false;
    }
  }
  return true;
}
function wordSimilarity(s1, s2, config = {}) {
  const finalConfig = { ...DEFAULT_FUZZY_CONFIG, ...config };
  const words1 = normalizeString(s1, finalConfig).split(/\s+/);
  const words2 = normalizeString(s2, finalConfig).split(/\s+/);
  if (words1.length === 0 && words2.length === 0) return 1;
  if (words1.length === 0 || words2.length === 0) return 0;
  let totalSimilarity = 0;
  let matchCount = 0;
  for (const word1 of words1) {
    let bestSim = 0;
    for (const word2 of words2) {
      const result = fuzzyMatch(word1, word2, finalConfig);
      if (result.similarity > bestSim) {
        bestSim = result.similarity;
      }
    }
    totalSimilarity += bestSim;
    if (bestSim >= finalConfig.threshold) {
      matchCount++;
    }
  }
  const avgSimilarity = totalSimilarity / words1.length;
  const matchRatio = matchCount / Math.max(words1.length, words2.length);
  return avgSimilarity * 0.5 + matchRatio * 0.5;
}
function tokenize(s) {
  return s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ").replace(/\s+/g, " ").trim().toLowerCase().split(" ").filter((token) => token.length > 0);
}
function tokenSimilarity(s1, s2) {
  const tokens1 = tokenize(s1);
  const tokens2 = tokenize(s2);
  if (tokens1.length === 0 && tokens2.length === 0) return 1;
  if (tokens1.length === 0 || tokens2.length === 0) return 0;
  const set1 = new Set(tokens1);
  const set2 = new Set(tokens2);
  let intersection = 0;
  for (const token of set1) {
    if (set2.has(token)) {
      intersection++;
    }
  }
  const union = set1.size + set2.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// src/ai/alias-generator.ts
var DEFAULT_ALIAS_CONFIG = {
  includeText: true,
  includeAriaLabel: true,
  includePlaceholder: true,
  includeTitle: true,
  includeSynonyms: true,
  maxAliases: 20,
  minLength: 2,
  maxLength: 50
};
var SYNONYMS = {
  // Submit-related
  submit: ["send", "go", "confirm", "ok", "apply", "save", "done", "finish"],
  send: ["submit", "deliver", "post"],
  save: ["submit", "store", "keep", "apply"],
  cancel: ["close", "dismiss", "abort", "back", "exit", "quit", "nevermind"],
  close: ["cancel", "dismiss", "exit", "x"],
  delete: ["remove", "trash", "erase", "clear", "destroy"],
  remove: ["delete", "clear", "discard"],
  edit: ["modify", "change", "update", "alter"],
  update: ["edit", "modify", "save", "refresh"],
  add: ["create", "new", "plus", "insert"],
  create: ["add", "new", "make"],
  search: ["find", "lookup", "query", "filter"],
  find: ["search", "locate", "lookup"],
  login: ["signin", "sign in", "log in", "authenticate", "enter"],
  logout: ["signout", "sign out", "log out", "exit"],
  register: ["signup", "sign up", "join", "create account"],
  next: ["continue", "forward", "proceed", "advance"],
  previous: ["back", "backward", "return", "prior"],
  back: ["previous", "return", "backward"],
  start: ["begin", "launch", "initiate", "run", "execute"],
  stop: ["end", "halt", "pause", "terminate"],
  enable: ["activate", "turn on", "switch on"],
  disable: ["deactivate", "turn off", "switch off"],
  show: ["display", "reveal", "view", "open"],
  hide: ["conceal", "collapse", "close"],
  expand: ["open", "show", "unfold", "reveal"],
  collapse: ["close", "hide", "fold", "minimize"],
  yes: ["ok", "confirm", "agree", "accept"],
  no: ["cancel", "decline", "reject", "deny"],
  help: ["support", "assistance", "info", "information", "faq"],
  settings: ["preferences", "options", "config", "configuration"],
  profile: ["account", "user", "me"],
  download: ["export", "save", "get"],
  upload: ["import", "load", "attach"],
  refresh: ["reload", "update", "sync"],
  copy: ["duplicate", "clone"],
  paste: ["insert"],
  select: ["choose", "pick"],
  toggle: ["switch", "flip"],
  // Form fields
  email: ["e-mail", "mail"],
  password: ["pass", "pwd", "secret"],
  username: ["user", "login", "account", "name"],
  firstname: ["first name", "given name", "forename"],
  lastname: ["last name", "surname", "family name"],
  fullname: ["full name", "name", "complete name"],
  phone: ["telephone", "tel", "mobile", "cell"],
  address: ["location", "street"],
  city: ["town"],
  country: ["nation"],
  zip: ["zipcode", "postal", "postal code", "postcode"],
  // Navigation
  home: ["main", "start", "dashboard"],
  menu: ["navigation", "nav"],
  sidebar: ["side bar", "side panel", "side menu"]
};
var ELEMENT_ACTION_WORDS = {
  button: ["button", "btn", "click"],
  input: ["input", "field", "textbox", "box"],
  textarea: ["textarea", "text area", "text field", "multiline"],
  select: ["select", "dropdown", "combo", "picker", "chooser"],
  checkbox: ["checkbox", "check", "tick"],
  radio: ["radio", "option", "choice"],
  link: ["link", "anchor", "href"],
  form: ["form"],
  menu: ["menu"],
  menuitem: ["menu item", "option"],
  tab: ["tab"],
  dialog: ["dialog", "modal", "popup"],
  switch: ["switch", "toggle"],
  slider: ["slider", "range"]
};
function normalizeAlias(text) {
  return text.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}
function extractWords(text) {
  const tokens = tokenize(text);
  return tokens.filter((t) => t.length >= 2);
}
function generateTextAliases(text, config) {
  if (!text || !config.includeText) return [];
  const aliases = [];
  const normalized = normalizeAlias(text);
  if (normalized.length >= config.minLength && normalized.length <= config.maxLength) {
    aliases.push(normalized);
  }
  const words = extractWords(text);
  for (const word of words) {
    if (word.length >= config.minLength) {
      aliases.push(word);
    }
  }
  if (words.length >= 2 && words.length <= 4) {
    const twoWords = words.slice(0, 2).join(" ");
    if (twoWords.length <= config.maxLength) {
      aliases.push(twoWords);
    }
    if (words.length > 2) {
      const lastTwo = words.slice(-2).join(" ");
      if (lastTwo.length <= config.maxLength) {
        aliases.push(lastTwo);
      }
    }
  }
  return aliases;
}
function generateSynonyms(aliases, config) {
  if (!config.includeSynonyms) return [];
  const synonyms = [];
  for (const alias of aliases) {
    const words = alias.toLowerCase().split(/\s+/);
    for (const word of words) {
      if (SYNONYMS[word]) {
        for (const synonym of SYNONYMS[word]) {
          const newAlias = alias.toLowerCase().replace(word, synonym);
          if (newAlias !== alias.toLowerCase()) {
            synonyms.push(newAlias);
          }
          if (synonym.length >= config.minLength) {
            synonyms.push(synonym);
          }
        }
      }
    }
  }
  return synonyms;
}
function generateTypeAliases(elementType) {
  const type = elementType.toLowerCase();
  return ELEMENT_ACTION_WORDS[type] || [type];
}
function generateAliases(input, config = {}) {
  const finalConfig = { ...DEFAULT_ALIAS_CONFIG, ...config };
  const aliasSet = /* @__PURE__ */ new Set();
  const addAlias = (alias) => {
    const normalized = normalizeAlias(alias);
    if (normalized.length >= finalConfig.minLength && normalized.length <= finalConfig.maxLength) {
      aliasSet.add(normalized);
    }
  };
  const addAliases = (aliases2) => {
    for (const alias of aliases2) {
      addAlias(alias);
    }
  };
  if (finalConfig.includeText && input.textContent) {
    addAliases(generateTextAliases(input.textContent, finalConfig));
  }
  if (finalConfig.includeAriaLabel && input.ariaLabel) {
    addAliases(generateTextAliases(input.ariaLabel, finalConfig));
  }
  if (finalConfig.includeAriaLabel && input.ariaLabelledBy) {
    addAliases(generateTextAliases(input.ariaLabelledBy, finalConfig));
  }
  if (finalConfig.includePlaceholder && input.placeholder) {
    addAliases(generateTextAliases(input.placeholder, finalConfig));
  }
  if (finalConfig.includeTitle && input.title) {
    addAliases(generateTextAliases(input.title, finalConfig));
  }
  if (input.labelText) {
    addAliases(generateTextAliases(input.labelText, finalConfig));
  }
  if (input.id) {
    addAliases(extractWords(input.id));
  }
  if (input.name) {
    addAliases(extractWords(input.name));
  }
  if (input.value && (input.elementType === "button" || input.inputType === "submit" || input.inputType === "button")) {
    addAliases(generateTextAliases(input.value, finalConfig));
  }
  if (input.elementType) {
    addAliases(generateTypeAliases(input.elementType));
  }
  if (input.inputType) {
    addAlias(input.inputType);
    if (input.inputType === "email") {
      addAliases(["email", "e-mail", "email address"]);
    } else if (input.inputType === "password") {
      addAliases(["password", "pass", "pwd"]);
    } else if (input.inputType === "tel") {
      addAliases(["phone", "telephone", "mobile"]);
    } else if (input.inputType === "url") {
      addAliases(["url", "website", "link", "address"]);
    } else if (input.inputType === "search") {
      addAliases(["search", "find", "query"]);
    }
  }
  if (finalConfig.includeSynonyms) {
    const currentAliases = Array.from(aliasSet);
    addAliases(generateSynonyms(currentAliases, finalConfig));
  }
  let aliases = Array.from(aliasSet);
  aliases.sort((a, b) => a.length - b.length);
  if (aliases.length > finalConfig.maxAliases) {
    aliases = aliases.slice(0, finalConfig.maxAliases);
  }
  return aliases;
}
function generateDescription(input) {
  const parts = [];
  let name = input.ariaLabel || input.labelText || input.textContent || input.placeholder || input.title || input.id || input.name;
  if (name) {
    name = name.trim();
    if (name.length > 30) {
      name = name.substring(0, 27) + "...";
    }
    parts.push(`"${name}"`);
  }
  const typeWords = ELEMENT_ACTION_WORDS[input.elementType || ""] || [
    input.elementType || "element"
  ];
  parts.push(typeWords[0]);
  if (input.inputType && input.inputType !== "text") {
    parts.push(`(${input.inputType})`);
  }
  return parts.join(" ");
}
var CONTENT_TYPES = /* @__PURE__ */ new Set([
  "heading",
  "paragraph",
  "list-item",
  "table-cell",
  "table-header",
  "label",
  "caption",
  "blockquote",
  "code-block",
  "badge",
  "status-message",
  "metric-value",
  "description-text",
  "nav-text",
  "content-generic"
]);
function generatePurpose(input) {
  const text = (input.textContent || input.ariaLabel || input.title || "").toLowerCase();
  const type = input.elementType?.toLowerCase() || "";
  const inputType = input.inputType?.toLowerCase() || "";
  if (CONTENT_TYPES.has(type)) {
    switch (type) {
      case "heading":
        return "Section heading";
      case "paragraph":
        return "Body text content";
      case "list-item":
        return "List item";
      case "table-cell":
        return "Table data cell";
      case "table-header":
        return "Table column header";
      case "label":
        return "Field label or definition term";
      case "caption":
        return "Figure or table caption";
      case "blockquote":
        return "Quoted content";
      case "code-block":
        return "Code or preformatted text";
      case "badge":
        return "Status badge or tag";
      case "status-message":
        return "Dynamic status indicator";
      case "metric-value":
        return "Metric or statistic value";
      case "description-text":
        return "Description or definition";
      case "nav-text":
        return "Navigation label";
      case "content-generic":
        return "Text content";
      default:
        return "Static content";
    }
  }
  if (type === "button" || inputType === "submit") {
    if (text.match(/submit|send|save|confirm|ok|done|finish|apply/)) {
      return "Submits the form";
    }
    if (text.match(/cancel|close|dismiss|back|exit/)) {
      return "Cancels or closes the current action";
    }
    if (text.match(/delete|remove|trash|clear/)) {
      return "Deletes or removes an item";
    }
    if (text.match(/edit|modify|change|update/)) {
      return "Edits or modifies an item";
    }
    if (text.match(/add|create|new|\+/)) {
      return "Creates or adds a new item";
    }
    if (text.match(/search|find|lookup/)) {
      return "Performs a search";
    }
    if (text.match(/login|sign.?in/)) {
      return "Signs the user in";
    }
    if (text.match(/logout|sign.?out/)) {
      return "Signs the user out";
    }
    if (text.match(/register|sign.?up|join/)) {
      return "Creates a new account";
    }
    if (text.match(/next|continue|proceed/)) {
      return "Proceeds to the next step";
    }
    if (text.match(/previous|back|return/)) {
      return "Returns to the previous step";
    }
  }
  if (type === "input" || type === "textarea") {
    if (inputType === "email") return "Accepts email address input";
    if (inputType === "password") return "Accepts password input";
    if (inputType === "search") return "Accepts search query input";
    if (inputType === "tel") return "Accepts phone number input";
    if (inputType === "url") return "Accepts URL input";
    if (inputType === "number") return "Accepts numeric input";
    if (inputType === "date") return "Accepts date input";
    if (inputType === "file") return "Accepts file upload";
  }
  if (type === "checkbox") {
    return "Toggles an option on or off";
  }
  if (type === "radio") {
    return "Selects one option from a group";
  }
  if (type === "select") {
    return "Selects an option from a dropdown";
  }
  if (type === "link") {
    return "Navigates to another page";
  }
  return void 0;
}
function generateSuggestedActions(input) {
  const type = input.elementType?.toLowerCase() || "";
  const inputType = input.inputType?.toLowerCase() || "";
  const text = (input.textContent || input.ariaLabel || "").toLowerCase();
  const actions = [];
  if (CONTENT_TYPES.has(type)) {
    actions.push("read text content", "verify text matches expected");
    return actions;
  }
  switch (type) {
    case "button":
      actions.push(`click "${text || "this button"}"`);
      break;
    case "input":
      if (inputType === "checkbox") {
        actions.push("check to enable", "uncheck to disable");
      } else if (inputType === "radio") {
        actions.push("select this option");
      } else {
        actions.push(`type into "${text || "this field"}"`);
        actions.push("clear the field");
      }
      break;
    case "textarea":
      actions.push(`type into "${text || "this text area"}"`);
      actions.push("clear the content");
      break;
    case "select":
      actions.push(`select an option from "${text || "this dropdown"}"`);
      break;
    case "checkbox":
      actions.push("check to enable", "uncheck to disable");
      break;
    case "radio":
      actions.push("select this option");
      break;
    case "link":
      actions.push(`click to navigate to "${text || "the linked page"}"`);
      break;
    case "switch":
      actions.push("toggle on", "toggle off");
      break;
    default:
      actions.push("click");
  }
  return actions;
}
function getSynonyms(word) {
  const normalized = word.toLowerCase().trim();
  return SYNONYMS[normalized] || [];
}
function areSynonyms(word1, word2) {
  const w1 = word1.toLowerCase().trim();
  const w2 = word2.toLowerCase().trim();
  if (w1 === w2) return true;
  const synonyms1 = SYNONYMS[w1] || [];
  const synonyms2 = SYNONYMS[w2] || [];
  return synonyms1.includes(w2) || synonyms2.includes(w1);
}

// src/annotations/types.ts
var ANNOTATION_CONFIG_VERSION = "1.0.0";

// src/annotations/store.ts
var AnnotationStore = class {
  constructor() {
    this.store = /* @__PURE__ */ new Map();
    this.listeners = /* @__PURE__ */ new Set();
  }
  /**
   * Get an annotation by element ID.
   */
  get(elementId) {
    return this.store.get(elementId);
  }
  /**
   * Get all annotations as a record.
   */
  getAll() {
    const result = {};
    for (const [id, annotation] of this.store) {
      result[id] = annotation;
    }
    return result;
  }
  /**
   * Set an annotation for an element. Auto-sets `updatedAt`.
   */
  set(elementId, annotation) {
    const updated = {
      ...annotation,
      updatedAt: Date.now()
    };
    this.store.set(elementId, updated);
    this.emit({
      type: "annotation:set",
      elementId,
      annotation: updated,
      timestamp: Date.now()
    });
  }
  /**
   * Delete an annotation by element ID.
   *
   * @returns true if the annotation existed and was deleted
   */
  delete(elementId) {
    const existed = this.store.delete(elementId);
    if (existed) {
      this.emit({
        type: "annotation:deleted",
        elementId,
        timestamp: Date.now()
      });
    }
    return existed;
  }
  /**
   * Check if an annotation exists for an element.
   */
  has(elementId) {
    return this.store.has(elementId);
  }
  /**
   * Get the number of stored annotations.
   */
  get count() {
    return this.store.size;
  }
  /**
   * Clear all annotations.
   */
  clear() {
    this.store.clear();
    this.emit({
      type: "annotation:cleared",
      timestamp: Date.now()
    });
  }
  /**
   * Import annotations from a config object.
   *
   * Merges with existing annotations (new values overwrite per element ID).
   *
   * @returns Number of annotations imported
   *
   * @example
   * ```ts
   * const config: AnnotationConfig = {
   *   version: '1.0.0',
   *   annotations: {
   *     'btn-1': { description: 'Submit button', tags: ['form'] },
   *     'input-1': { description: 'Name field' },
   *   },
   * };
   * const count = store.importConfig(config); // 2
   * ```
   */
  importConfig(config) {
    let count = 0;
    for (const [id, annotation] of Object.entries(config.annotations)) {
      this.store.set(id, {
        ...annotation,
        updatedAt: annotation.updatedAt ?? Date.now()
      });
      count++;
    }
    this.emit({
      type: "annotation:imported",
      count,
      timestamp: Date.now()
    });
    return count;
  }
  /**
   * Export all annotations as a config object.
   *
   * The returned object can be serialized to JSON and saved to a file,
   * then later re-imported with {@link importConfig}.
   *
   * @param metadata - Optional metadata to include (appName, description, etc.)
   * @returns AnnotationConfig with all current annotations
   *
   * @example
   * ```ts
   * const config = store.exportConfig({ appName: 'MyApp' });
   * // config.version === '1.0.0'
   * // config.annotations === { 'btn-1': { ... }, 'input-1': { ... } }
   * // config.metadata === { appName: 'MyApp', exportedAt: 1706900000000 }
   *
   * // Save to file
   * fs.writeFileSync('annotations.json', JSON.stringify(config, null, 2));
   * ```
   */
  exportConfig(metadata) {
    return {
      version: ANNOTATION_CONFIG_VERSION,
      annotations: this.getAll(),
      metadata: {
        ...metadata,
        exportedAt: Date.now()
      }
    };
  }
  /**
   * Compute annotation coverage against a set of known element IDs.
   *
   * Compares the store's annotations against the provided list of element IDs
   * to determine what percentage of elements have been annotated.
   *
   * @param allElementIds - Array of all known element IDs in the UI
   * @returns Coverage statistics including percentages and lists of annotated/unannotated IDs
   *
   * @example
   * ```ts
   * store.set('btn-1', { description: 'Submit' });
   * store.set('input-1', { description: 'Name' });
   *
   * const coverage = store.getCoverage(['btn-1', 'input-1', 'input-2', 'link-1']);
   * // coverage.totalElements === 4
   * // coverage.annotatedElements === 2
   * // coverage.coveragePercent === 50
   * // coverage.annotatedIds === ['btn-1', 'input-1']
   * // coverage.unannotatedIds === ['input-2', 'link-1']
   * ```
   */
  getCoverage(allElementIds) {
    const annotatedIds = [];
    const unannotatedIds = [];
    for (const id of allElementIds) {
      if (this.store.has(id)) {
        annotatedIds.push(id);
      } else {
        unannotatedIds.push(id);
      }
    }
    const total = allElementIds.length;
    return {
      totalElements: total,
      annotatedElements: annotatedIds.length,
      coveragePercent: total > 0 ? annotatedIds.length / total * 100 : 0,
      annotatedIds,
      unannotatedIds,
      timestamp: Date.now()
    };
  }
  /**
   * Subscribe to annotation events.
   *
   * The listener is called whenever annotations are set, deleted, imported,
   * or cleared. Returns an unsubscribe function to stop listening.
   *
   * @param listener - Callback function receiving {@link AnnotationEvent} objects
   * @returns Unsubscribe function - call it to remove the listener
   *
   * @example
   * ```ts
   * const unsubscribe = store.on((event) => {
   *   if (event.type === 'annotation:set') {
   *     console.log(`Element ${event.elementId} annotated:`, event.annotation);
   *   }
   * });
   *
   * store.set('btn-1', { description: 'Submit' });
   * // Logs: "Element btn-1 annotated: { description: 'Submit', updatedAt: ... }"
   *
   * unsubscribe(); // Stop listening
   * ```
   */
  on(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  /**
   * Emit an event to all listeners.
   */
  emit(event) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
      }
    }
  }
};
var globalStore = null;
function getGlobalAnnotationStore() {
  if (!globalStore) {
    globalStore = new AnnotationStore();
  }
  return globalStore;
}

// src/core/element-identifier.ts
function generateXPath(element) {
  if (element.id) {
    return `//*[@id="${element.id}"]`;
  }
  const parts = [];
  let current = element;
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    let selector = current.nodeName.toLowerCase();
    const testId = current.getAttribute("data-testid");
    if (testId) {
      selector += `[@data-testid="${testId}"]`;
      parts.unshift(selector);
      break;
    }
    const id = current.id;
    if (id) {
      selector += `[@id="${id}"]`;
      parts.unshift(selector);
      break;
    }
    const parentEl = current.parentElement;
    if (parentEl) {
      const currentEl = current;
      const siblings = Array.from(parentEl.children).filter(
        (child) => child.nodeName === currentEl.nodeName
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(currentEl) + 1;
        selector += `[${index}]`;
      }
    }
    parts.unshift(selector);
    current = parentEl;
  }
  return "/" + parts.join("/");
}
function generateCSSSelector(element) {
  const testId = element.getAttribute("data-testid");
  if (testId) {
    return `[data-testid="${testId}"]`;
  }
  const awasId = element.getAttribute("data-awas-element");
  if (awasId) {
    return `[data-awas-element="${awasId}"]`;
  }
  if (element.id) {
    return `#${CSS.escape(element.id)}`;
  }
  const path = [];
  let current = element;
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    let selector = current.nodeName.toLowerCase();
    const parentTestId = current.getAttribute("data-testid");
    if (parentTestId && current !== element) {
      path.unshift(`[data-testid="${parentTestId}"]`);
      break;
    }
    if (current.id) {
      path.unshift(`#${CSS.escape(current.id)}`);
      break;
    }
    const parentEl = current.parentElement;
    if (parentEl) {
      const currentEl = current;
      const siblings = Array.from(parentEl.children);
      const sameTagSiblings = siblings.filter(
        (s) => s.nodeName === currentEl.nodeName
      );
      if (sameTagSiblings.length > 1) {
        const index = siblings.indexOf(currentEl) + 1;
        selector += `:nth-child(${index})`;
      }
    }
    path.unshift(selector);
    current = current.parentElement;
  }
  return path.join(" > ");
}
function createElementIdentifier(element) {
  return {
    testId: element.getAttribute("data-testid") || void 0,
    awasId: element.getAttribute("data-awas-element") || void 0,
    htmlId: element.id || void 0,
    xpath: generateXPath(element),
    selector: generateCSSSelector(element)
  };
}

// src/core/class-name.ts
function classString(el) {
  if (!el) return "";
  const cn = el.className;
  if (typeof cn === "string") return cn;
  const baseVal = cn?.baseVal;
  return typeof baseVal === "string" ? baseVal : "";
}
function classList(el) {
  const s = classString(el).trim();
  return s ? s.split(/\s+/) : [];
}

// src/core/element-fingerprint.ts
var ARIA_LANDMARKS = /* @__PURE__ */ new Set([
  "banner",
  "complementary",
  "contentinfo",
  "form",
  "main",
  "navigation",
  "region",
  "search"
]);
var IMPLICIT_LANDMARKS = {
  NAV: "navigation",
  MAIN: "main",
  HEADER: "banner",
  FOOTER: "contentinfo",
  ASIDE: "complementary",
  FORM: "form",
  SEARCH: "search"
};
var IMPLICIT_ROLES = {
  BUTTON: "button",
  A: (el) => el.hasAttribute("href") ? "link" : "",
  INPUT: (el) => {
    const type = el.type?.toLowerCase();
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (type === "range") return "slider";
    if (type === "submit" || type === "reset" || type === "button") return "button";
    return "textbox";
  },
  SELECT: (el) => el.multiple ? "listbox" : "combobox",
  TEXTAREA: "textbox",
  IMG: "img",
  TABLE: "table",
  UL: "list",
  OL: "list",
  LI: "listitem",
  H1: "heading",
  H2: "heading",
  H3: "heading",
  H4: "heading",
  H5: "heading",
  H6: "heading",
  DIALOG: "dialog",
  DETAILS: "group",
  SUMMARY: "button",
  PROGRESS: "progressbar",
  METER: "meter"
};
var DYNAMIC_PATTERNS = [
  // UUIDs
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
  // ISO dates
  /\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?/g,
  // Timestamps (10+ digits)
  /\b\d{10,13}\b/g,
  // Standalone numbers (3+ digits, not part of a word)
  /\b\d{3,}\b/g,
  // Common date formats (MM/DD/YYYY, DD.MM.YYYY)
  /\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/g,
  // Time patterns
  /\d{1,2}:\d{2}(:\d{2})?\s*(AM|PM|am|pm)?/g
];
function computeStructuralPath(element) {
  const parts = [];
  let current = element;
  while (current && current.tagName !== "BODY" && current.tagName !== "HTML") {
    parts.unshift(current.tagName.toLowerCase());
    current = current.parentElement;
  }
  return parts.join(" > ");
}
function computePositionZone(element) {
  let ancestor = element;
  while (ancestor) {
    if (ancestor.getAttribute("role") === "dialog" || ancestor.getAttribute("aria-modal") === "true" || ancestor.tagName === "DIALOG") {
      return "modal";
    }
    ancestor = ancestor.parentElement;
  }
  const rect = element.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (vw === 0 || vh === 0) return "main";
  const centerY = (rect.top + rect.bottom) / 2 / vh;
  const centerX = (rect.left + rect.right) / 2 / vw;
  if (centerY < 0.1) return "header";
  if (centerY > 0.9) return "footer";
  if (centerX < 0.2) return "sidebar-left";
  if (centerX > 0.8) return "sidebar-right";
  return "main";
}
function computeRole(element) {
  const explicit = element.getAttribute("role");
  if (explicit) return explicit;
  const implicit = IMPLICIT_ROLES[element.tagName];
  if (typeof implicit === "function") return implicit(element);
  if (typeof implicit === "string") return implicit;
  return "";
}
function computeAccessibleName(element) {
  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel) return normalizeName(ariaLabel);
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const parts = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim()).filter(Boolean);
    if (parts.length > 0) return normalizeName(parts.join(" "));
  }
  const tag = element.tagName;
  if (tag === "BUTTON" || tag === "A" || tag === "SUMMARY" || tag.match(/^H[1-6]$/) || element.getAttribute("role") === "button" || element.getAttribute("role") === "link" || element.getAttribute("role") === "tab") {
    const text = element.textContent?.trim();
    if (text) return normalizeName(text);
  }
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    if (element.id) {
      const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
      if (label?.textContent?.trim()) return normalizeName(label.textContent.trim());
    }
    const wrappingLabel = element.closest("label");
    if (wrappingLabel?.textContent?.trim()) return normalizeName(wrappingLabel.textContent.trim());
    const placeholder = element.getAttribute("placeholder");
    if (placeholder) return normalizeName(placeholder);
  }
  return void 0;
}
function normalizeName(name) {
  let normalized = name.trim();
  for (const pattern of DYNAMIC_PATTERNS) {
    normalized = normalized.replace(pattern, "{\u2026}");
  }
  normalized = normalized.replace(/\s+/g, " ");
  if (normalized.length > 50) {
    normalized = normalized.slice(0, 50);
  }
  return normalized;
}
function computeSizeCategory(element) {
  const rect = element.getBoundingClientRect();
  const viewportArea = window.innerWidth * window.innerHeight;
  if (viewportArea === 0) return "medium";
  const ratio = rect.width * rect.height / viewportArea;
  if (ratio < 5e-3) return "icon";
  if (ratio < 0.01) return "button";
  if (ratio < 0.03) return "small";
  if (ratio < 0.1) return "medium";
  if (ratio < 0.3) return "large";
  if (ratio < 0.6) return "fullwidth";
  return "panel";
}
function computeLandmarkContext(element) {
  let current = element.parentElement;
  while (current && current.tagName !== "BODY" && current.tagName !== "HTML") {
    const role = current.getAttribute("role");
    if (role && ARIA_LANDMARKS.has(role)) {
      return { landmark: role, label: current.getAttribute("aria-label") || void 0 };
    }
    const implicitLandmark = IMPLICIT_LANDMARKS[current.tagName];
    if (implicitLandmark) {
      return { landmark: implicitLandmark, label: current.getAttribute("aria-label") || void 0 };
    }
    current = current.parentElement;
  }
  return { landmark: "", label: void 0 };
}
function computeRepeatPattern(element) {
  const parent = element.parentElement;
  if (!parent) return void 0;
  const parentRole = parent.getAttribute("role");
  const parentTag = parent.tagName;
  let containerType;
  if (parentRole === "list" || parentTag === "UL" || parentTag === "OL") {
    containerType = "list";
  } else if (parentRole === "grid" || parentRole === "row") {
    containerType = "grid";
  } else if (parentTag === "TABLE" || parentTag === "TBODY" || parentTag === "THEAD") {
    containerType = "table";
  }
  if (!containerType) {
    const children = Array.from(parent.children);
    if (children.length >= 3) {
      const signature = (el) => `${el.tagName}|${classString(el)}`;
      const sig = signature(element);
      const matches = children.filter((c) => signature(c) === sig);
      if (matches.length >= 3) {
        containerType = "list";
      } else {
        return void 0;
      }
    } else {
      return void 0;
    }
  }
  const siblings = Array.from(parent.children);
  const itemTag = element.tagName;
  const itemClass = classString(element);
  const matchingSiblings = siblings.filter(
    (s) => s.tagName === itemTag && classString(s) === itemClass
  );
  const index = matchingSiblings.indexOf(element);
  const containerSelector = generateSimpleSelector(parent);
  const itemClassTokens = classList(element);
  const itemSelector = `${element.tagName.toLowerCase()}${itemClassTokens.length > 0 ? "." + itemClassTokens.map((c) => CSS.escape(c)).join(".") : ""}`;
  return {
    type: containerType,
    containerSelector,
    itemSelector,
    index: Math.max(0, index),
    totalCount: matchingSiblings.length
  };
}
function generateSimpleSelector(element) {
  if (element.id) return `#${CSS.escape(element.id)}`;
  const testId = element.getAttribute("data-testid");
  if (testId) return `[data-testid="${testId}"]`;
  return element.tagName.toLowerCase();
}
function computeHashSync(structuralPath, positionZone, role, accessibleName, sizeCategory) {
  const input = `${structuralPath}|${positionZone}|${role}|${accessibleName ?? ""}|${sizeCategory}`;
  let h1 = 2166136261;
  let h2 = 2166136261;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 16777619);
    h2 ^= c * 31;
    h2 = Math.imul(h2, 16777619);
  }
  const hex1 = (h1 >>> 0).toString(16).padStart(8, "0");
  const hex2 = (h2 >>> 0).toString(16).padStart(8, "0");
  return hex1 + hex2;
}
function computeElementFingerprint(element) {
  const structuralPath = computeStructuralPath(element);
  const positionZone = computePositionZone(element);
  const role = computeRole(element);
  const accessibleName = computeAccessibleName(element);
  const sizeCategory = computeSizeCategory(element);
  const { landmark, label: landmarkLabel } = computeLandmarkContext(element);
  const repeatPattern = computeRepeatPattern(element);
  const rect = element.getBoundingClientRect();
  const vw = window.innerWidth || 1;
  const vh = window.innerHeight || 1;
  const fingerprint = {
    hash: computeHashSync(structuralPath, positionZone, role, accessibleName, sizeCategory),
    structuralPath,
    positionZone,
    landmarkContext: landmark,
    role,
    tagName: element.tagName.toLowerCase(),
    sizeCategory,
    relativePosition: {
      top: Math.round(rect.top / vh * 1e3) / 1e3,
      left: Math.round(rect.left / vw * 1e3) / 1e3
    },
    isRepeating: repeatPattern !== void 0
  };
  if (landmarkLabel) fingerprint.landmarkLabel = landmarkLabel;
  if (accessibleName) fingerprint.accessibleName = accessibleName;
  if (repeatPattern) fingerprint.repeatPattern = repeatPattern;
  return fingerprint;
}

// src/core/stable-ref.ts
function buildSemanticPath(element) {
  const parts = [];
  let current = element;
  let depth = 0;
  while (current && current.tagName !== "BODY" && current.tagName !== "HTML" && depth < 8) {
    let selector = current.tagName.toLowerCase();
    const testId = current.getAttribute("data-testid");
    if (testId) {
      parts.unshift(`[data-testid="${testId}"]`);
      break;
    }
    const htmlId = current.id;
    if (htmlId && !/^:r[0-9a-z]+:$/.test(htmlId)) {
      parts.unshift(`#${CSS.escape(htmlId)}`);
      break;
    }
    const role = current.getAttribute("role");
    if (role) {
      selector += `[role="${role}"]`;
    }
    const classes = Array.from(current.classList).filter(
      (c) => c.length > 2 && !c.startsWith("css-") && !c.startsWith("_")
    );
    if (classes.length > 0) {
      selector += `.${CSS.escape(classes[0])}`;
    }
    parts.unshift(selector);
    current = current.parentElement;
    depth++;
  }
  return parts.length > 0 ? parts.join(" > ") : void 0;
}
function createStableRef(element) {
  const fingerprint = computeElementFingerprint(element.element);
  const semanticPath = buildSemanticPath(element.element) ?? element.element.tagName.toLowerCase();
  const idStrategy = element.element.getAttribute("data-testid") ? "data-testid" : element.element.id && !/^:r[0-9a-z]+:$/.test(element.element.id) ? "html-id" : "prefer-existing";
  const stableId = element.element.getAttribute("data-ui-bridge-id") || void 0;
  return {
    id: element.id,
    idStrategy,
    primaryId: element.id,
    fingerprint: fingerprint.hash,
    semanticPath,
    stableId,
    lastSeenAt: Date.now()
  };
}

// src/core/registry.ts
function serializeRegisteredElement(el, options = {}) {
  const componentBasePath = options.componentBasePath ?? "/control/component";
  const kind = el.category === "content" ? "content" : el.category === "interactive" ? "interactive" : void 0;
  const uiBridgeId = typeof el.element?.getAttribute === "function" ? el.element.getAttribute("data-ui-bridge-id") ?? void 0 : void 0;
  return {
    id: el.id,
    ...uiBridgeId !== void 0 ? { uiBridgeId } : {},
    type: el.type,
    tagName: el.element.tagName.toLowerCase(),
    label: el.label,
    identifier: el.getIdentifier(),
    state: el.getState(),
    actions: el.actions,
    customActions: el.customActions ? Object.keys(el.customActions) : void 0,
    category: el.category,
    kind,
    content: el.content,
    role: el.role,
    contentMetadata: el.contentMetadata,
    mediaMetadata: el.mediaMetadata,
    ownedByComponent: el.ownedByComponent,
    componentActionBasePath: el.ownedByComponent ? `${componentBasePath}/${el.ownedByComponent}` : void 0,
    // Live bbox/visibility maintained by `useUIElement`. Present for elements
    // whose hook attached a ref (or that matched via `[data-ui-bridge-id]`).
    // Runners use this to dispatch clicks via DOM coords without VLM grounding.
    bbox: el.bbox,
    visible: el.visible,
    // `'hook'` for explicit useUIElement registrations, `'auto'` for
    // DOM-walker entries from useAutoRegister. Snapshot consumers that care
    // about developer-instrumented vs. scanner-discovered elements filter here.
    origin: el.origin,
    // Structured disambiguation metadata (all optional). Passthrough of the
    // four hints the consumer set on `useUIElement` so NL queries can rank
    // candidates without VLM grounding. Absent fields keep today's behavior.
    variant: el.variant,
    position: el.position,
    color: el.color,
    contextPath: el.contextPath,
    stableRef: el.element?.isConnected ? (() => {
      const ref = createStableRef(el);
      return {
        id: ref.id,
        fingerprint: ref.fingerprint,
        semanticPath: ref.semanticPath,
        stableId: ref.stableId
      };
    })() : void 0,
    // Route captured at registration time. Mirrored on the snapshot element
    // so consumers can cross-check `registration.byRoute` against individual
    // entries without a second call.
    route: el.route,
    // Phase 3.2: ids/globs this control reveals. Echoed verbatim so clients
    // can answer "which control unhides element X" without grepping source.
    reveals: el.reveals
  };
}
function captureDocumentVisibility() {
  if (typeof document === "undefined") return void 0;
  const rawState = document.visibilityState ?? "visible";
  return {
    hidden: document.hidden === true,
    state: rawState
  };
}
function captureFormControlState(element, state) {
  if (element.required || element.getAttribute("aria-required") === "true") {
    state.required = true;
  }
  if ("validity" in element) {
    const v = element.validity;
    if (!v.valid || element.validationMessage) {
      state.validationState = {
        valid: v.valid,
        validationMessage: element.validationMessage || void 0,
        valueMissing: v.valueMissing || void 0,
        typeMismatch: v.typeMismatch || void 0,
        patternMismatch: v.patternMismatch || void 0,
        tooShort: v.tooShort || void 0,
        tooLong: v.tooLong || void 0,
        rangeUnderflow: v.rangeUnderflow || void 0,
        rangeOverflow: v.rangeOverflow || void 0,
        stepMismatch: v.stepMismatch || void 0,
        customError: v.customError || void 0
      };
    }
  }
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const constraints = {};
    let hasConstraint = false;
    if (element instanceof HTMLInputElement) {
      if (element.pattern) {
        constraints.pattern = element.pattern;
        hasConstraint = true;
      }
      if (element.min) {
        constraints.min = element.min;
        hasConstraint = true;
      }
      if (element.max) {
        constraints.max = element.max;
        hasConstraint = true;
      }
      if (element.step && element.step !== "any") {
        constraints.step = element.step;
        hasConstraint = true;
      }
    }
    if (element.minLength > 0) {
      constraints.minLength = element.minLength;
      hasConstraint = true;
    }
    if (element.maxLength >= 0 && element.maxLength < 524288) {
      constraints.maxLength = element.maxLength;
      hasConstraint = true;
    }
    if (hasConstraint) {
      state.constraints = constraints;
    }
  }
}
function computeAccessibleName2(element) {
  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel) return ariaLabel;
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const parts = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim()).filter((t) => !!t);
    if (parts.length > 0) return parts.join(" ");
  }
  if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
    if (element.id) {
      const label = document.querySelector(`label[for="${element.id}"]`);
      const labelText = label?.textContent?.trim();
      if (labelText) return labelText;
    }
  }
  const title = element.getAttribute("title");
  if (title) return title;
  const rawText = element.textContent?.trim();
  if (rawText) {
    return rawText.length <= 80 ? rawText : rawText.slice(0, 80);
  }
  return void 0;
}
function getElementState(element) {
  const rect = element.getBoundingClientRect();
  const computedStyle = window.getComputedStyle(element);
  const inViewport = rect.width > 0 && rect.height > 0 && rect.top < window.innerHeight && rect.bottom > 0 && rect.left < window.innerWidth && rect.right > 0;
  const roleAttr = element.getAttribute("role") || void 0;
  const accessibleName = computeAccessibleName2(element);
  const state = {
    visible: isElementVisible(element, rect, computedStyle, inViewport),
    enabled: !isElementDisabled(element),
    focused: document.activeElement === element,
    role: roleAttr,
    accessibleName,
    rect: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left
    },
    textContent: element.textContent?.trim() || void 0,
    computedStyles: {
      display: computedStyle.display,
      visibility: computedStyle.visibility,
      opacity: computedStyle.opacity,
      pointerEvents: computedStyle.pointerEvents,
      cursor: computedStyle.cursor,
      color: computedStyle.color,
      backgroundColor: computedStyle.backgroundColor,
      colorScheme: computedStyle.colorScheme,
      fontSize: computedStyle.fontSize,
      fontWeight: computedStyle.fontWeight,
      lineHeight: computedStyle.lineHeight,
      overflow: computedStyle.overflow,
      textOverflow: computedStyle.textOverflow,
      whiteSpace: computedStyle.whiteSpace,
      position: computedStyle.position,
      zIndex: computedStyle.zIndex,
      padding: computedStyle.padding,
      margin: computedStyle.margin,
      borderColor: computedStyle.borderColor,
      borderWidth: computedStyle.borderWidth,
      borderRadius: computedStyle.borderRadius
    },
    inViewport
  };
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (vw > 0 && vh > 0) {
    state.normalizedRect = {
      x: rect.x / vw,
      y: rect.y / vh,
      width: rect.width / vw,
      height: rect.height / vh
    };
  }
  if (isScrollContainer(element, computedStyle)) {
    state.scrollInfo = {
      scrollTop: element.scrollTop,
      scrollLeft: element.scrollLeft,
      scrollHeight: element.scrollHeight,
      scrollWidth: element.scrollWidth,
      clientHeight: element.clientHeight,
      clientWidth: element.clientWidth,
      canScrollUp: element.scrollTop > 0,
      canScrollDown: element.scrollTop + element.clientHeight < element.scrollHeight - 1,
      canScrollLeft: element.scrollLeft > 0,
      canScrollRight: element.scrollLeft + element.clientWidth < element.scrollWidth - 1
    };
  }
  if (!state.textContent) {
    state.textContent = element.getAttribute("aria-label") || element.getAttribute("title") || void 0;
  }
  const opacityVal = parseFloat(computedStyle.opacity);
  if (opacityVal === 0) {
    state.opacityHidden = true;
  }
  const contentLabel = element.getAttribute("data-content-label");
  if (contentLabel) {
    state.dataContentLabel = contentLabel;
  }
  const contentRole = element.getAttribute("data-content-role");
  if (contentRole) {
    state.dataContentRole = contentRole;
  }
  const ariaSelected = element.getAttribute("aria-selected");
  if (ariaSelected !== null) {
    state.ariaSelected = ariaSelected === "true";
  }
  const ariaPressed = element.getAttribute("aria-pressed");
  if (ariaPressed !== null) {
    state.ariaPressed = ariaPressed === "mixed" ? "mixed" : ariaPressed === "true";
  }
  const ariaCurrent = element.getAttribute("aria-current");
  if (ariaCurrent !== null && ariaCurrent !== "false") {
    state.ariaCurrent = ariaCurrent;
  }
  const ariaExpanded = element.getAttribute("aria-expanded");
  if (ariaExpanded !== null) {
    state.ariaExpanded = ariaExpanded === "true";
  } else if (element instanceof HTMLDetailsElement) {
    state.ariaExpanded = element.open;
  } else if (element.tagName === "SUMMARY") {
    const parentDetails = element.closest("details");
    if (parentDetails instanceof HTMLDetailsElement) {
      state.ariaExpanded = parentDetails.open;
    }
  }
  const ariaCheckedAttr = element.getAttribute("aria-checked");
  if (ariaCheckedAttr !== null) {
    state.ariaChecked = ariaCheckedAttr === "mixed" ? "mixed" : ariaCheckedAttr === "true";
    const role = element.getAttribute("role");
    if (role === "switch" || role === "checkbox" || role === "menuitemcheckbox" || role === "menuitemradio" || role === "radio") {
      state.checked = ariaCheckedAttr === "true";
    }
  }
  if (element instanceof HTMLInputElement) {
    state.value = element.value;
    if (element.type === "checkbox" || element.type === "radio") {
      state.checked = element.checked;
    }
    captureFormControlState(element, state);
  } else if (element instanceof HTMLTextAreaElement) {
    state.value = element.value;
    captureFormControlState(element, state);
  } else if (element instanceof HTMLSelectElement) {
    state.value = element.value;
    state.selectedOptions = Array.from(element.selectedOptions).map((opt) => opt.value);
    state.availableOptions = Array.from(element.options).map((opt) => ({
      value: opt.value,
      label: opt.label || opt.textContent?.trim() || opt.value,
      selected: opt.selected
    }));
    captureFormControlState(element, state);
  }
  if (element instanceof HTMLAnchorElement && element.href) {
    state.href = element.href;
  }
  const dataRoute = element.getAttribute("data-route");
  if (dataRoute) {
    state.dataRoute = dataRoute;
  }
  return state;
}
function isElementVisible(element, rect, style, inViewport) {
  if (rect.width === 0 || rect.height === 0) return false;
  if (style.display === "none") return false;
  if (style.visibility === "hidden") return false;
  if (parseFloat(style.opacity) === 0) return false;
  if (!inViewport) return false;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  if (cx >= 0 && cx < window.innerWidth && cy >= 0 && cy < window.innerHeight) {
    const hit = document.elementFromPoint(cx, cy);
    if (hit !== null && hit !== element && !element.contains(hit)) {
      return false;
    }
  }
  return true;
}
function isScrollContainer(element, style) {
  if (element.scrollHeight <= element.clientHeight && element.scrollWidth <= element.clientWidth) {
    return false;
  }
  const oy = style.overflowY;
  const ox = style.overflowX;
  return oy === "auto" || oy === "scroll" || ox === "auto" || ox === "scroll";
}
function isElementDisabled(element) {
  if ("disabled" in element && element.disabled) {
    return true;
  }
  if (element.getAttribute("aria-disabled") === "true") {
    return true;
  }
  return false;
}
function inferActions(type) {
  const baseActions = ["focus", "blur", "hover", "scroll", "scrollIntoView"];
  switch (type) {
    case "button":
      return [...baseActions, "click", "doubleClick", "rightClick", "middleClick"];
    case "input":
      return [...baseActions, "click", "type", "clear"];
    case "textarea":
      return [...baseActions, "click", "type", "clear"];
    case "select":
      return [...baseActions, "click", "select"];
    case "checkbox":
      return [...baseActions, "click", "check", "uncheck", "toggle"];
    case "radio":
      return [...baseActions, "click", "check"];
    case "link":
      return [...baseActions, "click"];
    case "form":
      return ["focus", "blur"];
    case "menu":
    case "menuitem":
      return [...baseActions, "click"];
    case "tab":
      return [...baseActions, "click", "middleClick"];
    case "dialog":
      return ["focus", "blur"];
    case "custom":
    default:
      return [...baseActions, "click"];
  }
}
function inferElementType(element) {
  const tagName = element.tagName.toLowerCase();
  const role = element.getAttribute("role");
  if (role) {
    switch (role) {
      case "button":
        return "button";
      case "textbox":
        return "input";
      case "checkbox":
        return "checkbox";
      case "radio":
        return "radio";
      case "link":
        return "link";
      case "listbox":
      case "combobox":
        return "select";
      case "menu":
        return "menu";
      case "menuitem":
        return "menuitem";
      case "tab":
        return "tab";
      case "dialog":
        return "dialog";
    }
  }
  switch (tagName) {
    case "button":
      return "button";
    case "input": {
      const inputType = element.type;
      if (inputType === "checkbox") return "checkbox";
      if (inputType === "radio") return "radio";
      if (inputType === "submit" || inputType === "button") return "button";
      return "input";
    }
    case "textarea":
      return "textarea";
    case "select":
      return "select";
    case "a":
      return "link";
    case "form":
      return "form";
    default:
      return "custom";
  }
}
var DEFAULT_REMOUNT_CACHE_WINDOW_MS = 2e3;
var UIBridgeRegistry = class {
  constructor(options = {}) {
    this.elements = /* @__PURE__ */ new Map();
    this.components = /* @__PURE__ */ new Map();
    this.workflows = /* @__PURE__ */ new Map();
    this.eventListeners = /* @__PURE__ */ new Map();
    // State management
    this.states = /* @__PURE__ */ new Map();
    this.stateGroups = /* @__PURE__ */ new Map();
    this.transitions = /* @__PURE__ */ new Map();
    this.activeStates = /* @__PURE__ */ new Set();
    // Recently removed elements for remount ID preservation
    this.recentlyRemoved = /* @__PURE__ */ new Map();
    // ── F3: Snapshot registration metadata ────────────────────────────────────
    // Sticky latch: flips true the first time any element registers and stays
    // true for the rest of this registry instance's lifetime, including across
    // unregister cycles. Lets snapshot consumers distinguish "bridge has never
    // seen a registration" (no SDK coverage on this page) from "registrations
    // happened but are all unmounted now". Never reset except on `clear()`.
    this.everHadRegistrationsFlag = false;
    // Per-route tally of currently-registered elements. Mirrors
    // `elements.size` partitioned by `RegisteredElement.route`. Incremented on
    // register, decremented on unregister, and a zero count is dropped from
    // the map so `byRoute` never emits `{ "/foo": 0 }`. Elements registered
    // without a route (non-DOM environment) are tracked under the empty-string
    // key `""` — snapshot serialization filters that bucket out.
    this.routeCounts = /* @__PURE__ */ new Map();
    // Per-route element-id sets — paired with `routeCounts` so the snapshot
    // can expose `byRoute[route].ids` alongside `byRoute[route].count`. Same
    // empty-string convention for undefined-route elements; same drop-on-empty
    // semantics so a route with no live elements doesn't linger as `{ ids: [] }`.
    this.routeIds = /* @__PURE__ */ new Map();
    // External store pattern for useSyncExternalStore
    this.storeVersion = 0;
    this.storeListeners = /* @__PURE__ */ new Set();
    this.cachedSnapshot = null;
    this.notifyScheduled = false;
    // ── Snapshot enricher slots ───────────────────────────────────────────────
    // Canonical enrichers wire the seven first-party trackers (navigation, modal,
    // toast, relationships, drag-drop, undo, shortcuts) into createSnapshot{,Async}
    // so any caller of those methods gets enriched output without manual glue.
    // `snapshotExtras` is the open-ended escape hatch for ad-hoc trackers (e.g.
    // a runner sidebar tab map) that aren't worth promoting into the canonical
    // set yet.
    this.enrichers = {};
    this.snapshotExtras = /* @__PURE__ */ new Map();
    this.options = options;
    this.__instanceTag = Math.random().toString(36).slice(2, 8);
  }
  /**
   * Public accessor for the instance tag — equivalent to reading
   * `__instanceTag` directly, but kept as a method so external diagnostic
   * code (which sees the type from `dist/`) can call it without TypeScript
   * complaining about touching internal fields.
   */
  getInstanceTag() {
    return this.__instanceTag;
  }
  // ============================================================================
  // Snapshot Enricher Slots
  // ============================================================================
  /**
   * Register/replace canonical enrichers (navigation/modal/toast/relationships/
   * drag-drop/undo/shortcuts). HMR-safe — calling with a partial set merges into
   * existing slots instead of clobbering them, so a remount that re-runs init
   * for one tracker doesn't drop the others.
   */
  setEnrichers(e) {
    this.enrichers = { ...this.enrichers, ...e };
  }
  /**
   * Register a custom snapshot enricher. The returned object will be
   * `Object.assign`ed onto the snapshot, so use unique top-level keys to avoid
   * clobbering canonical fields. Returns a disposer.
   */
  registerSnapshotEnricher(name, fn) {
    this.snapshotExtras.set(name, fn);
    return () => this.unregisterSnapshotEnricher(name);
  }
  /** Remove a custom snapshot enricher by name */
  unregisterSnapshotEnricher(name) {
    this.snapshotExtras.delete(name);
  }
  /**
   * Subscribe to registry changes (for useSyncExternalStore).
   * Returns an unsubscribe function.
   */
  subscribe(callback) {
    this.storeListeners.add(callback);
    return () => {
      this.storeListeners.delete(callback);
    };
  }
  /**
   * Get a stable snapshot reference that changes only when the registry mutates.
   * Designed for useSyncExternalStore.
   */
  getSnapshot() {
    if (!this.cachedSnapshot || this.cachedSnapshot.version !== this.storeVersion) {
      this.cachedSnapshot = {
        elements: Array.from(this.elements.values()),
        components: Array.from(this.components.values()),
        workflows: Array.from(this.workflows.values()),
        version: this.storeVersion
      };
    }
    return this.cachedSnapshot;
  }
  notifyStoreListeners() {
    this.storeVersion++;
    this.cachedSnapshot = null;
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    queueMicrotask(() => {
      this.notifyScheduled = false;
      for (const listener of this.storeListeners) {
        listener();
      }
    });
  }
  /**
   * Emit an event
   */
  emit(type, data) {
    const event = {
      type,
      timestamp: Date.now(),
      data
    };
    this.options.onEvent?.(event);
    const listeners = this.eventListeners.get(type);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (error) {
          console.error(`Error in event listener for ${type}:`, error);
        }
      }
    }
    if (this.options.verbose) {
      console.log("[UIBridge]", type, data);
    }
    if (typeof type === "string" && (type.startsWith("element:") || type.startsWith("component:") || type.startsWith("workflow:"))) {
      this.notifyStoreListeners();
    }
    this.options.elementEventLog?.ingest(event);
  }
  /**
   * Register an event listener
   */
  on(type, listener) {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, /* @__PURE__ */ new Set());
    }
    this.eventListeners.get(type).add(listener);
    return () => {
      this.eventListeners.get(type)?.delete(listener);
    };
  }
  /**
   * Dispatch an event from external sources (e.g., NavigationTracker).
   * Prefer using registry methods (registerElement, etc.) for internal events.
   */
  dispatchEvent(type, data) {
    this.emit(type, data);
  }
  /**
   * Remove an event listener
   */
  off(type, listener) {
    this.eventListeners.get(type)?.delete(listener);
  }
  /**
   * Register an element
   */
  /**
   * Update a registered element's metadata/options in place.
   * See `updateComponent` for rationale. Does not replace the DOM element
   * reference — use `registerElement` if the element itself changed.
   */
  updateElement(id, options) {
    const existing = this.elements.get(id);
    if (!existing) return false;
    if (options.type !== void 0) existing.type = options.type;
    if (options.label !== void 0) existing.label = options.label;
    if (options.actions !== void 0) existing.actions = options.actions;
    if (options.customActions !== void 0) existing.customActions = options.customActions;
    if (options.category !== void 0) existing.category = options.category;
    if (options.contentMetadata !== void 0) existing.contentMetadata = options.contentMetadata;
    if (options.mediaMetadata !== void 0) existing.mediaMetadata = options.mediaMetadata;
    if (options.variant !== void 0) existing.variant = options.variant;
    if (options.position !== void 0) existing.position = options.position;
    if (options.color !== void 0) existing.color = options.color;
    if (options.contextPath !== void 0) existing.contextPath = options.contextPath;
    if (options.reveals !== void 0) existing.reveals = options.reveals;
    return true;
  }
  /**
   * Update the live viewport-relative bounding box and visibility for a
   * registered element. Called by `useUIElement`'s ResizeObserver + scroll
   * listeners and MUST NOT emit events or bump `storeVersion` — bbox updates
   * fire on every scroll/resize and would cause `useSyncExternalStore`
   * consumers to re-render continuously (React error #185).
   *
   * Returns `false` if the element is not registered.
   */
  updateElementBbox(id, bbox, visible) {
    const existing = this.elements.get(id);
    if (!existing) return false;
    existing.bbox = bbox;
    existing.visible = visible;
    return true;
  }
  /**
   * Action-driven state refresh.
   *
   * Action handlers (`type`, `clear`, `setValue`, `check`, `uncheck`, `toggle`,
   * `select`, `sendKeys`, `focus`, `blur`) call this after mutating the DOM so
   * subsequent `getElement(id)` / snapshot reads see the post-action state
   * even when React detaches/re-creates the underlying DOM node between the
   * action and the next read.
   *
   * The fields in `updates` overlay the live `getElementState(element)` read
   * (cached values win for `value`, `checked`, `focused`, etc.). Other fields
   * (rect, computedStyles, scrollInfo) keep flowing from the live DOM read so
   * layout stays accurate. Pass `undefined` for `updates` to clear the
   * overlay.
   *
   * Returns `false` if `id` is not registered.
   */
  refreshElement(id, updates) {
    const existing = this.elements.get(id);
    if (!existing) return false;
    const ref = existing.__stateOverridesRef;
    if (!ref) {
      existing.cachedStateOverrides = updates;
      return true;
    }
    if (updates === void 0) {
      ref.value = void 0;
      existing.cachedStateOverrides = void 0;
    } else {
      const merged = { ...ref.value ?? {}, ...updates };
      ref.value = merged;
      existing.cachedStateOverrides = merged;
    }
    return true;
  }
  registerElement(id, element, options = {}) {
    const type = options.type ?? inferElementType(element);
    const actions = options.actions ?? inferActions(type);
    let actualId = id;
    if (this.options.preserveIdAcrossRemount) {
      const now = Date.now();
      const cacheWindow = this.options.remountCacheWindowMs ?? DEFAULT_REMOUNT_CACHE_WINDOW_MS;
      const fp = computeElementFingerprint(element).hash;
      for (const [key, entry] of this.recentlyRemoved) {
        if (now - entry.removedAt > cacheWindow) {
          this.recentlyRemoved.delete(key);
          continue;
        }
        if (entry.fingerprint === fp) {
          actualId = entry.id;
          this.recentlyRemoved.delete(key);
          break;
        }
      }
    }
    let ownedByComponent = options.ownedByComponent;
    if (!ownedByComponent && element && typeof element.closest === "function") {
      const scope = element.closest("[data-ui-bridge-component]");
      const attr = scope?.getAttribute("data-ui-bridge-component");
      if (attr) ownedByComponent = attr;
    }
    let route;
    if (options.route === null) {
      route = void 0;
    } else if (typeof options.route === "string") {
      route = options.route;
    } else if (typeof window !== "undefined" && window.location?.pathname) {
      route = window.location.pathname;
    }
    const stateOverridesRef = {
      value: void 0
    };
    const computeState = () => {
      const live = getElementState(element);
      return live;
    };
    const registered = {
      id: actualId,
      element,
      type,
      label: options.label,
      actions,
      customActions: options.customActions,
      getState: computeState,
      getIdentifier: () => createElementIdentifier(element),
      registeredAt: Date.now(),
      mounted: true,
      category: options.category ?? "interactive",
      contentMetadata: options.contentMetadata,
      mediaMetadata: options.mediaMetadata,
      ownedByComponent,
      // Default programmatic registrations to `'hook'` — only the DOM walker
      // in useAutoRegister passes `'auto'`. Tests and external callers that
      // pre-date this field stay on the `'hook'` side of any filter.
      origin: options.origin ?? "hook",
      // Structured disambiguation metadata (all optional). Snapshots echo
      // these through verbatim so NL queries can rank candidates without
      // VLM pixel grounding.
      variant: options.variant,
      position: options.position,
      color: options.color,
      contextPath: options.contextPath,
      route,
      // Content/role fields for data-ui-bridge-content semantic elements.
      // Undefined for interactive elements and for content registered via
      // the heading/paragraph/table-cell content-discovery path.
      content: options.content,
      role: options.role,
      // Phase 3.2 — ids/globs this control reveals. Undefined for elements
      // that don't gate any visibility (the common case).
      reveals: options.reveals
    };
    Object.defineProperty(registered, "__stateOverridesRef", {
      value: stateOverridesRef,
      enumerable: false,
      writable: false,
      configurable: true
    });
    const prior = this.elements.get(actualId);
    if (prior) {
      this.decrementRouteCount(prior.route, actualId);
    }
    this.elements.set(actualId, registered);
    this.everHadRegistrationsFlag = true;
    this.incrementRouteCount(route, actualId);
    this.emit("element:registered", { id: actualId, type, label: options.label });
    return registered;
  }
  incrementRouteCount(route, id) {
    const key = route ?? "";
    this.routeCounts.set(key, (this.routeCounts.get(key) ?? 0) + 1);
    let ids = this.routeIds.get(key);
    if (!ids) {
      ids = /* @__PURE__ */ new Set();
      this.routeIds.set(key, ids);
    }
    ids.add(id);
  }
  decrementRouteCount(route, id) {
    const key = route ?? "";
    const next = (this.routeCounts.get(key) ?? 0) - 1;
    if (next <= 0) {
      this.routeCounts.delete(key);
    } else {
      this.routeCounts.set(key, next);
    }
    const ids = this.routeIds.get(key);
    if (ids) {
      ids.delete(id);
      if (ids.size === 0) {
        this.routeIds.delete(key);
      }
    }
  }
  /**
   * Register a content (non-interactive) element
   */
  registerContentElement(id, element, options) {
    return this.registerElement(id, element, {
      type: options.contentType,
      label: options.label,
      actions: [],
      category: "content",
      contentMetadata: options.contentMetadata,
      origin: options.origin ?? "auto"
    });
  }
  /**
   * Get all content (non-interactive) elements
   */
  getAllContentElements() {
    return Array.from(this.elements.values()).filter((el) => el.category === "content");
  }
  /**
   * Register a media element (image, video, canvas, SVG, etc.)
   *
   * If a `refreshMetadata` callback is provided, mediaMetadata is re-captured
   * on every `getState()` call so loading transitions and video state stay fresh.
   */
  registerMediaElement(id, element, options) {
    const registered = this.registerElement(id, element, {
      type: options.mediaType,
      label: options.label,
      actions: [],
      category: "media",
      mediaMetadata: options.mediaMetadata,
      origin: options.origin ?? "auto"
    });
    if (options.refreshMetadata) {
      const originalGetState = registered.getState;
      const refreshFn = options.refreshMetadata;
      registered.getState = () => {
        const state = originalGetState();
        const freshMeta = refreshFn(element);
        registered.mediaMetadata = freshMeta;
        state.mediaMetadata = freshMeta;
        return state;
      };
    }
    return registered;
  }
  /**
   * Get all interactive elements
   */
  getAllInteractiveElements() {
    return Array.from(this.elements.values()).filter(
      (el) => el.category !== "content" && el.category !== "media"
    );
  }
  /**
   * Get all media elements
   */
  getAllMediaElements() {
    return Array.from(this.elements.values()).filter((el) => el.category === "media");
  }
  /**
   * Unregister an element
   */
  unregisterElement(id) {
    const registered = this.elements.get(id);
    if (registered) {
      if (this.options.preserveIdAcrossRemount && registered.element) {
        const fp = computeElementFingerprint(registered.element).hash;
        this.recentlyRemoved.set(fp, { id, fingerprint: fp, removedAt: Date.now() });
        if (this.recentlyRemoved.size > 100) {
          const firstKey = this.recentlyRemoved.keys().next().value;
          if (firstKey !== void 0) {
            this.recentlyRemoved.delete(firstKey);
          }
        }
      }
      registered.mounted = false;
      this.elements.delete(id);
      this.decrementRouteCount(registered.route, id);
      this.emit("element:unregistered", { id });
      this.options.elementEventLog?.removeElement(id);
      return true;
    }
    return false;
  }
  /**
   * Get a registered element
   */
  getElement(id) {
    return this.elements.get(id);
  }
  /**
   * Get all registered elements
   */
  getAllElements() {
    return Array.from(this.elements.values());
  }
  /**
   * Find element by DOM element reference
   */
  findByDOMElement(element) {
    for (const registered of this.elements.values()) {
      if (registered.element === element) {
        return registered;
      }
    }
    return void 0;
  }
  /**
   * Get element event history from the element event log.
   */
  getElementHistory(elementId, options) {
    return this.options.elementEventLog?.getHistory(elementId, options) ?? [];
  }
  /**
   * Set the log level override for a specific element.
   */
  setElementLogLevel(elementId, level) {
    this.options.elementEventLog?.setElementLogLevel(elementId, level);
  }
  /**
   * Get the effective log level for an element.
   */
  getElementLogLevel(elementId) {
    return this.options.elementEventLog?.getElementLogLevel(elementId) ?? "silent";
  }
  /**
   * Search for elements using AI search criteria
   */
  searchElements(criteria) {
    const results = [];
    const threshold = criteria.fuzzyThreshold ?? 0.7;
    for (const element of this.elements.values()) {
      if (!element.mounted) continue;
      const state = element.getState();
      if (!criteria.fuzzy && !state.visible) continue;
      const aliases = element.aliases ?? this.generateElementAliases(element);
      const textContent = state.textContent?.trim() || "";
      const label = element.label || "";
      let maxScore = 0;
      const matchReasons = [];
      const scores = {};
      if (criteria.text) {
        if (textContent.toLowerCase() === criteria.text.toLowerCase() || label.toLowerCase() === criteria.text.toLowerCase()) {
          maxScore = 1;
          matchReasons.push("exact text match");
          scores.text = 1;
        } else if (criteria.fuzzy !== false) {
          const textResult = fuzzyMatch(criteria.text, textContent, { threshold });
          const labelResult = fuzzyMatch(criteria.text, label, { threshold });
          const bestResult = textResult.similarity > labelResult.similarity ? textResult : labelResult;
          if (bestResult.isMatch) {
            scores.text = bestResult.similarity;
            if (bestResult.similarity > maxScore) {
              maxScore = bestResult.similarity;
              matchReasons.push(`text similarity: ${(bestResult.similarity * 100).toFixed(0)}%`);
            }
          }
        }
      }
      if (criteria.textContains) {
        if (textContent.toLowerCase().includes(criteria.textContains.toLowerCase()) || label.toLowerCase().includes(criteria.textContains.toLowerCase())) {
          const containsScore = 0.85;
          scores.text = Math.max(scores.text ?? 0, containsScore);
          if (containsScore > maxScore) {
            maxScore = containsScore;
            matchReasons.push("text contains");
          }
        }
      }
      if (criteria.accessibleName) {
        const ariaLabel = element.element.getAttribute("aria-label") || "";
        const accessibleName = ariaLabel || label || textContent;
        if (accessibleName.toLowerCase() === criteria.accessibleName.toLowerCase()) {
          scores.accessibility = 1;
          if (1 > maxScore) {
            maxScore = 1;
            matchReasons.push("accessible name match");
          }
        } else if (criteria.fuzzy !== false) {
          const result = fuzzyMatch(criteria.accessibleName, accessibleName, { threshold });
          if (result.isMatch) {
            scores.accessibility = result.similarity;
            if (result.similarity > maxScore) {
              maxScore = result.similarity;
              matchReasons.push(
                `accessible name similarity: ${(result.similarity * 100).toFixed(0)}%`
              );
            }
          }
        }
      }
      if (criteria.role) {
        const role = element.element.getAttribute("role") || this.inferRole(element.type);
        if (role?.toLowerCase() === criteria.role.toLowerCase()) {
          scores.role = 1;
          if (1 > maxScore) {
            maxScore = 1;
            matchReasons.push(`role: ${criteria.role}`);
          }
        }
      }
      if (criteria.type) {
        if (element.type === criteria.type) {
          const typeScore = 0.9;
          scores.role = Math.max(scores.role ?? 0, typeScore);
          if (typeScore > maxScore) {
            maxScore = typeScore;
            matchReasons.push(`type: ${criteria.type}`);
          }
        }
      }
      for (const alias of aliases) {
        const searchText = criteria.text || criteria.textContains || criteria.accessibleName;
        if (searchText) {
          if (alias.toLowerCase() === searchText.toLowerCase()) {
            scores.fuzzy = 1;
            if (1 > maxScore) {
              maxScore = 1;
              matchReasons.push(`alias: "${alias}"`);
            }
          } else if (criteria.fuzzy !== false) {
            const result = fuzzyMatch(searchText, alias, { threshold });
            if (result.isMatch && result.similarity > (scores.fuzzy ?? 0)) {
              scores.fuzzy = result.similarity;
              if (result.similarity > maxScore) {
                maxScore = result.similarity;
                matchReasons.push(`fuzzy alias: "${alias}"`);
              }
            }
          }
        }
      }
      if (maxScore >= threshold) {
        const aiElement = {
          id: element.id,
          type: element.type,
          label: element.label,
          tagName: element.element.tagName.toLowerCase(),
          role: element.element.getAttribute("role") || void 0,
          accessibleName: element.element.getAttribute("aria-label") || element.label,
          actions: element.actions,
          state,
          registered: true,
          description: element.description || generateDescription({
            textContent,
            ariaLabel: element.element.getAttribute("aria-label"),
            elementType: element.type,
            id: element.id,
            labelText: element.label
          }),
          aliases,
          purpose: element.purpose,
          suggestedActions: [],
          semanticType: element.semanticType
        };
        results.push({
          element: aiElement,
          confidence: maxScore,
          matchReasons,
          scores
        });
      }
    }
    results.sort((a, b) => b.confidence - a.confidence);
    return results;
  }
  /**
   * Find element by visible text
   */
  findByText(text, fuzzy = true) {
    const results = this.searchElements({ text, fuzzy, fuzzyThreshold: fuzzy ? 0.7 : 1 });
    if (results.length > 0) {
      return this.elements.get(results[0].element.id);
    }
    return void 0;
  }
  /**
   * Find element by accessible name
   */
  findByAccessibleName(name) {
    const results = this.searchElements({ accessibleName: name, fuzzy: true });
    if (results.length > 0) {
      return this.elements.get(results[0].element.id);
    }
    return void 0;
  }
  /**
   * Generate aliases for an element
   */
  generateElementAliases(element) {
    const state = element.getState();
    return generateAliases({
      textContent: state.textContent,
      ariaLabel: element.element.getAttribute("aria-label"),
      placeholder: element.element.getAttribute("placeholder"),
      title: element.element.getAttribute("title"),
      elementType: element.type,
      tagName: element.element.tagName.toLowerCase(),
      id: element.id,
      labelText: element.label
    });
  }
  /**
   * Infer ARIA role from element type
   */
  inferRole(type) {
    const roleMap = {
      button: "button",
      input: "textbox",
      select: "combobox",
      checkbox: "checkbox",
      radio: "radio",
      link: "link",
      form: void 0,
      textarea: "textbox",
      menu: "menu",
      menuitem: "menuitem",
      tab: "tab",
      dialog: "dialog",
      disclosure: "group",
      custom: void 0,
      switch: "switch",
      slider: "slider",
      combobox: "combobox",
      listbox: "listbox",
      option: "option",
      textbox: "textbox",
      generic: void 0,
      image: "img",
      video: void 0,
      canvas: void 0,
      svg: "img",
      picture: "img"
    };
    return roleMap[type];
  }
  /**
   * Update a component's options in place, without emitting a
   * `component:registered` event. Returns `false` if the component is not
   * currently registered — callers should fall back to `registerComponent`.
   *
   * Preserves `registeredAt` and `mounted`. Intended for React hooks that
   * want to reflect option changes on the same mounted consumer without
   * firing a full re-register (which would churn `useSyncExternalStore`
   * subscribers).
   */
  updateComponent(id, options) {
    const existing = this.components.get(id);
    if (!existing) return false;
    if (options.name !== void 0) existing.name = options.name;
    if (options.description !== void 0) existing.description = options.description;
    if (options.actions !== void 0) {
      existing.actions = options.actions.map((a) => ({
        id: a.id,
        label: a.label,
        description: a.description,
        paramSchema: a.paramSchema,
        handler: a.handler
      }));
    }
    if (options.elementIds !== void 0) existing.elementIds = options.elementIds;
    if (options.getState !== void 0) existing.getState = options.getState;
    if (options.getComputed !== void 0) existing.getComputed = options.getComputed;
    if (options.scope !== void 0) existing.scope = options.scope;
    return true;
  }
  /**
   * Register a component
   */
  registerComponent(id, options) {
    const registered = {
      id,
      name: options.name,
      description: options.description,
      actions: options.actions?.map((a) => ({
        id: a.id,
        label: a.label,
        description: a.description,
        paramSchema: a.paramSchema,
        handler: a.handler
      })) ?? [],
      elementIds: options.elementIds,
      registeredAt: Date.now(),
      mounted: true,
      getState: options.getState,
      getComputed: options.getComputed,
      scope: options.scope
    };
    this.components.set(id, registered);
    this.emit("component:registered", { id, name: options.name });
    return registered;
  }
  /**
   * Unregister a component
   */
  unregisterComponent(id) {
    const component = this.components.get(id);
    if (component) {
      component.mounted = false;
      this.components.delete(id);
      this.emit("component:unregistered", { id });
      return true;
    }
    return false;
  }
  /**
   * Get a registered component
   */
  getComponent(id) {
    return this.components.get(id);
  }
  /**
   * Get all registered components
   */
  getAllComponents() {
    return Array.from(this.components.values());
  }
  /**
   * Get the current state and computed properties of a component
   */
  getComponentState(id) {
    const component = this.components.get(id);
    if (!component || !component.mounted) {
      return null;
    }
    return {
      state: component.getState?.() ?? {},
      computed: component.getComputed?.() ?? {},
      timestamp: Date.now()
    };
  }
  /**
   * Register a workflow
   */
  registerWorkflow(workflow) {
    this.workflows.set(workflow.id, workflow);
    this.notifyStoreListeners();
    return workflow;
  }
  /**
   * Unregister a workflow
   */
  unregisterWorkflow(id) {
    const deleted = this.workflows.delete(id);
    if (deleted) this.notifyStoreListeners();
    return deleted;
  }
  /**
   * Get a workflow
   */
  getWorkflow(id) {
    return this.workflows.get(id);
  }
  /**
   * Get all workflows
   */
  getAllWorkflows() {
    return Array.from(this.workflows.values());
  }
  // ==========================================================================
  // State Management
  // ==========================================================================
  /**
   * Register a state
   */
  registerState(state) {
    this.states.set(state.id, state);
    this.emit("element:registered", { id: state.id, type: "state", name: state.name });
    return state;
  }
  /**
   * Update a state's stored options in place. See `updateComponent` for
   * rationale — avoids re-emitting `element:registered`/`unregistered`
   * pairs on every option change so `useSyncExternalStore` consumers don't
   * re-render on minor metadata edits.
   */
  updateState(state) {
    if (!this.states.has(state.id)) return false;
    this.states.set(state.id, state);
    return true;
  }
  /**
   * Unregister a state
   */
  unregisterState(id) {
    const state = this.states.get(id);
    if (state) {
      this.activeStates.delete(id);
      this.states.delete(id);
      this.emit("element:unregistered", { id, type: "state" });
      return true;
    }
    return false;
  }
  /**
   * Get a registered state
   */
  getState(id) {
    return this.states.get(id);
  }
  /**
   * Get all registered states
   */
  getAllStates() {
    return Array.from(this.states.values());
  }
  /**
   * Register a state group
   */
  registerStateGroup(group) {
    this.stateGroups.set(group.id, group);
    return group;
  }
  /** In-place update — see `updateComponent`. */
  updateStateGroup(group) {
    if (!this.stateGroups.has(group.id)) return false;
    this.stateGroups.set(group.id, group);
    return true;
  }
  /**
   * Unregister a state group
   */
  unregisterStateGroup(id) {
    return this.stateGroups.delete(id);
  }
  /**
   * Get a state group
   */
  getStateGroup(id) {
    return this.stateGroups.get(id);
  }
  /**
   * Get all state groups
   */
  getAllStateGroups() {
    return Array.from(this.stateGroups.values());
  }
  /**
   * Register a transition
   */
  registerTransition(transition) {
    this.transitions.set(transition.id, transition);
    return transition;
  }
  /** In-place update — see `updateComponent`. */
  updateTransition(transition) {
    if (!this.transitions.has(transition.id)) return false;
    this.transitions.set(transition.id, transition);
    return true;
  }
  /**
   * Unregister a transition
   */
  unregisterTransition(id) {
    return this.transitions.delete(id);
  }
  /**
   * Get a transition
   */
  getTransition(id) {
    return this.transitions.get(id);
  }
  /**
   * Get all transitions
   */
  getAllTransitions() {
    return Array.from(this.transitions.values());
  }
  /**
   * Get currently active states
   */
  getActiveStates() {
    return Array.from(this.activeStates);
  }
  /**
   * Check if a state is active
   */
  isStateActive(id) {
    return this.activeStates.has(id);
  }
  /**
   * Activate a state
   */
  activateState(id) {
    const state = this.states.get(id);
    if (!state) {
      return false;
    }
    for (const activeId of this.activeStates) {
      const activeState = this.states.get(activeId);
      if (activeState?.blocking && activeState.id !== id) {
        return false;
      }
      if (activeState?.blocks?.includes(id)) {
        return false;
      }
    }
    const wasActive = this.activeStates.has(id);
    this.activeStates.add(id);
    if (!wasActive) {
      this.emit("element:stateChanged", {
        stateId: id,
        active: true,
        activeStates: this.getActiveStates()
      });
    }
    return true;
  }
  /**
   * Deactivate a state
   */
  deactivateState(id) {
    const wasActive = this.activeStates.has(id);
    this.activeStates.delete(id);
    if (wasActive) {
      this.emit("element:stateChanged", {
        stateId: id,
        active: false,
        activeStates: this.getActiveStates()
      });
    }
    return wasActive;
  }
  /**
   * Activate multiple states
   */
  activateStates(ids) {
    const activated = [];
    for (const id of ids) {
      if (this.activateState(id)) {
        activated.push(id);
      }
    }
    return activated;
  }
  /**
   * Deactivate multiple states
   */
  deactivateStates(ids) {
    const deactivated = [];
    for (const id of ids) {
      if (this.deactivateState(id)) {
        deactivated.push(id);
      }
    }
    return deactivated;
  }
  /**
   * Activate a state group (all states in the group)
   */
  activateStateGroup(groupId) {
    const group = this.stateGroups.get(groupId);
    if (!group) return [];
    return this.activateStates(group.states);
  }
  /**
   * Deactivate a state group (all states in the group)
   */
  deactivateStateGroup(groupId) {
    const group = this.stateGroups.get(groupId);
    if (!group) return [];
    return this.deactivateStates(group.states);
  }
  /**
   * Check if a transition can be executed from current state
   */
  canExecuteTransition(transitionId) {
    const transition = this.transitions.get(transitionId);
    if (!transition) return false;
    return transition.fromStates.some((stateId) => this.activeStates.has(stateId));
  }
  /**
   * Execute a transition
   */
  async executeTransition(transitionId) {
    const startTime = performance.now();
    const transition = this.transitions.get(transitionId);
    if (!transition) {
      return {
        success: false,
        activatedStates: [],
        deactivatedStates: [],
        error: `Transition not found: ${transitionId}`,
        durationMs: performance.now() - startTime
      };
    }
    if (!this.canExecuteTransition(transitionId)) {
      return {
        success: false,
        activatedStates: [],
        deactivatedStates: [],
        error: "Precondition not met: none of the fromStates are active",
        failedPhase: "precondition",
        durationMs: performance.now() - startTime
      };
    }
    try {
      const deactivated = this.deactivateStates(transition.exitStates);
      if (transition.exitGroups) {
        for (const groupId of transition.exitGroups) {
          deactivated.push(...this.deactivateStateGroup(groupId));
        }
      }
      const activated = this.activateStates(transition.activateStates);
      if (transition.activateGroups) {
        for (const groupId of transition.activateGroups) {
          activated.push(...this.activateStateGroup(groupId));
        }
      }
      return {
        success: true,
        activatedStates: activated,
        deactivatedStates: deactivated,
        durationMs: performance.now() - startTime
      };
    } catch (error) {
      return {
        success: false,
        activatedStates: [],
        deactivatedStates: [],
        error: error instanceof Error ? error.message : String(error),
        failedPhase: "execution",
        durationMs: performance.now() - startTime
      };
    }
  }
  /**
   * Find a path from current state to target states
   *
   * Uses a simple BFS algorithm for pathfinding.
   * For more advanced pathfinding (Dijkstra, A*), use the Python state manager service.
   */
  findPath(targetStates) {
    if (targetStates.every((t) => this.activeStates.has(t))) {
      return {
        found: true,
        transitions: [],
        totalCost: 0,
        targetStates,
        estimatedSteps: 0
      };
    }
    const queue = [
      { activeStates: new Set(this.activeStates), path: [], cost: 0 }
    ];
    const visited = /* @__PURE__ */ new Set();
    while (queue.length > 0) {
      const current = queue.shift();
      const stateKey = Array.from(current.activeStates).sort().join(",");
      if (visited.has(stateKey)) continue;
      visited.add(stateKey);
      if (targetStates.every((t) => current.activeStates.has(t))) {
        return {
          found: true,
          transitions: current.path,
          totalCost: current.cost,
          targetStates,
          estimatedSteps: current.path.length
        };
      }
      for (const transition of this.transitions.values()) {
        const canExecute = transition.fromStates.some((s) => current.activeStates.has(s));
        if (!canExecute) continue;
        const newActive = new Set(current.activeStates);
        for (const s of transition.exitStates) newActive.delete(s);
        for (const s of transition.activateStates) newActive.add(s);
        const newCost = current.cost + (transition.pathCost ?? 1);
        queue.push({
          activeStates: newActive,
          path: [...current.path, transition.id],
          cost: newCost
        });
      }
    }
    return {
      found: false,
      transitions: [],
      totalCost: 0,
      targetStates,
      estimatedSteps: 0
    };
  }
  /**
   * Navigate to target states using pathfinding
   */
  async navigateTo(targetStates) {
    const startTime = performance.now();
    const path = this.findPath(targetStates);
    if (!path.found) {
      return {
        success: false,
        path,
        executedTransitions: [],
        finalActiveStates: this.getActiveStates(),
        error: `No path found to target states: ${targetStates.join(", ")}`,
        durationMs: performance.now() - startTime
      };
    }
    const executedTransitions = [];
    for (const transitionId of path.transitions) {
      const result = await this.executeTransition(transitionId);
      if (!result.success) {
        return {
          success: false,
          path,
          executedTransitions,
          finalActiveStates: this.getActiveStates(),
          error: result.error,
          durationMs: performance.now() - startTime
        };
      }
      executedTransitions.push(transitionId);
    }
    return {
      success: true,
      path,
      executedTransitions,
      finalActiveStates: this.getActiveStates(),
      durationMs: performance.now() - startTime
    };
  }
  /**
   * Create a state snapshot
   */
  createStateSnapshot() {
    return {
      timestamp: Date.now(),
      activeStates: this.getActiveStates(),
      states: this.getAllStates(),
      groups: this.getAllStateGroups(),
      transitions: this.getAllTransitions()
    };
  }
  /**
   * Whether this registry instance has ever had an element register in its
   * lifetime. Sticky — flips true on first `registerElement` and stays true
   * until `clear()`.  Exposed primarily for tests; production code should
   * read `BridgeSnapshot.registration.everHadRegistrations`.
   */
  hasEverHadRegistrations() {
    return this.everHadRegistrationsFlag;
  }
  /**
   * Per-route counts of currently-registered elements, plus the ids that
   * make up each count. Returns a plain object copy so callers can't mutate
   * internal state. Elements with an undefined route are omitted. Exposed
   * primarily for tests; production code should read
   * `BridgeSnapshot.registration.byRoute`.
   *
   * Each value is `{ count: number; ids: string[] }`. The `count` field
   * mirrors the prior `Record<string, number>` shape (kept verbatim so
   * existing readers like the cross-route 404 hint can detect coverage),
   * and `ids` enumerates the element ids registered on that route at
   * snapshot time. Phase 1.2 — see plan dated 2026-05-03.
   */
  getCountsByRoute() {
    const out = {};
    for (const [route, count] of this.routeCounts) {
      if (route === "") continue;
      if (count > 0) {
        const idSet = this.routeIds.get(route);
        const ids = idSet ? Array.from(idSet) : [];
        out[route] = { count, ids };
      }
    }
    return out;
  }
  /**
   * Build the F3 registration-diagnostics metadata for a snapshot. Shared
   * by `createSnapshot` and `createSnapshotAsync` so both paths emit the
   * same shape.
   */
  buildRegistrationMetadata() {
    return {
      totalRegistered: this.elements.size,
      everHadRegistrations: this.everHadRegistrationsFlag,
      byRoute: this.getCountsByRoute()
    };
  }
  /**
   * Best-effort read of the current page route. Matches the default source
   * `registerElement` uses, so the snapshot's top-level `route` lines up
   * with the `byRoute` keys under normal operation.
   */
  currentRoute() {
    if (typeof window !== "undefined" && window.location?.pathname) {
      return window.location.pathname;
    }
    return void 0;
  }
  /**
   * Resolve the optional `activeTab` field for a snapshot. Applications that
   * decouple their visible pane from `window.location` (e.g. the runner's
   * tab-based shell) supply a `getActiveTab` callback in the snapshot options;
   * the SDK itself has no concept of "tab", so without a provider the field
   * stays undefined and non-tab-based consumers are unaffected. Errors thrown
   * by the provider are swallowed so a buggy host can never break the rest of
   * the snapshot.
   */
  resolveActiveTab(getActiveTab) {
    if (!getActiveTab) return void 0;
    try {
      const value = getActiveTab();
      return typeof value === "string" && value.length > 0 ? value : void 0;
    } catch {
      return void 0;
    }
  }
  /**
   * Run every registered snapshot enricher (canonical + pluggable extras) and
   * mutate `snapshot` in place with their output. Each call is wrapped in its
   * own try/catch so a misbehaving tracker can never break the rest of the
   * snapshot. Shared by `createSnapshot` and `createSnapshotAsync` so both
   * paths emit identically-enriched output.
   *
   * Also exposed as the public {@link runSnapshotEnrichers} entry point for
   * callers that build a snapshot shape outside `createSnapshot{,Async}` (e.g.
   * the relay/WS dispatcher in `commandHandlers.getControlSnapshot`, which
   * keeps a richer workflow + component shape but still wants the seven
   * canonical fields). Routing both shapes through this single helper keeps
   * the snapshot-two-channel-drift class structurally impossible — see
   * memory note `proj_issue_snapshot_two_channel_drift.md`.
   */
  runSnapshotEnrichers(snapshot, options = {}) {
    this.runEnrichers(snapshot, options);
  }
  runEnrichers(snapshot, options = {}) {
    if (this.enrichers.navigationTracker) {
      try {
        snapshot.page = this.enrichers.navigationTracker.getSnapshotPageContext();
      } catch (error) {
        if (this.options.verbose) {
          console.warn(`[ui-bridge] page enricher threw:`, error);
        }
      }
    }
    if (this.enrichers.modalDetector) {
      try {
        snapshot.modalStack = this.enrichers.modalDetector.getSnapshotModalContext();
      } catch (error) {
        if (this.options.verbose) {
          console.warn(`[ui-bridge] modalStack enricher threw:`, error);
        }
      }
    }
    if (this.enrichers.toastCapture) {
      try {
        snapshot.toasts = this.enrichers.toastCapture.getSnapshotToastContext();
      } catch (error) {
        if (this.options.verbose) {
          console.warn(`[ui-bridge] toasts enricher threw:`, error);
        }
      }
    }
    let elementPairs = null;
    const getElementPairs = () => {
      if (elementPairs === null) {
        elementPairs = this.getAllElements().map((e) => ({ id: e.id, element: e.element }));
      }
      return elementPairs;
    };
    if (this.enrichers.relationshipTracker) {
      try {
        snapshot.relationships = this.enrichers.relationshipTracker.getSnapshotRelationshipContext(getElementPairs());
      } catch (error) {
        if (this.options.verbose) {
          console.warn(`[ui-bridge] relationships enricher threw:`, error);
        }
      }
    }
    if (this.enrichers.dragDropDetector) {
      try {
        snapshot.dragDrop = this.enrichers.dragDropDetector.getSnapshotDragDropContext(getElementPairs());
      } catch (error) {
        if (this.options.verbose) {
          console.warn(`[ui-bridge] dragDrop enricher threw:`, error);
        }
      }
    }
    if (this.enrichers.undoTracker) {
      try {
        snapshot.undoRedo = this.enrichers.undoTracker.getSnapshotUndoContext();
      } catch (error) {
        if (this.options.verbose) {
          console.warn(`[ui-bridge] undoRedo enricher threw:`, error);
        }
      }
    }
    if (this.enrichers.shortcutTracker) {
      try {
        snapshot.shortcuts = this.enrichers.shortcutTracker.getSnapshotShortcutContext();
      } catch (error) {
        if (this.options.verbose) {
          console.warn(`[ui-bridge] shortcuts enricher threw:`, error);
        }
      }
    }
    if (this.snapshotExtras.size > 0) {
      const ctx = {
        elements: getElementPairs(),
        getActiveTab: options.getActiveTab,
        snapshotSoFar: snapshot
      };
      for (const [name, fn] of this.snapshotExtras) {
        try {
          const extra = fn(ctx);
          if (extra && typeof extra === "object") {
            Object.assign(snapshot, extra);
          }
        } catch (error) {
          if (this.options.verbose) {
            console.warn(`[ui-bridge] snapshot enricher "${name}" threw:`, error);
          }
        }
      }
    }
  }
  /**
   * Create a snapshot of the current state
   */
  createSnapshot(options = {}) {
    const takenAt = Date.now();
    const activeTab = this.resolveActiveTab(options.getActiveTab);
    const visibility = captureDocumentVisibility();
    const snapshot = {
      timestamp: takenAt,
      snapshotTakenAtMs: takenAt,
      route: this.currentRoute(),
      ...activeTab !== void 0 ? { activeTab } : {},
      ...visibility !== void 0 ? { visibility } : {},
      registration: this.buildRegistrationMetadata(),
      elements: this.getAllElements().map((el) => serializeRegisteredElement(el, options)),
      components: this.getAllComponents().map((comp) => ({
        id: comp.id,
        name: comp.name,
        description: comp.description,
        actions: comp.actions.map((a) => a.id),
        // Tell the caller exactly how to invoke any action on this component
        // without having to grep docs or guess the route shape.
        actionInvocationPath: `/control/component/${comp.id}/action/{actionId}`,
        elementIds: comp.elementIds,
        // Phase 3.1: discoverability scope. Pass through verbatim — undefined
        // is the documented default ("route").
        scope: comp.scope
      })),
      workflows: this.getAllWorkflows().map((wf) => ({
        id: wf.id,
        name: wf.name,
        description: wf.description,
        stepCount: wf.steps.length
      }))
    };
    this.runEnrichers(snapshot, { getActiveTab: options.getActiveTab });
    return snapshot;
  }
  /**
   * Create a snapshot asynchronously, processing elements in batches to avoid
   * blocking the main thread. This prevents "Page Unresponsive" dialogs when
   * there are many registered elements (200-500+), since getState() and
   * getIdentifier() force layout/style recalculation for each element.
   */
  async createSnapshotAsync(batchSize = 50, options = {}) {
    const allElements = this.getAllElements();
    const elementSnapshots = [];
    for (let i = 0; i < allElements.length; i += batchSize) {
      const batch = allElements.slice(i, i + batchSize);
      for (const el of batch) {
        elementSnapshots.push(serializeRegisteredElement(el, options));
      }
      if (i + batchSize < allElements.length) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    const takenAt = Date.now();
    const activeTab = this.resolveActiveTab(options.getActiveTab);
    const visibility = captureDocumentVisibility();
    const snapshot = {
      timestamp: takenAt,
      snapshotTakenAtMs: takenAt,
      route: this.currentRoute(),
      ...activeTab !== void 0 ? { activeTab } : {},
      ...visibility !== void 0 ? { visibility } : {},
      registration: this.buildRegistrationMetadata(),
      elements: elementSnapshots,
      components: this.getAllComponents().map((comp) => ({
        id: comp.id,
        name: comp.name,
        description: comp.description,
        actions: comp.actions.map((a) => a.id),
        // Tell the caller exactly how to invoke any action on this component
        // without having to grep docs or guess the route shape.
        actionInvocationPath: `/control/component/${comp.id}/action/{actionId}`,
        elementIds: comp.elementIds,
        // Phase 3.1: discoverability scope. Pass through verbatim — undefined
        // is the documented default ("route").
        scope: comp.scope
      })),
      workflows: this.getAllWorkflows().map((wf) => ({
        id: wf.id,
        name: wf.name,
        description: wf.description,
        stepCount: wf.steps.length
      }))
    };
    this.runEnrichers(snapshot, { getActiveTab: options.getActiveTab });
    return snapshot;
  }
  /**
   * Clear all registrations
   */
  clear() {
    this.elements.clear();
    this.components.clear();
    this.workflows.clear();
    this.eventListeners.clear();
    this.states.clear();
    this.stateGroups.clear();
    this.transitions.clear();
    this.activeStates.clear();
    this.routeCounts.clear();
    this.routeIds.clear();
    this.everHadRegistrationsFlag = false;
  }
  /**
   * Get registry statistics
   */
  getStats() {
    const elements = this.getAllElements();
    const components = this.getAllComponents();
    return {
      elementCount: elements.length,
      componentCount: components.length,
      workflowCount: this.workflows.size,
      mountedElementCount: elements.filter((e) => e.mounted).length,
      mountedComponentCount: components.filter((c) => c.mounted).length,
      stateCount: this.states.size,
      stateGroupCount: this.stateGroups.size,
      transitionCount: this.transitions.size,
      activeStateCount: this.activeStates.size
    };
  }
};
var REGISTRY_KEY = /* @__PURE__ */ Symbol.for("@qontinui/ui-bridge/globalRegistry");
function getRegistrySlot() {
  return globalThis;
}
function getGlobalRegistry() {
  const slot = getRegistrySlot();
  let current = slot[REGISTRY_KEY] ?? null;
  if (!current) {
    current = new UIBridgeRegistry();
    slot[REGISTRY_KEY] = current;
  }
  return current;
}

// src/ai/search-engine.ts
function isFindDebugEnabled() {
  try {
    const proc = globalThis.process;
    if (proc?.env?.UI_BRIDGE_DEBUG_FIND === "1") {
      return true;
    }
  } catch {
  }
  try {
    const ls = globalThis.localStorage;
    if (ls && typeof ls.getItem === "function") {
      if (ls.getItem("UI_BRIDGE_DEBUG_FIND") === "1") {
        return true;
      }
    }
  } catch {
  }
  return false;
}
function truncForDebug(s, max = 80) {
  if (!s) return s;
  return s.length > max ? `${s.slice(0, max)}\u2026` : s;
}
var TOKEN_PUNCTUATION_RE = /[:,.;!?/()\\[\]{}<>"`—–-]+/g;
function tokenizeForAlignment(s) {
  return s.toLowerCase().replace(TOKEN_PUNCTUATION_RE, " ").replace(/_+/g, " ").split(/\s+/).filter((t) => t.length > 0);
}
function analyzeTokenAlignment(query, target) {
  const queryTokens = tokenizeForAlignment(query);
  const targetTokens = tokenizeForAlignment(target);
  const totalQueryTokens = queryTokens.length;
  if (totalQueryTokens === 0 || targetTokens.length === 0) {
    return { kind: "none", matchedTokenCount: 0, totalQueryTokens };
  }
  let prefixMatches = 0;
  for (const qt of queryTokens) {
    if (targetTokens.some((tt) => tt.startsWith(qt))) {
      prefixMatches += 1;
    }
  }
  if (prefixMatches === totalQueryTokens) {
    return { kind: "prefix-aligned", matchedTokenCount: prefixMatches, totalQueryTokens };
  }
  let presenceMatches = 0;
  for (const qt of queryTokens) {
    if (targetTokens.some((tt) => tt.includes(qt))) {
      presenceMatches += 1;
    }
  }
  if (presenceMatches === totalQueryTokens) {
    return {
      kind: "all-tokens-present",
      matchedTokenCount: presenceMatches,
      totalQueryTokens
    };
  }
  if (presenceMatches > 0) {
    return { kind: "partial", matchedTokenCount: presenceMatches, totalQueryTokens };
  }
  return { kind: "none", matchedTokenCount: 0, totalQueryTokens };
}
var DEFAULT_SEARCH_CONFIG = {
  fuzzyThreshold: 0.7,
  textWeight: 0.35,
  accessibilityWeight: 0.25,
  roleWeight: 0.15,
  spatialWeight: 0.1,
  aliasWeight: 0.15,
  maxResults: 20,
  includeHidden: false
};
var _SearchEngine = class _SearchEngine {
  // Cache valid for 100ms
  constructor(config = {}) {
    this.cachedElements = [];
    this.cacheTimestamp = 0;
    this.cacheValidityMs = 100;
    this.config = { ...DEFAULT_SEARCH_CONFIG, ...config };
  }
  /**
   * Update cached elements from various sources
   */
  updateElements(elements, getState) {
    this.cachedElements = elements.map((el) => this.toSearchable(el, getState));
    this.cacheTimestamp = Date.now();
  }
  /**
   * Peek at the engine's current cache of {id, type} pairs.
   *
   * Used by callers like `find.ts` that need to know whether a given
   * element-type guess is even present in the cached page before deciding to
   * relax type-pinned criteria. Returns a copy so callers can iterate freely
   * without affecting the engine's internal state — and never exposes the
   * full `SearchableElement` shape so we don't leak internal scoring helpers
   * across the module boundary.
   */
  getCachedElementSummaries() {
    return this.cachedElements.map((el) => ({ id: el.id, type: el.type }));
  }
  /**
   * Convert an element to searchable format
   */
  toSearchable(element, getState) {
    let state;
    let textContent;
    let tagName;
    let role;
    let ariaLabel;
    let placeholder;
    let title;
    let labelText;
    let value;
    let name;
    if ("getState" in element && typeof element.getState === "function") {
      state = getState ? getState(element) : element.getState();
      textContent = state.textContent || void 0;
      try {
        tagName = element.element.tagName.toLowerCase();
      } catch {
        tagName = element.type || "unknown";
      }
      try {
        role = element.element.getAttribute("role") || void 0;
        ariaLabel = element.element.getAttribute("aria-label") || void 0;
        placeholder = element.element.getAttribute("placeholder") || void 0;
        title = element.element.getAttribute("title") || void 0;
        name = element.element.getAttribute("name") || void 0;
      } catch {
      }
      if (!ariaLabel && element.label) {
        ariaLabel = element.label;
      }
      try {
        if (element.element.id) {
          const labelEl = document.querySelector(`label[for="${element.element.id}"]`);
          labelText = labelEl?.textContent?.trim() || void 0;
        }
        if (!labelText) {
          let ancestor = element.element.parentElement;
          while (ancestor) {
            if (ancestor.tagName.toLowerCase() === "label") {
              labelText = ancestor.textContent?.trim() || void 0;
              break;
            }
            ancestor = ancestor.parentElement;
          }
        }
      } catch {
      }
      if (!labelText && element.label) {
        labelText = element.label;
      }
      if (!textContent && element.label) {
        textContent = element.label;
      }
      try {
        if (element.element instanceof HTMLInputElement || element.element instanceof HTMLTextAreaElement || element.element instanceof HTMLSelectElement) {
          value = element.element.value || void 0;
        }
      } catch {
        value = state.value || void 0;
      }
    } else {
      const discovered = element;
      state = discovered.state;
      textContent = state.textContent || void 0;
      tagName = discovered.tagName;
      role = discovered.role || void 0;
      ariaLabel = discovered.accessibleName || void 0;
      if (!labelText && element.label) {
        labelText = element.label;
      }
    }
    let aliases = generateAliases({
      textContent,
      ariaLabel,
      placeholder,
      title,
      elementType: element.type,
      id: element.id,
      labelText,
      value
    });
    if ("aliases" in element && Array.isArray(element.aliases) && element.aliases.length > 0) {
      const aliasSet = /* @__PURE__ */ new Set([
        ...aliases,
        ...element.aliases.map((a) => a.toLowerCase())
      ]);
      aliases = [...aliasSet];
    }
    let description = generateDescription({
      textContent,
      ariaLabel,
      placeholder,
      title,
      elementType: element.type,
      id: element.id,
      labelText
    });
    if (!description && "description" in element && element.description) {
      description = element.description;
    }
    const annotation = getGlobalAnnotationStore().get(element.id);
    if (annotation) {
      if (annotation.description) {
        description = annotation.description;
      }
      if (annotation.tags && annotation.tags.length > 0) {
        const tagSet = /* @__PURE__ */ new Set([...aliases, ...annotation.tags.map((t) => t.toLowerCase())]);
        aliases = [...tagSet];
      }
      if (annotation.notes) {
        aliases.push(annotation.notes.toLowerCase());
      }
    }
    const parentContext = this.resolveParentContext(element);
    const iconAliases = this.inferIconAliases(element);
    if (iconAliases.length > 0 && !textContent && !ariaLabel) {
      const aliasSet = /* @__PURE__ */ new Set([...aliases, ...iconAliases]);
      aliases = [...aliasSet];
      if (!textContent) {
        textContent = iconAliases[0];
      }
    }
    return {
      id: element.id,
      element,
      state,
      textContent,
      ariaLabel,
      placeholder,
      title,
      role,
      tagName,
      type: element.type,
      aliases,
      description,
      rect: state.rect,
      labelText,
      value,
      name,
      parentContext
    };
  }
  /**
   * Search for elements matching the criteria
   */
  search(criteria, elements) {
    const startTime = performance.now();
    if (elements) {
      this.updateElements(elements);
    }
    let searchableElements = this.cachedElements;
    if (!this.config.includeHidden && !criteria.fuzzy) {
      searchableElements = searchableElements.filter((el) => el.state.visible);
    }
    const debugEnabled = isFindDebugEnabled();
    let candidateElementsForDebug;
    let allScoredForDebug;
    if (debugEnabled) {
      const criteriaTypeLower = criteria.type?.toLowerCase();
      candidateElementsForDebug = this.cachedElements.filter((el) => {
        const idHit = el.id.toLowerCase().includes("advanced");
        const typeHit = criteriaTypeLower ? el.type.toLowerCase() === criteriaTypeLower : false;
        return idHit || typeHit;
      }).map((el) => ({
        id: el.id,
        type: el.type,
        labelText: truncForDebug(el.labelText),
        ariaLabel: truncForDebug(el.ariaLabel)
      }));
      allScoredForDebug = [];
      try {
        console.debug("[ui-bridge:find] cachedElements.length=", this.cachedElements.length);
        console.debug(
          "[ui-bridge:find] searchableElements.length (post visibility filter)=",
          searchableElements.length
        );
        console.debug("[ui-bridge:find] criteria=", JSON.stringify(criteria));
        console.debug(
          "[ui-bridge:find] candidateElements=",
          JSON.stringify(candidateElementsForDebug)
        );
      } catch {
      }
    }
    const results = [];
    for (const searchable of searchableElements) {
      const result = this.scoreElement(searchable, criteria);
      if (debugEnabled && allScoredForDebug && result.confidence > 0) {
        allScoredForDebug.push({
          id: searchable.id,
          confidence: result.confidence,
          scores: result.scores
        });
      }
      if (result.confidence >= (criteria.fuzzyThreshold ?? this.config.fuzzyThreshold)) {
        results.push(result);
      }
    }
    results.sort((a, b) => b.confidence - a.confidence);
    const limitedResults = results.slice(0, this.config.maxResults);
    if (debugEnabled && allScoredForDebug && candidateElementsForDebug) {
      const topScored = allScoredForDebug.slice().sort((a, b) => b.confidence - a.confidence).slice(0, 5);
      let registryTags;
      try {
        const tags = [];
        let getGlobalRegistryTag = null;
        try {
          const reg = getGlobalRegistry();
          if (reg && typeof reg.__instanceTag === "string") {
            getGlobalRegistryTag = reg.__instanceTag;
            tags.push({ source: "getGlobalRegistry()", tag: reg.__instanceTag });
          }
        } catch {
        }
        let windowProvidersTag = null;
        let windowProvidersHasRegistry = false;
        try {
          const w = globalThis.__UI_BRIDGE__;
          if (w && typeof w === "object") {
            const candidate = w.registry;
            if (candidate && typeof candidate.__instanceTag === "string") {
              windowProvidersHasRegistry = true;
              windowProvidersTag = candidate.__instanceTag;
              tags.push({
                source: "globalThis.__UI_BRIDGE__.registry",
                tag: candidate.__instanceTag
              });
            }
          }
        } catch {
        }
        registryTags = {
          getGlobalRegistryTag,
          windowProvidersTag,
          windowProvidersHasRegistry,
          allWindowTags: tags
        };
      } catch {
      }
      const diagnostic = {
        cachedElementsLength: this.cachedElements.length,
        searchableElementsLength: searchableElements.length,
        candidateElements: candidateElementsForDebug,
        topScored,
        criteria,
        threshold: criteria.fuzzyThreshold ?? this.config.fuzzyThreshold,
        resultsAboveThreshold: limitedResults.length,
        registryTags,
        timestamp: Date.now()
      };
      try {
        console.debug("[ui-bridge:find] topScored=", JSON.stringify(topScored));
      } catch {
      }
      try {
        globalThis.__UI_BRIDGE_LAST_FIND_DIAGNOSTIC__ = diagnostic;
      } catch {
      }
    }
    return {
      results: limitedResults,
      bestMatch: limitedResults.length > 0 ? limitedResults[0] : null,
      scannedCount: searchableElements.length,
      durationMs: performance.now() - startTime,
      criteria,
      timestamp: Date.now()
    };
  }
  /**
   * Find the best matching element
   */
  findBest(criteria, elements) {
    const response = this.search(criteria, elements);
    return response.bestMatch;
  }
  /**
   * Find elements by text content
   */
  findByText(text, fuzzy = true, elements) {
    return this.search({ text, fuzzy }, elements).results;
  }
  /**
   * Find elements by role
   */
  findByRole(role, name, elements) {
    const criteria = { role };
    if (name) {
      criteria.accessibleName = name;
    }
    return this.search(criteria, elements).results;
  }
  /**
   * Find elements by accessible name
   */
  findByAccessibleName(name, elements) {
    return this.search({ accessibleName: name, fuzzy: true }, elements).results;
  }
  /**
   * Find elements near another element
   */
  findNear(referenceId, criteria, elements) {
    return this.search({ ...criteria, near: referenceId }, elements).results;
  }
  /**
   * Find elements within a container
   */
  findWithin(containerId, criteria, elements) {
    return this.search({ ...criteria, within: containerId }, elements).results;
  }
  /**
   * Score an element against search criteria
   */
  scoreElement(searchable, criteria) {
    const scores = {};
    const matchReasons = [];
    let totalWeight = 0;
    let weightedScore = 0;
    const fuzzyConfig = {
      ...DEFAULT_FUZZY_CONFIG,
      threshold: criteria.fuzzyThreshold ?? this.config.fuzzyThreshold
    };
    if (criteria.text) {
      const textScore = this.scoreTextMatch(
        searchable,
        criteria.text,
        criteria.fuzzy !== false,
        fuzzyConfig.threshold
      );
      scores.text = textScore.score;
      if (textScore.score > 0) {
        matchReasons.push(...textScore.reasons);
      }
      weightedScore += textScore.score * this.config.textWeight;
      totalWeight += this.config.textWeight;
    }
    if (criteria.textContent && !criteria.text) {
      const alternatives = criteria.textContent.includes("|") ? criteria.textContent.split("|").map((s) => s.trim()).filter(Boolean) : [criteria.textContent];
      let bestScore = 0;
      let bestReasons = [];
      for (const alt of alternatives) {
        const exactScore = this.scoreTextMatch(
          searchable,
          alt,
          criteria.fuzzy !== false,
          fuzzyConfig.threshold
        );
        const containsScore = this.scoreContainsMatch(searchable, alt, criteria.fuzzy !== false);
        const altBest = Math.max(exactScore.score, containsScore.score);
        if (altBest > bestScore) {
          bestScore = altBest;
          bestReasons = exactScore.score >= containsScore.score ? exactScore.reasons : containsScore.reasons;
        }
      }
      scores.text = bestScore;
      if (bestScore > 0) {
        matchReasons.push(...bestReasons);
      }
      weightedScore += bestScore * this.config.textWeight;
      totalWeight += this.config.textWeight;
    }
    if (criteria.textContains) {
      const containsScore = this.scoreContainsMatch(
        searchable,
        criteria.textContains,
        criteria.fuzzy !== false
      );
      scores.text = Math.max(scores.text || 0, containsScore.score);
      if (containsScore.score > 0 && containsScore.reasons.length > 0) {
        matchReasons.push(...containsScore.reasons);
      }
      weightedScore += containsScore.score * this.config.textWeight;
      totalWeight += this.config.textWeight;
    }
    if (criteria.accessibleName) {
      const accessibilityScore = this.scoreAccessibilityMatch(
        searchable,
        criteria.accessibleName,
        criteria.fuzzy !== false,
        fuzzyConfig.threshold
      );
      scores.accessibility = accessibilityScore.score;
      if (accessibilityScore.score > 0) {
        matchReasons.push(...accessibilityScore.reasons);
      }
      weightedScore += accessibilityScore.score * this.config.accessibilityWeight;
      totalWeight += this.config.accessibilityWeight;
    }
    if (criteria.role) {
      const roleScore = this.scoreRoleMatch(searchable, criteria.role);
      scores.role = roleScore.score;
      if (roleScore.score > 0) {
        matchReasons.push(...roleScore.reasons);
      }
      weightedScore += roleScore.score * this.config.roleWeight;
      totalWeight += this.config.roleWeight;
    }
    if (criteria.type) {
      const typeMatch = searchable.type.toLowerCase() === criteria.type.toLowerCase();
      if (typeMatch) {
        matchReasons.push(`type: ${criteria.type}`);
        weightedScore += 1 * this.config.roleWeight;
        totalWeight += this.config.roleWeight;
      }
    }
    if (criteria.near) {
      const spatialScore = this.scoreSpatialMatch(searchable, criteria.near);
      scores.spatial = spatialScore.score;
      if (spatialScore.score > 0) {
        matchReasons.push(...spatialScore.reasons);
      }
      weightedScore += spatialScore.score * this.config.spatialWeight;
      totalWeight += this.config.spatialWeight;
    }
    if (criteria.placeholder && searchable.placeholder) {
      const placeholderResult = fuzzyMatch(
        searchable.placeholder,
        criteria.placeholder,
        fuzzyConfig
      );
      if (placeholderResult.isMatch) {
        matchReasons.push(`placeholder matches`);
        weightedScore += placeholderResult.similarity * this.config.textWeight;
        totalWeight += this.config.textWeight;
      }
    }
    if (criteria.title && searchable.title) {
      const titleResult = fuzzyMatch(searchable.title, criteria.title, fuzzyConfig);
      if (titleResult.isMatch) {
        matchReasons.push(`title matches`);
        weightedScore += titleResult.similarity * this.config.textWeight;
        totalWeight += this.config.textWeight;
      }
    }
    if (criteria.idPattern) {
      const idMatch = this.matchPattern(searchable.id, criteria.idPattern);
      if (idMatch) {
        matchReasons.push(`id matches pattern`);
        weightedScore += 1 * this.config.textWeight;
        totalWeight += this.config.textWeight;
      }
    }
    if (criteria.within) {
      const containmentScore = this.scoreContainmentMatch(searchable, criteria.within);
      if (containmentScore.score === 0) {
        const aiElement2 = this.toAIDiscoveredElement(searchable);
        return { element: aiElement2, confidence: 0, matchReasons: [], scores: {} };
      }
      matchReasons.push(...containmentScore.reasons);
      weightedScore += 0.1;
      totalWeight += 0.1;
    }
    const aliasScore = this.scoreAliasMatch(searchable, criteria, fuzzyConfig.threshold);
    if (aliasScore.score > 0) {
      scores.fuzzy = aliasScore.score;
      matchReasons.push(...aliasScore.reasons);
      weightedScore += aliasScore.score * this.config.aliasWeight;
      totalWeight += this.config.aliasWeight;
    }
    const confidence = totalWeight > 0 ? weightedScore / totalWeight : 0;
    const aiElement = this.toAIDiscoveredElement(searchable);
    return {
      element: aiElement,
      confidence,
      matchReasons,
      scores
    };
  }
  /**
   * Score text match.
   *
   * Probes multiple element-side signals so that form inputs with no visible
   * text content can still be located by their identifying attributes.
   * Each source has a weight that establishes precedence:
   *   label (1.00) > aria-label (0.95) > placeholder (0.90) > text (1.00) > name (0.80)
   * The final per-element score is `bestSimilarity * sourceWeight` taken across
   * all sources — i.e., best-matching signal wins, with weaker sources slightly
   * down-ranked so a weak `name` match cannot beat a strong placeholder match.
   */
  scoreTextMatch(searchable, text, fuzzy, threshold) {
    const reasons = [];
    let maxScore = 0;
    const sources = [
      { value: searchable.labelText, label: "label", weight: 1 },
      { value: searchable.ariaLabel, label: "aria-label", weight: 0.95 },
      { value: searchable.placeholder, label: "placeholder", weight: 0.9 },
      { value: searchable.textContent, label: "text", weight: 1 },
      { value: searchable.value, label: "value", weight: 1 },
      { value: searchable.name, label: "name", weight: 0.8 }
    ];
    for (const { value: targetText, label: sourceLabel, weight } of sources) {
      if (!targetText) continue;
      if (targetText.toLowerCase() === text.toLowerCase()) {
        const score = 1 * weight;
        if (score > maxScore) {
          maxScore = score;
          reasons.push(`exact ${sourceLabel} match`);
        }
        continue;
      }
      if (fuzzy) {
        const result = fuzzyMatch(targetText, text, { threshold });
        if (result.isMatch) {
          const score = result.similarity * weight;
          if (score > maxScore) {
            maxScore = score;
            reasons.push(`${sourceLabel} similarity: ${(result.similarity * 100).toFixed(0)}%`);
          }
        }
        const wordSim = wordSimilarity(targetText, text, { threshold });
        if (wordSim >= threshold) {
          const score = wordSim * weight;
          if (score > maxScore) {
            maxScore = score;
            reasons.push(`${sourceLabel} word match: ${(wordSim * 100).toFixed(0)}%`);
          }
        }
        const tokenAnalysis = analyzeTokenAlignment(text, targetText);
        if (tokenAnalysis.kind !== "none") {
          const baseScore = tokenAnalysis.kind === "prefix-aligned" ? 0.95 : tokenAnalysis.kind === "all-tokens-present" ? 0.85 : 0.7;
          const score = baseScore * weight;
          if (score > maxScore) {
            maxScore = score;
            reasons.push(
              `${sourceLabel} ${tokenAnalysis.kind === "prefix-aligned" ? "prefix-aligns" : tokenAnalysis.kind === "all-tokens-present" ? "contains all tokens of" : "partially contains"} "${text}"`
            );
          }
        } else if (targetText.toLowerCase().includes(text.toLowerCase())) {
          const score = 0.85 * weight;
          if (score > maxScore) {
            maxScore = score;
            reasons.push(`${sourceLabel} contains "${text}"`);
          }
        }
      }
    }
    return { score: maxScore, reasons };
  }
  /**
   * Score contains match
   */
  scoreContainsMatch(searchable, text, fuzzy) {
    const reasons = [];
    let maxScore = 0;
    const textsToMatch = [
      searchable.textContent,
      searchable.labelText,
      searchable.ariaLabel
    ].filter(Boolean);
    for (const targetText of textsToMatch) {
      if (targetText.toLowerCase().includes(text.toLowerCase())) {
        maxScore = Math.max(maxScore, 0.9);
        reasons.push("text contains match");
        continue;
      }
      if (fuzzy && fuzzyContains(targetText, text)) {
        maxScore = Math.max(maxScore, 0.7);
        reasons.push("fuzzy contains match");
      }
    }
    return { score: maxScore, reasons };
  }
  /**
   * Score accessibility match
   */
  scoreAccessibilityMatch(searchable, name, fuzzy, threshold) {
    const reasons = [];
    let maxScore = 0;
    const accessibleNames = [
      searchable.ariaLabel,
      searchable.ariaLabelledBy,
      searchable.labelText,
      searchable.title
    ].filter(Boolean);
    for (const accessibleName of accessibleNames) {
      if (accessibleName.toLowerCase() === name.toLowerCase()) {
        maxScore = Math.max(maxScore, 1);
        reasons.push("exact accessible name match");
        continue;
      }
      if (fuzzy) {
        const result = fuzzyMatch(accessibleName, name, { threshold });
        if (result.isMatch && result.similarity > maxScore) {
          maxScore = result.similarity;
          reasons.push(`accessible name similarity: ${(result.similarity * 100).toFixed(0)}%`);
        }
      }
    }
    return { score: maxScore, reasons };
  }
  /**
   * Score role match
   */
  scoreRoleMatch(searchable, role) {
    const reasons = [];
    const normalizedRole = role.toLowerCase();
    if (searchable.role?.toLowerCase() === normalizedRole) {
      return { score: 1, reasons: [`role: ${role}`] };
    }
    const tagRoleMap = {
      button: ["button", "input[type=button]", "input[type=submit]"],
      textbox: ["input", "textarea"],
      checkbox: ["input[type=checkbox]"],
      radio: ["input[type=radio]"],
      link: ["a"],
      listbox: ["select"],
      combobox: ["select", "input[list]"],
      navigation: ["nav"],
      main: ["main"],
      heading: ["h1", "h2", "h3", "h4", "h5", "h6"]
    };
    const inferredRoles = tagRoleMap[normalizedRole] || [];
    if (inferredRoles.some(
      (r) => searchable.tagName === r || searchable.type.toLowerCase() === normalizedRole
    )) {
      return { score: 0.8, reasons: [`inferred role: ${role}`] };
    }
    return { score: 0, reasons };
  }
  /**
   * Score spatial match (proximity to another element)
   */
  scoreSpatialMatch(searchable, nearId) {
    const reference = this.cachedElements.find((el) => el.id === nearId);
    if (!reference) {
      return { score: 0, reasons: [] };
    }
    const distance = this.calculateDistance(searchable.rect, reference.rect);
    const nearThreshold = 200;
    if (distance > nearThreshold * 3) {
      return { score: 0, reasons: [] };
    }
    const score = Math.max(0, 1 - distance / (nearThreshold * 3));
    return {
      score,
      reasons: [`${distance.toFixed(0)}px from ${nearId}`]
    };
  }
  /**
   * Calculate distance between two element rectangles
   */
  calculateDistance(rect1, rect2) {
    const center1 = {
      x: rect1.x + rect1.width / 2,
      y: rect1.y + rect1.height / 2
    };
    const center2 = {
      x: rect2.x + rect2.width / 2,
      y: rect2.y + rect2.height / 2
    };
    return Math.sqrt(Math.pow(center1.x - center2.x, 2) + Math.pow(center1.y - center2.y, 2));
  }
  /**
   * Score alias match
   */
  scoreAliasMatch(searchable, criteria, threshold) {
    const reasons = [];
    let maxScore = 0;
    const searchTerms = [];
    if (criteria.text) searchTerms.push(criteria.text);
    if (criteria.textContains) searchTerms.push(criteria.textContains);
    if (criteria.accessibleName) searchTerms.push(criteria.accessibleName);
    for (const searchTerm of searchTerms) {
      const termLower = searchTerm.toLowerCase();
      for (const alias of searchable.aliases) {
        if (alias === termLower) {
          maxScore = Math.max(maxScore, 1);
          reasons.push(`alias match: "${alias}"`);
          continue;
        }
        const searchWords = termLower.split(/\s+/);
        const aliasWords = alias.split(/\s+/);
        for (const searchWord of searchWords) {
          for (const aliasWord of aliasWords) {
            if (areSynonyms(searchWord, aliasWord)) {
              maxScore = Math.max(maxScore, 0.85);
              reasons.push(`synonym match: "${searchWord}" ~ "${aliasWord}"`);
            }
          }
        }
        const result = fuzzyMatch(alias, termLower, { threshold });
        if (result.isMatch && result.similarity > maxScore) {
          maxScore = result.similarity;
          reasons.push(`fuzzy alias: "${alias}" (${(result.similarity * 100).toFixed(0)}%)`);
        }
        const tokenSim = tokenSimilarity(alias, termLower);
        if (tokenSim > maxScore && tokenSim >= threshold) {
          maxScore = tokenSim;
          reasons.push(`token match: "${alias}"`);
        }
      }
    }
    return { score: maxScore, reasons };
  }
  /**
   * Score containment match (is this element inside the specified container?)
   */
  scoreContainmentMatch(searchable, containerId) {
    if (searchable.parentContext) {
      const ctx = searchable.parentContext.toLowerCase();
      if (ctx.includes(containerId.toLowerCase()) || containerId.toLowerCase().includes(ctx)) {
        return { score: 1, reasons: [`inside ${searchable.parentContext}`] };
      }
    }
    const container = this.cachedElements.find((el) => el.id === containerId);
    if (container) {
      try {
        if ("getState" in searchable.element && "getState" in container.element) {
          const containerEl = container.element.element;
          const targetEl = searchable.element.element;
          if (containerEl && targetEl && containerEl.contains(targetEl)) {
            return { score: 1, reasons: [`DOM child of ${containerId}`] };
          }
        }
      } catch {
      }
      const cRect = container.rect;
      const eRect = searchable.rect;
      if (eRect.x >= cRect.x - 5 && eRect.y >= cRect.y - 5 && eRect.x + eRect.width <= cRect.x + cRect.width + 5 && eRect.y + eRect.height <= cRect.y + cRect.height + 5) {
        return { score: 0.8, reasons: [`spatially within ${containerId}`] };
      }
    }
    const containerLower = containerId.toLowerCase();
    if (searchable.parentContext) {
      const contextLower = searchable.parentContext.toLowerCase();
      for (const part of containerLower.split(/[\s-_]+/)) {
        if (part.length > 2 && contextLower.includes(part)) {
          return { score: 0.6, reasons: [`parent context partially matches ${containerId}`] };
        }
      }
    }
    return { score: 0, reasons: [] };
  }
  /**
   * Resolve the nearest semantic container for an element.
   * Walks up the DOM tree looking for forms, dialogs, nav, sections, etc.
   */
  resolveParentContext(element) {
    try {
      let el = null;
      if ("getState" in element && typeof element.getState === "function") {
        el = element.element;
      }
      if (!el) return void 0;
      let ancestor = el.parentElement;
      while (ancestor) {
        const role = ancestor.getAttribute("role");
        const tag = ancestor.tagName.toLowerCase();
        const isContainer = role === "dialog" || role === "alertdialog" || role === "form" || role === "navigation" || role === "region" || role === "group" || role === "tabpanel" || role === "toolbar" || role === "complementary" || tag === "form" || tag === "nav" || tag === "section" || tag === "aside" || tag === "dialog" || tag === "details" || tag === "fieldset" || tag === "main" || tag === "header" || tag === "footer";
        if (isContainer) {
          const label = ancestor.getAttribute("aria-label") || ancestor.getAttribute("data-testid") || ancestor.id || "";
          return label ? `${role || tag}[${label}]` : role || tag;
        }
        ancestor = ancestor.parentElement;
      }
    } catch {
    }
    return void 0;
  }
  /**
   * Infer aliases from icon CSS classes for icon-only elements.
   */
  inferIconAliases(element) {
    try {
      let el = null;
      if ("getState" in element && typeof element.getState === "function") {
        el = element.element;
      }
      if (!el) return [];
      const classSource = [Array.from(el.classList).join(" ")];
      const iconChild = el.querySelector('svg, [class*="icon"], i[class]');
      if (iconChild) {
        classSource.push(Array.from(iconChild.classList).join(" "));
      }
      const allClasses = classSource.join(" ").toLowerCase();
      if (!allClasses) return [];
      const foundAliases = [];
      for (const [meaning, patterns] of Object.entries(_SearchEngine.ICON_CLASS_MAP)) {
        if (patterns.some((p) => allClasses.includes(p))) {
          foundAliases.push(meaning);
        }
      }
      return foundAliases;
    } catch {
      return [];
    }
  }
  /**
   * Match a string against a pattern (supports * wildcard)
   */
  matchPattern(str, pattern) {
    const regexPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*");
    return new RegExp(`^${regexPattern}$`, "i").test(str);
  }
  /**
   * Convert searchable element to AI discovered element
   */
  toAIDiscoveredElement(searchable) {
    const discoveredBase = "getState" in searchable.element ? {
      id: searchable.id,
      type: searchable.type,
      label: searchable.element.label,
      tagName: searchable.tagName,
      role: searchable.role,
      accessibleName: searchable.ariaLabel,
      actions: searchable.element.actions,
      state: searchable.state,
      registered: true
    } : searchable.element;
    return {
      ...discoveredBase,
      description: searchable.description,
      aliases: searchable.aliases,
      purpose: generatePurpose({
        textContent: searchable.textContent,
        ariaLabel: searchable.ariaLabel,
        elementType: searchable.type,
        tagName: searchable.tagName
      }),
      parentContext: searchable.parentContext,
      suggestedActions: generateSuggestedActions({
        textContent: searchable.textContent,
        ariaLabel: searchable.ariaLabel,
        elementType: searchable.type,
        tagName: searchable.tagName
      }),
      semanticType: this.inferSemanticType(searchable),
      labelText: searchable.labelText,
      placeholder: searchable.placeholder,
      title: searchable.title
    };
  }
  /**
   * Infer a semantic type for the element
   */
  inferSemanticType(searchable) {
    const text = (searchable.textContent || searchable.ariaLabel || "").toLowerCase();
    const type = searchable.type.toLowerCase();
    if (type === "input" || type === "textarea") {
      if (searchable.placeholder?.toLowerCase().includes("email") || text.includes("email")) {
        return "email-input";
      }
      if (searchable.placeholder?.toLowerCase().includes("password") || text.includes("password")) {
        return "password-input";
      }
      if (searchable.placeholder?.toLowerCase().includes("search") || text.includes("search")) {
        return "search-input";
      }
      return "text-input";
    }
    if (type === "button") {
      if (text.match(/submit|save|confirm|ok|done|apply/)) return "submit-button";
      if (text.match(/cancel|close|dismiss/)) return "cancel-button";
      if (text.match(/delete|remove|trash/)) return "delete-button";
      if (text.match(/add|create|new|\+/)) return "add-button";
      if (text.match(/edit|modify/)) return "edit-button";
      if (text.match(/next|continue/)) return "next-button";
      if (text.match(/back|previous/)) return "back-button";
      return "action-button";
    }
    if (type === "link") {
      if (text.match(/home|dashboard/)) return "home-link";
      if (text.match(/login|sign.?in/)) return "login-link";
      if (text.match(/logout|sign.?out/)) return "logout-link";
      return "navigation-link";
    }
    return type;
  }
};
/**
 * Known icon class patterns → semantic meaning
 */
_SearchEngine.ICON_CLASS_MAP = {
  close: [
    "close",
    "x-mark",
    "times",
    "dismiss",
    "lucide-x",
    "fa-times",
    "mdi-close",
    "ri-close-line",
    "icon-x"
  ],
  delete: [
    "trash",
    "delete",
    "remove",
    "lucide-trash",
    "fa-trash",
    "mdi-delete",
    "ri-delete-bin"
  ],
  edit: ["edit", "pencil", "pen", "lucide-pencil", "fa-edit", "mdi-pencil", "ri-edit"],
  search: ["search", "magnify", "lucide-search", "fa-search", "mdi-magnify", "ri-search"],
  menu: ["menu", "hamburger", "bars", "lucide-menu", "fa-bars", "mdi-menu", "ri-menu"],
  more: ["more", "dots", "ellipsis", "lucide-more", "fa-ellipsis", "mdi-dots", "ri-more"],
  add: ["plus", "add", "lucide-plus", "fa-plus", "mdi-plus", "ri-add"],
  back: [
    "arrow-left",
    "chevron-left",
    "back",
    "lucide-arrow-left",
    "fa-arrow-left",
    "ri-arrow-left"
  ],
  forward: ["arrow-right", "chevron-right", "forward", "lucide-arrow-right", "ri-arrow-right"],
  expand: ["chevron-down", "expand", "caret-down", "lucide-chevron-down", "fa-caret-down"],
  collapse: ["chevron-up", "collapse", "caret-up", "lucide-chevron-up", "fa-caret-up"],
  settings: ["gear", "cog", "settings", "lucide-settings", "fa-cog", "mdi-cog", "ri-settings"],
  info: ["info", "circle-info", "lucide-info", "fa-info-circle", "ri-information"],
  warning: [
    "warning",
    "alert-triangle",
    "exclamation",
    "lucide-alert-triangle",
    "fa-exclamation-triangle"
  ],
  copy: ["copy", "clipboard", "lucide-copy", "fa-copy", "mdi-content-copy", "ri-file-copy"],
  download: ["download", "lucide-download", "fa-download", "mdi-download", "ri-download"],
  upload: ["upload", "lucide-upload", "fa-upload", "mdi-upload", "ri-upload"],
  refresh: ["refresh", "reload", "rotate", "lucide-refresh-cw", "fa-sync", "mdi-refresh"],
  save: ["save", "floppy", "lucide-save", "fa-save", "mdi-content-save"],
  home: ["home", "house", "lucide-home", "fa-home", "mdi-home", "ri-home"],
  user: ["user", "person", "avatar", "lucide-user", "fa-user", "mdi-account", "ri-user"],
  lock: ["lock", "lucide-lock", "fa-lock", "mdi-lock", "ri-lock"],
  unlock: ["unlock", "lucide-unlock", "fa-unlock", "mdi-lock-open"],
  star: ["star", "favorite", "lucide-star", "fa-star", "mdi-star", "ri-star"],
  heart: ["heart", "like", "lucide-heart", "fa-heart", "mdi-heart"],
  filter: ["filter", "funnel", "lucide-filter", "fa-filter", "mdi-filter", "ri-filter"],
  sort: ["sort", "lucide-arrow-up-down", "fa-sort", "mdi-sort"],
  share: ["share", "lucide-share", "fa-share", "mdi-share", "ri-share"],
  play: ["play", "lucide-play", "fa-play", "mdi-play", "ri-play"],
  pause: ["pause", "lucide-pause", "fa-pause", "mdi-pause", "ri-pause"],
  stop: ["stop", "square", "lucide-square", "fa-stop", "mdi-stop"]
};
var SearchEngine = _SearchEngine;
function createSearchEngine(config) {
  return new SearchEngine(config);
}

// src/ai/summary-generator.ts
var DEFAULT_SUMMARY_CONFIG = {
  maxLength: 2e3,
  includeForms: true,
  includeElementCounts: true,
  includeModals: true,
  includeFocused: true,
  verbosity: "normal"
};
function generatePageSummary(elements, pageContext, config = {}) {
  const finalConfig = { ...DEFAULT_SUMMARY_CONFIG, ...config };
  const lines = [];
  if (pageContext) {
    if (pageContext.title) {
      lines.push(`Page: "${pageContext.title}"`);
    }
    if (pageContext.pageType && pageContext.pageType !== "unknown") {
      lines.push(`Type: ${formatPageType(pageContext.pageType)}`);
    }
  }
  if (finalConfig.includeElementCounts) {
    const counts = countElementTypes(elements);
    const countParts = [];
    if (counts.button > 0)
      countParts.push(`${counts.button} button${counts.button > 1 ? "s" : ""}`);
    if (counts.input > 0) countParts.push(`${counts.input} input${counts.input > 1 ? "s" : ""}`);
    if (counts.link > 0) countParts.push(`${counts.link} link${counts.link > 1 ? "s" : ""}`);
    if (counts.select > 0)
      countParts.push(`${counts.select} dropdown${counts.select > 1 ? "s" : ""}`);
    if (counts.checkbox > 0)
      countParts.push(`${counts.checkbox} checkbox${counts.checkbox > 1 ? "es" : ""}`);
    if (countParts.length > 0) {
      lines.push(`Contains: ${countParts.join(", ")}`);
    }
  }
  if (finalConfig.includeForms) {
    const forms = detectForms(elements);
    if (forms.length > 0) {
      lines.push("");
      lines.push("Forms:");
      for (const form of forms) {
        lines.push(generateFormSummary(form, finalConfig.verbosity));
      }
    }
  }
  if (finalConfig.includeModals && pageContext?.activeModals && pageContext.activeModals.length > 0) {
    lines.push("");
    lines.push(`Active modals: ${pageContext.activeModals.join(", ")}`);
  }
  if (finalConfig.includeFocused && pageContext?.focusedElement) {
    lines.push(`Focus: ${pageContext.focusedElement}`);
  }
  const keyElements = getKeyElements(elements);
  if (keyElements.length > 0) {
    lines.push("");
    lines.push("Key elements:");
    for (const el of keyElements) {
      lines.push(`  - ${el.description}${el.state.enabled ? "" : " (disabled)"}`);
    }
  }
  let summary = lines.join("\n");
  if (summary.length > finalConfig.maxLength) {
    summary = summary.substring(0, finalConfig.maxLength - 3) + "...";
  }
  return summary;
}
function generateElementDescription(element) {
  const parts = [];
  const name = element.accessibleName || element.label || element.state.textContent?.trim();
  if (name) {
    parts.push(`"${truncate(name, 30)}"`);
  }
  parts.push(formatElementType(element.type));
  const stateIndicators = [];
  if (!element.state.visible) stateIndicators.push("hidden");
  if (!element.state.enabled) stateIndicators.push("disabled");
  if (element.state.focused) stateIndicators.push("focused");
  if (element.state.checked) stateIndicators.push("checked");
  if (stateIndicators.length > 0) {
    parts.push(`(${stateIndicators.join(", ")})`);
  }
  if (element.state.value && element.type !== "button") {
    const valuePreview = truncate(element.state.value, 20);
    parts.push(`value: "${valuePreview}"`);
  }
  return parts.join(" ");
}
function generateFormSummary(form, verbosity) {
  const lines = [];
  const formName = form.name || form.purpose || form.id;
  lines.push(`  ${formName}:`);
  if (verbosity === "brief") {
    const fieldCount = form.fields.length;
    const filledCount = form.fields.filter((f) => f.value).length;
    lines.push(
      `    ${filledCount}/${fieldCount} fields filled, ${form.isValid ? "valid" : "has errors"}`
    );
  } else {
    for (const field of form.fields) {
      let fieldLine = `    - ${field.label || field.id}`;
      if (field.value) {
        fieldLine += ` = "${truncate(field.value, 15)}"`;
      } else if (field.placeholder) {
        fieldLine += ` (${field.placeholder})`;
      } else {
        fieldLine += " (empty)";
      }
      if (!field.valid && field.error) {
        fieldLine += ` [ERROR: ${field.error}]`;
      } else if (field.required && !field.value) {
        fieldLine += " [required]";
      }
      lines.push(fieldLine);
    }
    if (form.submitButton) {
      lines.push(`    Submit: ${form.submitButton}`);
    }
  }
  return lines.join("\n");
}
function generateSnapshotSummary(snapshot, config = {}) {
  const finalConfig = { ...DEFAULT_SUMMARY_CONFIG, ...config };
  const lines = [];
  lines.push(`Page: "${snapshot.page.title}"`);
  lines.push(`URL: ${snapshot.page.url}`);
  if (snapshot.page.pageType) {
    lines.push(`Type: ${formatPageType(snapshot.page.pageType)}`);
  }
  if (finalConfig.includeElementCounts) {
    const countParts = [];
    for (const [type, count] of Object.entries(snapshot.elementCounts)) {
      if (count > 0) {
        countParts.push(`${count} ${type}${count > 1 ? "s" : ""}`);
      }
    }
    if (countParts.length > 0) {
      lines.push(`Elements: ${countParts.join(", ")}`);
    }
  }
  if (finalConfig.includeForms && snapshot.forms.length > 0) {
    lines.push("");
    lines.push("Forms:");
    for (const form of snapshot.forms) {
      lines.push(generateFormStateSummary(form));
    }
  }
  if (finalConfig.includeModals && snapshot.activeModals.length > 0) {
    lines.push("");
    lines.push("Active dialogs:");
    for (const modal of snapshot.activeModals) {
      lines.push(`  - ${modal.title || modal.id} (${modal.type})`);
    }
  }
  if (finalConfig.includeFocused && snapshot.focusedElement) {
    const focused = snapshot.elements.find((e) => e.id === snapshot.focusedElement);
    if (focused) {
      lines.push(`Focused: ${generateElementDescription(focused)}`);
    }
  }
  return lines.join("\n");
}
function generateFormStateSummary(form) {
  const lines = [];
  const formName = form.name || form.purpose || form.id;
  const filledCount = form.fields.filter((f) => f.value).length;
  const errorCount = form.fields.filter((f) => !f.valid).length;
  let statusLine = `  ${formName}: ${filledCount}/${form.fields.length} filled`;
  if (errorCount > 0) {
    statusLine += `, ${errorCount} error${errorCount > 1 ? "s" : ""}`;
  }
  if (form.isDirty) {
    statusLine += " (modified)";
  }
  lines.push(statusLine);
  for (const field of form.fields) {
    if (!field.valid && field.error) {
      lines.push(`    ERROR: ${field.label}: ${field.error}`);
    }
  }
  return lines.join("\n");
}
function generateDiffSummary(appeared, disappeared, modified) {
  const lines = [];
  if (appeared.length > 0) {
    lines.push(`Appeared: ${appeared.join(", ")}`);
  }
  if (disappeared.length > 0) {
    lines.push(`Disappeared: ${disappeared.join(", ")}`);
  }
  if (modified.length > 0) {
    lines.push("Changed:");
    for (const mod of modified.slice(0, 5)) {
      lines.push(
        `  - ${mod.description}: ${mod.property} changed from "${mod.from}" to "${mod.to}"`
      );
    }
    if (modified.length > 5) {
      lines.push(`  ... and ${modified.length - 5} more changes`);
    }
  }
  if (lines.length === 0) {
    return "No changes detected";
  }
  return lines.join("\n");
}
function countElementTypes(elements) {
  const counts = {};
  for (const el of elements) {
    const type = el.type.toLowerCase();
    counts[type] = (counts[type] || 0) + 1;
  }
  return counts;
}
function detectForms(elements) {
  const formElements = elements.filter(
    (el) => el.type === "input" || el.type === "textarea" || el.type === "select" || el.type === "checkbox"
  );
  if (formElements.length === 0) return [];
  const forms = [];
  const submitButtons = elements.filter(
    (el) => el.type === "button" && (el.state.textContent?.toLowerCase().includes("submit") || el.state.textContent?.toLowerCase().includes("save") || el.state.textContent?.toLowerCase().includes("send") || el.semanticType === "submit-button")
  );
  const defaultForm = {
    id: "detected-form",
    purpose: inferFormPurpose(formElements),
    fields: formElements.map((el) => ({
      id: el.id,
      label: el.labelText || el.accessibleName || el.placeholder || el.id,
      type: el.type,
      value: el.state.value || "",
      valid: true,
      // Can't determine without validation state
      required: false,
      // Can't determine without DOM access
      placeholder: el.placeholder
    })),
    isValid: true,
    submitButton: submitButtons[0]?.id
  };
  if (defaultForm.fields.length > 0) {
    forms.push(defaultForm);
  }
  return forms;
}
function inferFormPurpose(fields) {
  const labels = fields.map(
    (f) => (f.labelText || f.accessibleName || f.placeholder || "").toLowerCase()
  );
  const allLabels = labels.join(" ");
  if (allLabels.includes("email") && allLabels.includes("password")) {
    if (allLabels.includes("confirm") || allLabels.includes("name")) {
      return "Registration form";
    }
    return "Login form";
  }
  if (allLabels.includes("search")) {
    return "Search form";
  }
  if (allLabels.includes("address") || allLabels.includes("city") || allLabels.includes("zip")) {
    return "Address form";
  }
  if (allLabels.includes("card") || allLabels.includes("cvv") || allLabels.includes("expir")) {
    return "Payment form";
  }
  if (allLabels.includes("contact") || allLabels.includes("message")) {
    return "Contact form";
  }
  return "Form";
}
function getKeyElements(elements) {
  const keyElements = [];
  const actionButtons = elements.filter(
    (el) => el.type === "button" && el.state.visible && (el.semanticType?.includes("submit") || el.semanticType?.includes("action") || el.semanticType?.includes("next"))
  );
  keyElements.push(...actionButtons.slice(0, 2));
  const primaryInputs = elements.filter(
    (el) => (el.type === "input" || el.type === "textarea") && el.state.visible
  );
  keyElements.push(...primaryInputs.slice(0, 3));
  const links = elements.filter((el) => el.type === "link" && el.state.visible);
  keyElements.push(...links.slice(0, 2));
  const unique = [...new Map(keyElements.map((e) => [e.id, e])).values()];
  return unique.slice(0, 8);
}
function formatPageType(pageType) {
  const typeLabels = {
    login: "Login page",
    dashboard: "Dashboard",
    form: "Form page",
    list: "List/table page",
    detail: "Detail page",
    search: "Search page",
    checkout: "Checkout page",
    settings: "Settings page",
    unknown: "Unknown"
  };
  return typeLabels[pageType || "unknown"] || "Page";
}
function formatElementType(type) {
  const typeLabels = {
    button: "button",
    input: "input field",
    textarea: "text area",
    select: "dropdown",
    checkbox: "checkbox",
    radio: "radio button",
    link: "link",
    form: "form",
    menu: "menu",
    menuitem: "menu item",
    tab: "tab",
    dialog: "dialog",
    switch: "switch",
    slider: "slider"
  };
  return typeLabels[type.toLowerCase()] || type;
}
function truncate(str, maxLength) {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + "...";
}
function inferPageType(url, title, elements) {
  const urlLower = url.toLowerCase();
  const titleLower = title.toLowerCase();
  if (urlLower.includes("login") || urlLower.includes("signin")) return "login";
  if (urlLower.includes("dashboard")) return "dashboard";
  if (urlLower.includes("search")) return "search";
  if (urlLower.includes("checkout") || urlLower.includes("payment")) return "checkout";
  if (urlLower.includes("settings") || urlLower.includes("preferences")) return "settings";
  if (titleLower.includes("login") || titleLower.includes("sign in")) return "login";
  if (titleLower.includes("dashboard")) return "dashboard";
  if (titleLower.includes("search")) return "search";
  const hasLoginForm = elements.some((el) => el.type === "input" && el.semanticType === "email-input") && elements.some((el) => el.type === "input" && el.semanticType === "password-input");
  if (hasLoginForm) return "login";
  const hasSearchInput = elements.some(
    (el) => el.type === "input" && el.semanticType === "search-input"
  );
  if (hasSearchInput) return "search";
  const inputCount = elements.filter(
    (el) => el.type === "input" || el.type === "textarea" || el.type === "select"
  ).length;
  if (inputCount >= 3) return "form";
  const hasTable = elements.some((el) => el.tagName === "table");
  const hasMany = elements.length > 20;
  if (hasTable || hasMany) return "list";
  return "unknown";
}

// src/ai/validation-scanner.ts
var ERROR_CONTAINER_SELECTORS = [
  ".error",
  ".field-error",
  ".form-error",
  ".invalid-feedback",
  ".help-block.error",
  ".error-message",
  ".validation-error",
  ".form-text.text-danger",
  '[role="alert"]',
  // Material UI
  ".MuiFormHelperText-root.Mui-error",
  // Ant Design
  ".ant-form-item-explain-error",
  // Chakra UI
  ".chakra-form__error-message",
  // Tailwind UI common patterns
  ".text-red-500",
  ".text-red-600",
  ".text-destructive"
];
var INPUT_ERROR_CLASSES = [
  "is-invalid",
  "has-error",
  "error",
  "invalid",
  "field-error",
  "border-red-500",
  "border-destructive",
  "Mui-error",
  "ant-input-status-error"
];
function scanValidationErrors(elements) {
  const errors = [];
  const seen = /* @__PURE__ */ new Set();
  for (const { id, element } of elements) {
    if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement) && !(element instanceof HTMLSelectElement)) {
      continue;
    }
    const result = detectFieldError(id, element);
    if (result && !seen.has(id)) {
      errors.push(result);
      seen.add(id);
    }
  }
  return errors;
}
function detectFieldError(fieldId, element) {
  if ("validity" in element && !element.validity.valid) {
    return {
      fieldId,
      message: element.validationMessage || "Invalid value",
      confidence: 1,
      source: "html5"
    };
  }
  if (element.getAttribute("aria-invalid") === "true") {
    const errorMessage = getAriaErrorMessage(element);
    return {
      fieldId,
      message: errorMessage || "",
      confidence: 0.95,
      source: "aria"
    };
  }
  const adjacentError = findAdjacentError(element);
  if (adjacentError) {
    return {
      fieldId,
      message: adjacentError,
      confidence: 0.8,
      source: "adjacent-element"
    };
  }
  if (hasErrorClass(element)) {
    return {
      fieldId,
      message: "",
      confidence: 0.6,
      source: "css-class"
    };
  }
  return null;
}
function getAriaErrorMessage(element) {
  const errorMsgId = element.getAttribute("aria-errormessage");
  if (errorMsgId) {
    const errorEl = document.getElementById(errorMsgId);
    if (errorEl?.textContent?.trim()) {
      return errorEl.textContent.trim();
    }
  }
  const describedById = element.getAttribute("aria-describedby");
  if (describedById) {
    const ids = describedById.split(/\s+/);
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el?.textContent?.trim()) {
        const text = el.textContent.trim();
        if (el.getAttribute("role") === "alert" || hasErrorClass(el) || text.length < 200) {
          return text;
        }
      }
    }
  }
  return null;
}
function findAdjacentError(element) {
  const container = element.closest(
    '.form-group, .form-field, .field, .form-item, [class*="field"], [class*="form-group"], [class*="FormControl"], .MuiFormControl-root, .ant-form-item, .chakra-form-control'
  ) || element.parentElement;
  if (!container) return null;
  for (const selector of ERROR_CONTAINER_SELECTORS) {
    try {
      const errorEl = container.querySelector(selector);
      if (errorEl && errorEl !== element) {
        const text = errorEl.textContent?.trim();
        if (text) return text;
      }
    } catch {
    }
  }
  const next = element.nextElementSibling;
  if (next && hasErrorClass(next)) {
    const text = next.textContent?.trim();
    if (text) return text;
  }
  return null;
}
function hasErrorClass(element) {
  for (const cls of INPUT_ERROR_CLASSES) {
    if (element.classList.contains(cls)) return true;
  }
  if (element.getAttribute("data-invalid") === "true" || element.getAttribute("data-error") !== null) {
    return true;
  }
  return false;
}

// src/ai/form-discovery.ts
function discoverForms(elements) {
  const validationErrors = scanValidationErrors(
    elements.map((el) => ({ id: el.id, element: el.element }))
  );
  const errorsByField = new Map(validationErrors.map((e) => [e.fieldId, e]));
  const formElements = elements.filter((el) => el.type === "form");
  const inputTypes = /* @__PURE__ */ new Set([
    "input",
    "textarea",
    "select",
    "checkbox",
    "radio",
    "textbox",
    "combobox",
    "switch",
    "slider",
    "listbox"
  ]);
  const allInputs = elements.filter((el) => inputTypes.has(el.type));
  const forms = [];
  if (formElements.length > 0) {
    for (const formEl of formElements) {
      const formDom = formEl.element;
      const formInputs = allInputs.filter((input) => formDom.contains(input.element));
      const fields = buildFormFields(formInputs, errorsByField);
      const submitButton = elements.find(
        (el) => el.type === "button" && formDom.contains(el.element) && (el.element.getAttribute("type") === "submit" || el.element.textContent?.toLowerCase().match(/submit|save|send|continue|sign in|log in/))
      );
      forms.push({
        id: formEl.id,
        name: formEl.label || formDom.getAttribute("name") || void 0,
        purpose: inferFormPurpose2(formInputs),
        fields,
        isValid: fields.every((f) => f.valid),
        submitButton: submitButton?.id,
        isDirty: fields.some((f) => f.isDirty)
      });
    }
  }
  const inputsInForms = new Set(
    formElements.flatMap(
      (f) => allInputs.filter((i) => f.element.contains(i.element)).map((i) => i.id)
    )
  );
  const orphanInputs = allInputs.filter((i) => !inputsInForms.has(i.id));
  if (orphanInputs.length > 0) {
    const fields = buildFormFields(orphanInputs, errorsByField);
    const submitButton = elements.find(
      (el) => el.type === "button" && !formElements.some((f) => f.element.contains(el.element)) && el.element.textContent?.toLowerCase().match(/submit|save|send|continue|sign in|log in/)
    );
    forms.push({
      id: "implicit-form",
      purpose: inferFormPurpose2(orphanInputs),
      fields,
      isValid: fields.every((f) => f.valid),
      submitButton: submitButton?.id,
      isDirty: fields.some((f) => f.isDirty)
    });
  }
  const totalFields = forms.reduce((sum, f) => sum + f.fields.length, 0);
  const totalErrors = forms.reduce((sum, f) => sum + f.fields.filter((ff) => !ff.valid).length, 0);
  const filledFields = forms.reduce(
    (sum, f) => sum + f.fields.filter((ff) => ff.value !== "" || ff.checked).length,
    0
  );
  const summaryParts = [`${forms.length} form(s), ${totalFields} field(s)`];
  if (filledFields > 0) summaryParts.push(`${filledFields} filled`);
  if (totalErrors > 0) summaryParts.push(`${totalErrors} error(s)`);
  return {
    forms,
    summary: summaryParts.join(", "),
    timestamp: Date.now()
  };
}
function getLabelText(element) {
  if (typeof document === "undefined") return void 0;
  const id = element.id;
  if (id) {
    const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (label?.textContent?.trim()) return label.textContent.trim();
  }
  const parentLabel = element.closest("label");
  if (parentLabel) {
    const clone = parentLabel.cloneNode(true);
    const inputs = clone.querySelectorAll("input, textarea, select");
    inputs.forEach((inp) => inp.remove());
    const text = clone.textContent?.trim();
    if (text) return text;
  }
  return void 0;
}
function buildFormFields(inputs, errorsByField) {
  return inputs.map((input) => {
    const state = input.getState();
    const el = input.element;
    const detectedError = errorsByField.get(input.id);
    let valid = true;
    let errorMsg;
    let errorSource;
    if (state.validationState && !state.validationState.valid) {
      valid = false;
      errorMsg = state.validationState.validationMessage;
      errorSource = "html5";
    } else if (detectedError) {
      valid = false;
      errorMsg = detectedError.message || void 0;
      errorSource = detectedError.source;
    }
    const defaultValue = el.getAttribute("value") ?? "";
    const isDirty = state.value !== void 0 && state.value !== defaultValue;
    return {
      id: input.id,
      label: el.getAttribute("aria-label") || input.label || getLabelText(el) || el.getAttribute("placeholder") || input.id,
      type: el instanceof HTMLInputElement ? el.type : input.type,
      value: state.value ?? "",
      valid,
      error: errorMsg,
      errorSource,
      required: state.required ?? false,
      touched: state.focused || (state.value?.length ?? 0) > 0,
      placeholder: el.getAttribute("placeholder") || void 0,
      isDirty,
      checked: state.checked,
      selectedOptions: state.selectedOptions,
      constraints: state.constraints
    };
  });
}
function inferFormPurpose2(fields) {
  const labels = fields.map(
    (f) => (f.element.getAttribute("aria-label") || f.label || f.element.getAttribute("name") || "").toLowerCase()
  ).join(" ");
  if (labels.includes("email") && labels.includes("password")) {
    if (labels.includes("confirm") || labels.includes("name") || labels.includes("register")) {
      return "Registration";
    }
    return "Login";
  }
  if (labels.includes("search")) return "Search";
  if (labels.includes("address") || labels.includes("city")) return "Address";
  if (labels.includes("card") || labels.includes("payment")) return "Payment";
  if (labels.includes("contact") || labels.includes("message")) return "Contact";
  return "Form";
}

// src/ai/nl-assertion-parser.ts
function parseNLAssertion(input) {
  if (input.target && input.type) {
    return { target: String(input.target), type: input.type, expected: input.expected };
  }
  const text = input.assertion ?? "";
  if (!text) {
    return {
      target: String(input.target ?? ""),
      type: String(input.type ?? "exists"),
      expected: input.expected
    };
  }
  const lc = text.toLowerCase().trim();
  if (/\b(no |not |isn't |aren't |doesn't |don't )/.test(lc)) {
    if (/\bvisible\b/.test(lc)) {
      const target2 = lc.replace(/.*?(no|not|isn't|aren't)\s+/, "").replace(/\s*(is\s+)?visible.*/, "").replace(/\b(there\s+are|on\s+the\s+page)\b/g, "").trim() || text;
      return { target: target2, type: "hidden" };
    }
    if (/\bdisabled\b/.test(lc)) {
      const target2 = lc.replace(/.*?(no|not|isn't|aren't)\s+/, "").replace(/\s*(is\s+)?disabled.*/, "").trim() || text;
      return { target: target2, type: "enabled" };
    }
    if (/\bchecked\b/.test(lc)) {
      const target2 = lc.replace(/.*?(no|not|isn't|aren't)\s+/, "").replace(/\s*(is\s+)?checked.*/, "").trim() || text;
      return { target: target2, type: "unchecked" };
    }
    if (/\benabled\b/.test(lc)) {
      const target2 = lc.replace(/.*?(no|not|isn't|aren't)\s+/, "").replace(/\s*(is\s+)?enabled.*/, "").trim() || text;
      return { target: target2, type: "disabled" };
    }
    if (/\b(exist|present|on the page)\b/.test(lc)) {
      const target2 = lc.replace(/.*?(no|not|doesn't|don't)\s+/, "").replace(/\s*(exist|present|on the page).*/, "").replace(/\b(there\s+are|there\s+is)\b/g, "").trim() || text;
      return { target: target2, type: "notExists" };
    }
    const target = lc.replace(/.*?(no|not|isn't|aren't)\s+/, "").replace(/\b(on the page|visible|exist)\b/g, "").trim() || text;
    return { target, type: "notExists" };
  }
  const typePatterns = [
    [/\bvisible\b/, "visible"],
    [/\benabled\b/, "enabled"],
    [/\bdisabled\b/, "disabled"],
    [/\bhidden\b/, "hidden"],
    [/\bchecked\b/, "checked"],
    [/\bunchecked\b/, "unchecked"],
    [/\bfocused\b/, "focused"],
    [/\bempty\b/, "hasValue"],
    [/\bexist/, "exists"],
    [/\bpresent\b/, "exists"],
    [/\bon the page\b/, "exists"],
    [/\bhas loaded\b/, "exists"],
    [/\bcontains?\b.*['"](.+?)['"]/, "hasText"]
  ];
  for (const [pattern, type] of typePatterns) {
    if (pattern.test(lc)) {
      let target = lc.replace(/\b(is|are|has|have|should be|must be|exists?|present)\b/g, "").replace(pattern, "").replace(/\b(the|a|an|on|page|this)\b/g, "").trim().replace(/\s+/g, " ").trim();
      if (!target) target = text;
      if (type === "hasText") {
        const match = lc.match(/contains?\s+['"](.+?)['"]/);
        if (match) {
          return {
            target: target.replace(/['"].*?['"]/g, "").trim() || text,
            type,
            expected: match[1]
          };
        }
      }
      if (type === "hasValue" && input.expected === void 0) {
        return { target, type, expected: "" };
      }
      return { target, type };
    }
  }
  return { target: text, type: "exists" };
}

// src/ai/nl-action-parser.ts
var ACTION_PATTERNS = [
  // Click patterns
  {
    regex: /^click\s+(?:on\s+)?(?:the\s+)?(.+?)(?:\s+button)?$/i,
    action: "click",
    targetGroup: 1,
    confidence: 0.95
  },
  {
    regex: /^press\s+(?:the\s+)?(.+?)(?:\s+button)?$/i,
    action: "click",
    targetGroup: 1,
    confidence: 0.9
  },
  {
    regex: /^tap\s+(?:on\s+)?(?:the\s+)?(.+)$/i,
    action: "click",
    targetGroup: 1,
    confidence: 0.85
  },
  {
    regex: /^activate\s+(?:the\s+)?(.+)$/i,
    action: "click",
    targetGroup: 1,
    confidence: 0.8
  },
  // Double click patterns
  {
    regex: /^double[\s-]?click\s+(?:on\s+)?(?:the\s+)?(.+)$/i,
    action: "doubleClick",
    targetGroup: 1,
    confidence: 0.95
  },
  // Right click patterns
  {
    regex: /^right[\s-]?click\s+(?:on\s+)?(?:the\s+)?(.+)$/i,
    action: "rightClick",
    targetGroup: 1,
    confidence: 0.95
  },
  {
    regex: /^context\s+click\s+(?:on\s+)?(?:the\s+)?(.+)$/i,
    action: "rightClick",
    targetGroup: 1,
    confidence: 0.9
  },
  // Type patterns - "type X in Y"
  {
    regex: /^type\s+["'](.+?)["']\s+(?:in(?:to)?|on)\s+(?:the\s+)?(.+)$/i,
    action: "type",
    targetGroup: 2,
    valueGroup: 1,
    confidence: 0.95
  },
  {
    regex: /^type\s+(.+?)\s+(?:in(?:to)?|on)\s+(?:the\s+)?(.+)$/i,
    action: "type",
    targetGroup: 2,
    valueGroup: 1,
    confidence: 0.85
  },
  // Type patterns - "enter X in Y"
  {
    regex: /^enter\s+["'](.+?)["']\s+(?:in(?:to)?|on)\s+(?:the\s+)?(.+)$/i,
    action: "type",
    targetGroup: 2,
    valueGroup: 1,
    confidence: 0.95
  },
  {
    regex: /^enter\s+(.+?)\s+(?:in(?:to)?|on)\s+(?:the\s+)?(.+)$/i,
    action: "type",
    targetGroup: 2,
    valueGroup: 1,
    confidence: 0.85
  },
  // Type patterns - "input X into Y"
  {
    regex: /^input\s+["'](.+?)["']\s+(?:in(?:to)?)\s+(?:the\s+)?(.+)$/i,
    action: "type",
    targetGroup: 2,
    valueGroup: 1,
    confidence: 0.9
  },
  // Type patterns - "fill Y with X"
  {
    regex: /^fill\s+(?:in\s+)?(?:the\s+)?(.+?)\s+with\s+["'](.+?)["']$/i,
    action: "type",
    targetGroup: 1,
    valueGroup: 2,
    confidence: 0.95
  },
  {
    regex: /^fill\s+(?:in\s+)?(?:the\s+)?(.+?)\s+with\s+(.+)$/i,
    action: "type",
    targetGroup: 1,
    valueGroup: 2,
    confidence: 0.85
  },
  // Type patterns - "set Y to X"
  {
    regex: /^set\s+(?:the\s+)?(.+?)\s+to\s+["'](.+?)["']$/i,
    action: "type",
    targetGroup: 1,
    valueGroup: 2,
    confidence: 0.9
  },
  // Select patterns
  {
    regex: /^select\s+["'](.+?)["']\s+(?:from|in)\s+(?:the\s+)?(.+)$/i,
    action: "select",
    targetGroup: 2,
    valueGroup: 1,
    confidence: 0.95
  },
  {
    regex: /^choose\s+["'](.+?)["']\s+(?:from|in)\s+(?:the\s+)?(.+)$/i,
    action: "select",
    targetGroup: 2,
    valueGroup: 1,
    confidence: 0.9
  },
  {
    regex: /^pick\s+["'](.+?)["']\s+(?:from|in)\s+(?:the\s+)?(.+)$/i,
    action: "select",
    targetGroup: 2,
    valueGroup: 1,
    confidence: 0.85
  },
  // Check patterns
  {
    regex: /^check\s+(?:the\s+)?(.+?)(?:\s+checkbox)?$/i,
    action: "check",
    targetGroup: 1,
    confidence: 0.9
  },
  {
    regex: /^enable\s+(?:the\s+)?(.+)$/i,
    action: "check",
    targetGroup: 1,
    confidence: 0.8
  },
  {
    regex: /^tick\s+(?:the\s+)?(.+)$/i,
    action: "check",
    targetGroup: 1,
    confidence: 0.85
  },
  // Uncheck patterns
  {
    regex: /^uncheck\s+(?:the\s+)?(.+?)(?:\s+checkbox)?$/i,
    action: "uncheck",
    targetGroup: 1,
    confidence: 0.9
  },
  {
    regex: /^disable\s+(?:the\s+)?(.+)$/i,
    action: "uncheck",
    targetGroup: 1,
    confidence: 0.8
  },
  {
    regex: /^untick\s+(?:the\s+)?(.+)$/i,
    action: "uncheck",
    targetGroup: 1,
    confidence: 0.85
  },
  // Clear patterns
  {
    regex: /^clear\s+(?:the\s+)?(.+)$/i,
    action: "clear",
    targetGroup: 1,
    confidence: 0.9
  },
  {
    regex: /^erase\s+(?:the\s+)?(.+)$/i,
    action: "clear",
    targetGroup: 1,
    confidence: 0.85
  },
  {
    regex: /^empty\s+(?:the\s+)?(.+)$/i,
    action: "clear",
    targetGroup: 1,
    confidence: 0.8
  },
  // Hover patterns
  {
    regex: /^hover\s+(?:over\s+)?(?:the\s+)?(.+)$/i,
    action: "hover",
    targetGroup: 1,
    confidence: 0.9
  },
  {
    regex: /^mouse\s+over\s+(?:the\s+)?(.+)$/i,
    action: "hover",
    targetGroup: 1,
    confidence: 0.85
  },
  // Focus patterns
  {
    regex: /^focus\s+(?:on\s+)?(?:the\s+)?(.+)$/i,
    action: "focus",
    targetGroup: 1,
    confidence: 0.9
  },
  // Scroll patterns
  {
    regex: /^scroll\s+(up|down|left|right)$/i,
    action: "scroll",
    targetGroup: 1,
    confidence: 0.9
  },
  {
    regex: /^scroll\s+(?:the\s+)?(.+?)\s+(up|down|left|right)$/i,
    action: "scroll",
    targetGroup: 1,
    confidence: 0.85
  },
  {
    regex: /^scroll\s+to\s+(?:the\s+)?(.+)$/i,
    action: "scroll",
    targetGroup: 1,
    confidence: 0.85
  },
  // Wait patterns
  {
    regex: /^wait\s+(?:for\s+)?(?:the\s+)?(.+?)(?:\s+to\s+(?:be\s+)?(.+))?$/i,
    action: "wait",
    targetGroup: 1,
    confidence: 0.85
  },
  {
    regex: /^wait\s+until\s+(?:the\s+)?(.+?)(?:\s+(?:is|becomes)\s+(.+))?$/i,
    action: "wait",
    targetGroup: 1,
    confidence: 0.85
  },
  // Assert patterns
  {
    regex: /^(?:assert|verify|check)\s+(?:that\s+)?(?:the\s+)?(.+?)\s+(?:is\s+)?(visible|hidden|enabled|disabled|checked|unchecked|focused)$/i,
    action: "assert",
    targetGroup: 1,
    confidence: 0.9
  },
  {
    regex: /^(?:assert|verify|check)\s+(?:that\s+)?(?:the\s+)?(.+?)\s+(?:contains|has)\s+["'](.+?)["']$/i,
    action: "assert",
    targetGroup: 1,
    valueGroup: 2,
    confidence: 0.9
  },
  {
    regex: /^(?:the\s+)?(.+?)\s+should\s+(?:be\s+)?(visible|hidden|enabled|disabled|checked|unchecked|focused)$/i,
    action: "assert",
    targetGroup: 1,
    confidence: 0.85
  }
];
var ASSERTION_TYPE_MAP = {
  visible: "visible",
  hidden: "hidden",
  enabled: "enabled",
  disabled: "disabled",
  checked: "checked",
  unchecked: "unchecked",
  focused: "focused",
  contains: "containsText",
  has: "hasText"
};
function parseNLInstruction(instruction) {
  const trimmed = instruction.trim();
  if (!trimmed) return null;
  for (const pattern of ACTION_PATTERNS) {
    const match = trimmed.match(pattern.regex);
    if (match) {
      const parsed = {
        action: pattern.action,
        targetDescription: cleanTargetDescription(match[pattern.targetGroup] || ""),
        rawInstruction: instruction,
        parseConfidence: pattern.confidence
      };
      if (pattern.valueGroup && match[pattern.valueGroup]) {
        parsed.value = match[pattern.valueGroup];
      }
      if (pattern.modifierExtractor) {
        parsed.modifiers = pattern.modifierExtractor(match);
      }
      if (pattern.action === "scroll") {
        const directionMatch = trimmed.match(/(up|down|left|right)/i);
        if (directionMatch) {
          parsed.scrollDirection = directionMatch[1].toLowerCase();
        }
      }
      if (pattern.action === "assert") {
        const assertMatch = trimmed.match(
          /(visible|hidden|enabled|disabled|checked|unchecked|focused|contains|has)/i
        );
        if (assertMatch) {
          parsed.assertionType = ASSERTION_TYPE_MAP[assertMatch[1].toLowerCase()];
        }
      }
      if (pattern.action === "wait") {
        const waitCondition = match[2];
        if (waitCondition) {
          parsed.waitCondition = waitCondition;
        }
      }
      return parsed;
    }
  }
  return inferAction(trimmed);
}
function cleanTargetDescription(target) {
  return target.trim().replace(/^(the|a|an)\s+/i, "").replace(/\s+(button|field|input|link|dropdown|checkbox|radio)$/i, "").trim();
}
function inferAction(instruction) {
  const lower = instruction.toLowerCase();
  if (lower.includes("click") || lower.includes("press") || lower.includes("tap")) {
    const target = instruction.replace(/click|press|tap|on|the/gi, "").trim();
    if (target) {
      return {
        action: "click",
        targetDescription: cleanTargetDescription(target),
        rawInstruction: instruction,
        parseConfidence: 0.6
      };
    }
  }
  if (lower.includes("type") || lower.includes("enter") || lower.includes("input")) {
    const quotedMatch = instruction.match(/["'](.+?)["']/);
    if (quotedMatch) {
      const target = instruction.replace(/type|enter|input|into|in|the|["'].*?["']/gi, "").trim();
      return {
        action: "type",
        targetDescription: cleanTargetDescription(target),
        value: quotedMatch[1],
        rawInstruction: instruction,
        parseConfidence: 0.5
      };
    }
  }
  return null;
}
function parseNLInstructions(instructions) {
  const parsed = [];
  for (const instruction of instructions) {
    const result = parseNLInstruction(instruction);
    if (result) {
      parsed.push(result);
    }
  }
  return parsed;
}
function splitCompoundInstruction(instruction) {
  const parts = instruction.split(/\s+(?:and|then|,\s*then|,\s*and|,)\s+/i);
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}
function extractModifiers(instruction) {
  const modifiers = [];
  const lower = instruction.toLowerCase();
  if (lower.includes("shift") || lower.includes("with shift")) {
    modifiers.push("shift");
  }
  if (lower.includes("ctrl") || lower.includes("control") || lower.includes("with ctrl")) {
    modifiers.push("ctrl");
  }
  if (lower.includes("alt") || lower.includes("with alt") || lower.includes("option")) {
    modifiers.push("alt");
  }
  if (lower.includes("meta") || lower.includes("command") || lower.includes("cmd") || lower.includes("windows")) {
    modifiers.push("meta");
  }
  return modifiers.length > 0 ? modifiers : void 0;
}
function validateParsedAction(action) {
  const errors = [];
  if (!action.targetDescription && action.action !== "scroll") {
    errors.push("No target element specified");
  }
  if ((action.action === "type" || action.action === "select") && !action.value) {
    errors.push(`No value specified for ${action.action} action`);
  }
  if (action.parseConfidence < 0.5) {
    errors.push("Low confidence parsing - instruction may be ambiguous");
  }
  return {
    valid: errors.length === 0,
    errors
  };
}
function describeAction(action) {
  switch (action.action) {
    case "click":
      return `Click on "${action.targetDescription}"`;
    case "doubleClick":
      return `Double-click on "${action.targetDescription}"`;
    case "rightClick":
      return `Right-click on "${action.targetDescription}"`;
    case "type":
      return `Type "${action.value}" into "${action.targetDescription}"`;
    case "select":
      return `Select "${action.value}" from "${action.targetDescription}"`;
    case "check":
      return `Check "${action.targetDescription}"`;
    case "uncheck":
      return `Uncheck "${action.targetDescription}"`;
    case "clear":
      return `Clear "${action.targetDescription}"`;
    case "hover":
      return `Hover over "${action.targetDescription}"`;
    case "focus":
      return `Focus on "${action.targetDescription}"`;
    case "scroll":
      if (action.scrollDirection) {
        return `Scroll ${action.scrollDirection}`;
      }
      return `Scroll to "${action.targetDescription}"`;
    case "wait":
      return `Wait for "${action.targetDescription}"${action.waitCondition ? ` to be ${action.waitCondition}` : ""}`;
    case "assert":
      return `Assert "${action.targetDescription}" is ${action.assertionType || "valid"}`;
    default:
      return `${action.action} on "${action.targetDescription}"`;
  }
}

// src/ai/error-context.ts
function getElementState2(el) {
  if ("state" in el && el.state) {
    return el.state;
  }
  if ("getState" in el && typeof el.getState === "function") {
    try {
      return el.getState();
    } catch {
      return void 0;
    }
  }
  return void 0;
}
var ErrorCodes = {
  // Parsing errors
  PARSE_ERROR: "PARSE_ERROR",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  // Element errors
  ELEMENT_NOT_FOUND: "ELEMENT_NOT_FOUND",
  ELEMENT_NOT_VISIBLE: "ELEMENT_NOT_VISIBLE",
  ELEMENT_DISABLED: "ELEMENT_DISABLED",
  ELEMENT_BLOCKED: "ELEMENT_BLOCKED",
  MULTIPLE_ELEMENTS: "MULTIPLE_ELEMENTS",
  // Search errors
  LOW_CONFIDENCE: "LOW_CONFIDENCE",
  AMBIGUOUS_MATCH: "AMBIGUOUS_MATCH",
  // Action errors
  ACTION_FAILED: "ACTION_FAILED",
  ACTION_TIMEOUT: "ACTION_TIMEOUT",
  UNSUPPORTED_ACTION: "UNSUPPORTED_ACTION",
  // State errors
  UNEXPECTED_STATE: "UNEXPECTED_STATE",
  STALE_ELEMENT: "STALE_ELEMENT",
  // Page errors
  PAGE_LOAD_ERROR: "PAGE_LOAD_ERROR",
  NAVIGATION_ERROR: "NAVIGATION_ERROR"
};
var ERROR_MESSAGES = {
  PARSE_ERROR: "Could not parse the natural language instruction",
  VALIDATION_ERROR: "The parsed action failed validation",
  ELEMENT_NOT_FOUND: "No element matching the description could be found",
  ELEMENT_NOT_VISIBLE: "The element exists but is not visible",
  ELEMENT_DISABLED: "The element is disabled and cannot be interacted with",
  ELEMENT_BLOCKED: "The element is blocked by another element",
  MULTIPLE_ELEMENTS: "Multiple elements match the description",
  LOW_CONFIDENCE: "The best match has low confidence",
  AMBIGUOUS_MATCH: "Multiple elements match with similar confidence",
  ACTION_FAILED: "The action could not be completed",
  ACTION_TIMEOUT: "The action timed out waiting for a condition",
  UNSUPPORTED_ACTION: "The requested action is not supported",
  UNEXPECTED_STATE: "The element is in an unexpected state",
  STALE_ELEMENT: "The element is no longer attached to the DOM",
  PAGE_LOAD_ERROR: "The page failed to load correctly",
  NAVIGATION_ERROR: "Navigation to the target page failed"
};
var ERROR_SUGGESTIONS = {
  PARSE_ERROR: [
    {
      action: 'Use a simpler instruction format like "click Submit button"',
      confidence: 0.8,
      priority: 1
    },
    {
      action: "Use specific element names visible on the page",
      confidence: 0.7,
      priority: 2
    }
  ],
  VALIDATION_ERROR: [
    {
      action: "Provide required parameters for the action",
      confidence: 0.9,
      priority: 1
    },
    {
      action: "Check the instruction format",
      confidence: 0.7,
      priority: 2
    }
  ],
  ELEMENT_NOT_FOUND: [
    {
      action: "Wait for the page to fully load",
      command: "wait for page to load",
      confidence: 0.7,
      priority: 1
    },
    {
      action: "Use a different description for the element",
      confidence: 0.8,
      priority: 2
    },
    {
      action: "Scroll the page to reveal the element",
      command: "scroll down",
      confidence: 0.6,
      priority: 3
    }
  ],
  ELEMENT_NOT_VISIBLE: [
    {
      action: "Scroll to make the element visible",
      command: "scroll to element",
      confidence: 0.9,
      priority: 1
    },
    {
      action: "Close any overlaying elements",
      confidence: 0.7,
      priority: 2
    },
    {
      action: "Wait for loading to complete",
      command: "wait for loading",
      confidence: 0.6,
      priority: 3
    }
  ],
  ELEMENT_DISABLED: [
    {
      action: "Fill in required fields first",
      confidence: 0.8,
      priority: 1
    },
    {
      action: "Complete prerequisite steps",
      confidence: 0.7,
      priority: 2
    },
    {
      action: "Wait for the element to become enabled",
      command: "wait for element to be enabled",
      confidence: 0.6,
      priority: 3
    }
  ],
  ELEMENT_BLOCKED: [
    {
      action: "Close the modal or popup",
      command: "click close button",
      confidence: 0.9,
      priority: 1
    },
    {
      action: "Dismiss the overlay",
      confidence: 0.8,
      priority: 2
    },
    {
      action: "Wait for the blocking element to disappear",
      confidence: 0.6,
      priority: 3
    }
  ],
  MULTIPLE_ELEMENTS: [
    {
      action: "Use a more specific description",
      confidence: 0.9,
      priority: 1
    },
    {
      action: "Include the element position (first, second, etc.)",
      confidence: 0.8,
      priority: 2
    },
    {
      action: "Use the element ID directly",
      confidence: 0.7,
      priority: 3
    }
  ],
  LOW_CONFIDENCE: [
    {
      action: "Use the exact text shown on the element",
      confidence: 0.9,
      priority: 1
    },
    {
      action: "Lower the confidence threshold if the match is correct",
      confidence: 0.7,
      priority: 2
    },
    {
      action: "Try a different way to describe the element",
      confidence: 0.6,
      priority: 3
    }
  ],
  AMBIGUOUS_MATCH: [
    {
      action: "Be more specific about which element you mean",
      confidence: 0.9,
      priority: 1
    },
    {
      action: "Include the section or form name",
      confidence: 0.8,
      priority: 2
    }
  ],
  ACTION_FAILED: [
    {
      action: "Check if the element is interactable",
      confidence: 0.7,
      priority: 1
    },
    {
      action: "Wait and retry the action",
      command: "wait 1 second then retry",
      confidence: 0.6,
      priority: 2
    }
  ],
  ACTION_TIMEOUT: [
    {
      action: "Increase the timeout duration",
      confidence: 0.8,
      priority: 1
    },
    {
      action: "Check if the condition can ever be met",
      confidence: 0.7,
      priority: 2
    }
  ],
  UNSUPPORTED_ACTION: [
    {
      action: "Use a different action type",
      confidence: 0.9,
      priority: 1
    },
    {
      action: "Break down into simpler actions",
      confidence: 0.7,
      priority: 2
    }
  ],
  UNEXPECTED_STATE: [
    {
      action: "Refresh the page state",
      command: "refresh",
      confidence: 0.7,
      priority: 1
    },
    {
      action: "Wait for state to stabilize",
      command: "wait 2 seconds",
      confidence: 0.6,
      priority: 2
    }
  ],
  STALE_ELEMENT: [
    {
      action: "Re-find the element",
      confidence: 0.9,
      priority: 1
    },
    {
      action: "Wait for page to stabilize",
      command: "wait 1 second",
      confidence: 0.7,
      priority: 2
    }
  ],
  PAGE_LOAD_ERROR: [
    {
      action: "Refresh the page",
      command: "refresh page",
      confidence: 0.8,
      priority: 1
    },
    {
      action: "Check network connectivity",
      confidence: 0.6,
      priority: 2
    }
  ],
  NAVIGATION_ERROR: [
    {
      action: "Try the navigation again",
      confidence: 0.7,
      priority: 1
    },
    {
      action: "Check if the URL is correct",
      confidence: 0.6,
      priority: 2
    }
  ]
};
function createErrorContext(errorCode, attemptedAction, availableElements, searchCriteria, nearestMatch) {
  const message = ERROR_MESSAGES[errorCode] || "An unknown error occurred";
  const baseSuggestions = ERROR_SUGGESTIONS[errorCode] || [];
  const possibleBlockers = detectPossibleBlockers(availableElements);
  const visibleElements = availableElements.filter((el) => {
    const state = getElementState2(el);
    return state?.visible ?? false;
  }).length;
  const suggestions = enhanceSuggestions(
    baseSuggestions,
    errorCode,
    nearestMatch,
    possibleBlockers
  );
  return {
    code: errorCode,
    message,
    attemptedAction,
    searchCriteria,
    searchResults: {
      candidatesFound: availableElements.length,
      nearestMatch: nearestMatch ? {
        element: nearestMatch.element,
        confidence: nearestMatch.confidence,
        whyNotSelected: determineWhyNotSelected(errorCode, nearestMatch)
      } : void 0
    },
    pageContext: {
      url: typeof window !== "undefined" ? window.location.href : "",
      title: typeof document !== "undefined" ? document.title : "",
      visibleElements,
      possibleBlockers
    },
    suggestions,
    timestamp: Date.now()
  };
}
function detectPossibleBlockers(elements) {
  const blockers = [];
  for (const el of elements) {
    const state = getElementState2(el);
    if (!state) continue;
    if (el.type === "dialog" && state.visible) {
      blockers.push(`Modal dialog: ${el.id}`);
    }
    if (state.computedStyles?.pointerEvents === "none") {
      continue;
    }
  }
  return blockers;
}
function enhanceSuggestions(baseSuggestions, errorCode, nearestMatch, possibleBlockers) {
  const suggestions = [...baseSuggestions];
  if (possibleBlockers && possibleBlockers.length > 0) {
    suggestions.unshift({
      action: `Close the blocking element: ${possibleBlockers[0]}`,
      command: "click close button",
      confidence: 0.85,
      priority: 0
    });
  }
  if (nearestMatch && errorCode === "LOW_CONFIDENCE") {
    suggestions.unshift({
      action: `Did you mean: "${nearestMatch.element.description}"?`,
      command: `click "${nearestMatch.element.description}"`,
      confidence: nearestMatch.confidence,
      priority: 0
    });
  }
  suggestions.sort((a, b) => a.priority - b.priority);
  return suggestions;
}
function determineWhyNotSelected(errorCode, nearestMatch) {
  switch (errorCode) {
    case "LOW_CONFIDENCE":
      return `Confidence (${(nearestMatch.confidence * 100).toFixed(0)}%) below threshold`;
    case "ELEMENT_NOT_VISIBLE":
      return "Element is not visible";
    case "ELEMENT_DISABLED":
      return "Element is disabled";
    case "AMBIGUOUS_MATCH":
      return "Multiple elements with similar confidence";
    default:
      return "Did not meet selection criteria";
  }
}
function formatErrorContext(context) {
  const lines = [];
  lines.push(`Error: ${context.code}`);
  lines.push(`Message: ${context.message}`);
  lines.push(`Attempted: ${context.attemptedAction}`);
  lines.push("");
  if (context.searchResults.nearestMatch) {
    const match = context.searchResults.nearestMatch;
    lines.push(
      `Nearest match: "${match.element.description}" (${(match.confidence * 100).toFixed(0)}% confidence)`
    );
    lines.push(`Why not used: ${match.whyNotSelected}`);
    lines.push("");
  }
  lines.push(`Page: ${context.pageContext.title || context.pageContext.url}`);
  lines.push(`Visible elements: ${context.pageContext.visibleElements}`);
  if (context.pageContext.possibleBlockers.length > 0) {
    lines.push(`Possible blockers: ${context.pageContext.possibleBlockers.join(", ")}`);
  }
  lines.push("");
  lines.push("Suggestions:");
  for (const suggestion of context.suggestions.slice(0, 3)) {
    lines.push(`  - ${suggestion.action}`);
    if (suggestion.command) {
      lines.push(`    Command: ${suggestion.command}`);
    }
  }
  return lines.join("\n");
}
function createSimpleError(code, message) {
  return {
    code,
    message: message || ERROR_MESSAGES[code] || "Unknown error"
  };
}
function isRecoverableError(code) {
  const unrecoverableErrors = [
    "UNSUPPORTED_ACTION",
    "PAGE_LOAD_ERROR",
    "NAVIGATION_ERROR"
  ];
  return !unrecoverableErrors.includes(code);
}
function getBestRecoverySuggestion(context) {
  if (context.suggestions.length === 0) return null;
  const sorted = [...context.suggestions].sort((a, b) => b.confidence - a.confidence);
  return sorted[0];
}

// src/ai/nl-action-executor.ts
var DEFAULT_EXECUTOR_CONFIG = {
  defaultConfidenceThreshold: 0.7,
  defaultTimeout: 5e3,
  maxAlternatives: 3,
  verbose: false
};
var NLActionExecutor = class {
  constructor(config = {}) {
    this.actionExecutor = null;
    this.elements = [];
    this.config = { ...DEFAULT_EXECUTOR_CONFIG, ...config };
    this.searchEngine = new SearchEngine(this.config.searchConfig);
  }
  /**
   * Set the action executor for performing DOM actions
   */
  setActionExecutor(executor) {
    this.actionExecutor = executor;
  }
  /**
   * Update available elements for search
   */
  updateElements(elements) {
    this.elements = elements;
    this.searchEngine.updateElements(elements);
  }
  /**
   * Execute a natural language instruction
   */
  async execute(request) {
    const startTime = performance.now();
    const threshold = request.confidenceThreshold ?? this.config.defaultConfidenceThreshold;
    const parsed = parseNLInstruction(request.instruction);
    if (!parsed) {
      return this.createFailureResponse(
        startTime,
        "PARSE_ERROR",
        `Could not parse instruction: "${request.instruction}"`,
        request.instruction,
        [],
        threshold
      );
    }
    const validation = validateParsedAction(parsed);
    if (!validation.valid) {
      return this.createFailureResponse(
        startTime,
        "VALIDATION_ERROR",
        validation.errors.join("; "),
        request.instruction,
        [],
        threshold
      );
    }
    const searchCriteria = this.buildSearchCriteria(parsed);
    const searchResponse = this.searchEngine.search(searchCriteria);
    if (!searchResponse.bestMatch) {
      return this.createFailureResponse(
        startTime,
        "ELEMENT_NOT_FOUND",
        `Could not find element matching: "${parsed.targetDescription}"`,
        request.instruction,
        searchResponse.results,
        threshold,
        searchCriteria
      );
    }
    if (searchResponse.bestMatch.confidence < threshold) {
      const alternatives = searchResponse.results.slice(0, this.config.maxAlternatives);
      return this.createFailureResponse(
        startTime,
        "LOW_CONFIDENCE",
        `Best match confidence (${(searchResponse.bestMatch.confidence * 100).toFixed(0)}%) is below threshold (${(threshold * 100).toFixed(0)}%)`,
        request.instruction,
        alternatives,
        threshold,
        searchCriteria,
        searchResponse.bestMatch
      );
    }
    try {
      const result = await this.performAction(
        parsed,
        searchResponse.bestMatch.element,
        request.timeout ?? this.config.defaultTimeout
      );
      return {
        success: true,
        executedAction: describeAction(parsed),
        elementUsed: searchResponse.bestMatch.element,
        confidence: searchResponse.bestMatch.confidence,
        elementState: result.elementState,
        durationMs: performance.now() - startTime,
        timestamp: Date.now()
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const alternatives = searchResponse.results.filter((r) => r !== searchResponse.bestMatch).slice(0, this.config.maxAlternatives);
      return this.createFailureResponse(
        startTime,
        "ACTION_FAILED",
        errorMessage,
        request.instruction,
        alternatives,
        threshold,
        searchCriteria,
        searchResponse.bestMatch
      );
    }
  }
  /**
   * Execute a parsed action directly (skip parsing)
   */
  async executeParsed(parsed, threshold) {
    const startTime = performance.now();
    const confidenceThreshold = threshold ?? this.config.defaultConfidenceThreshold;
    const searchCriteria = this.buildSearchCriteria(parsed);
    const searchResponse = this.searchEngine.search(searchCriteria);
    if (!searchResponse.bestMatch) {
      return this.createFailureResponse(
        startTime,
        "ELEMENT_NOT_FOUND",
        `Could not find element: "${parsed.targetDescription}"`,
        parsed.rawInstruction,
        [],
        confidenceThreshold,
        searchCriteria
      );
    }
    if (searchResponse.bestMatch.confidence < confidenceThreshold) {
      return this.createFailureResponse(
        startTime,
        "LOW_CONFIDENCE",
        `Best match confidence too low`,
        parsed.rawInstruction,
        searchResponse.results.slice(0, this.config.maxAlternatives),
        confidenceThreshold,
        searchCriteria,
        searchResponse.bestMatch
      );
    }
    try {
      const result = await this.performAction(
        parsed,
        searchResponse.bestMatch.element,
        this.config.defaultTimeout
      );
      return {
        success: true,
        executedAction: describeAction(parsed),
        elementUsed: searchResponse.bestMatch.element,
        confidence: searchResponse.bestMatch.confidence,
        elementState: result.elementState,
        durationMs: performance.now() - startTime,
        timestamp: Date.now()
      };
    } catch (error) {
      return this.createFailureResponse(
        startTime,
        "ACTION_FAILED",
        error instanceof Error ? error.message : String(error),
        parsed.rawInstruction,
        searchResponse.results.filter((r) => r !== searchResponse.bestMatch).slice(0, this.config.maxAlternatives),
        confidenceThreshold,
        searchCriteria,
        searchResponse.bestMatch
      );
    }
  }
  /**
   * Build search criteria from a parsed action.
   *
   * If `targetDescription` is `"element <kebab-id>"`, treat it as a direct
   * id lookup against the cached element registry — the planner uses this
   * form to bypass fuzzy label matching for elements with stable ids
   * (e.g. registered disclosures). Falls back to text + type-hint matching
   * for free-form descriptions.
   */
  buildSearchCriteria(parsed) {
    const idMatch = parsed.targetDescription.match(/^element\s+([\w-]+)$/i);
    if (idMatch) {
      const id = idMatch[1];
      const exists = this.elements.some((el) => el.id === id);
      if (exists) {
        return { idPattern: id };
      }
    }
    const criteria = {
      text: parsed.targetDescription,
      fuzzy: true,
      fuzzyThreshold: this.config.defaultConfidenceThreshold
    };
    switch (parsed.action) {
      case "click":
      case "doubleClick":
      case "rightClick":
        break;
      case "type":
      case "clear":
        criteria.type = "input";
        break;
      case "select":
        criteria.type = "select";
        break;
      case "check":
      case "uncheck":
        criteria.type = "checkbox";
        break;
    }
    return criteria;
  }
  /**
   * Perform the actual action on an element
   */
  async performAction(parsed, element, timeout) {
    if (!this.actionExecutor) {
      throw new Error("No action executor configured");
    }
    const actionMap = {
      click: "click",
      doubleClick: "doubleClick",
      rightClick: "rightClick",
      type: "type",
      select: "select",
      check: "check",
      uncheck: "uncheck",
      scroll: "scroll",
      wait: null,
      // Special handling
      assert: null,
      // Special handling
      hover: "hover",
      focus: "focus",
      clear: "clear"
    };
    const standardAction = actionMap[parsed.action];
    if (!standardAction) {
      if (parsed.action === "wait") {
        const waitResult = await this.actionExecutor.waitFor(element.id, {
          visible: true,
          timeout
        });
        if (!waitResult.met) {
          throw new Error(waitResult.error || "Wait condition not met");
        }
        return { elementState: waitResult.state };
      }
      if (parsed.action === "assert") {
        throw new Error("Use the assertions module for assert actions");
      }
      throw new Error(`Unsupported action: ${parsed.action}`);
    }
    const actionRequest = {
      action: standardAction,
      waitOptions: {
        visible: true,
        enabled: true,
        timeout
      }
    };
    if (standardAction === "type" && parsed.value) {
      actionRequest.params = { text: parsed.value, clear: true };
    } else if (standardAction === "select" && parsed.value) {
      actionRequest.params = { value: parsed.value };
    } else if (standardAction === "scroll" && parsed.scrollDirection) {
      actionRequest.params = { direction: parsed.scrollDirection };
    }
    const response = await this.actionExecutor.executeAction(element.id, actionRequest);
    if (!response.success) {
      throw new Error(response.error || "Action failed");
    }
    return { elementState: response.elementState };
  }
  /**
   * Create a failure response with suggestions
   */
  createFailureResponse(startTime, errorCode, errorMessage, instruction, alternatives, threshold, searchCriteria, nearestMatch) {
    const suggestions = this.generateSuggestions(
      errorCode,
      instruction,
      alternatives,
      nearestMatch
    );
    const dummyElement = nearestMatch?.element || {
      id: "not-found",
      type: "unknown",
      tagName: "unknown",
      actions: [],
      state: {
        visible: false,
        enabled: false,
        focused: false,
        rect: { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0 }
      },
      registered: false,
      description: "Element not found",
      aliases: [],
      suggestedActions: []
    };
    return {
      success: false,
      executedAction: instruction,
      elementUsed: dummyElement,
      confidence: nearestMatch?.confidence || 0,
      elementState: dummyElement.state,
      durationMs: performance.now() - startTime,
      timestamp: Date.now(),
      error: errorMessage,
      errorCode,
      suggestions,
      alternatives: alternatives.slice(0, this.config.maxAlternatives)
    };
  }
  /**
   * Generate recovery suggestions
   */
  generateSuggestions(errorCode, instruction, alternatives, nearestMatch) {
    const suggestions = [];
    switch (errorCode) {
      case "PARSE_ERROR":
        suggestions.push('Try using a simpler phrase like "click Submit button"');
        suggestions.push(
          'Ensure the instruction follows patterns like "click X" or "type Y into X"'
        );
        break;
      case "ELEMENT_NOT_FOUND":
        if (alternatives.length > 0) {
          suggestions.push(`Did you mean: "${alternatives[0].element.description}"?`);
        }
        suggestions.push("Check if the element is visible on the page");
        suggestions.push("Try using a more specific description");
        break;
      case "LOW_CONFIDENCE":
        if (nearestMatch) {
          suggestions.push(
            `Found "${nearestMatch.element.description}" with ${(nearestMatch.confidence * 100).toFixed(0)}% confidence`
          );
        }
        suggestions.push("Try using the exact text shown on the element");
        suggestions.push("Lower the confidence threshold if this match is correct");
        break;
      case "ACTION_FAILED":
        suggestions.push("Check if the element is enabled");
        suggestions.push("Wait for any loading to complete");
        suggestions.push("Ensure no modal or overlay is blocking the element");
        break;
      default:
        suggestions.push("Try a different approach or check the page state");
    }
    return suggestions;
  }
  /**
   * Get rich error context for debugging
   */
  getErrorContext(errorCode, instruction, searchCriteria, nearestMatch) {
    return createErrorContext(
      errorCode,
      instruction,
      this.elements,
      searchCriteria,
      nearestMatch
    );
  }
};
function createNLActionExecutor(config) {
  return new NLActionExecutor(config);
}

// src/ai/target-decomposer.ts
var NOISE_WORDS = /* @__PURE__ */ new Set(["the", "a", "an", "that", "this", "those", "these", "its", "my"]);
var ELEMENT_TYPE_SYNONYMS = [
  // Inputs / form
  { type: "textarea", synonyms: ["text area", "text field", "text box"] },
  { type: "input", synonyms: ["input", "field", "textbox"] },
  { type: "select", synonyms: ["drop down", "dropdown", "combo box", "combobox", "select"] },
  { type: "checkbox", synonyms: ["check box", "checkbox"] },
  { type: "radio", synonyms: ["radio button", "radio"] },
  // Buttons / links
  // 'icon' is a soft hint — "settings icon" is usually a button but could
  // also be a passive image; let the label match decide if the type fails.
  { type: "button", synonyms: ["button"] },
  { type: "button", synonyms: ["icon"], softHint: true },
  { type: "link", synonyms: ["link", "hyperlink", "anchor"] },
  // Navigation
  { type: "tab", synonyms: ["tab"] },
  { type: "menuitem", synonyms: ["menu item", "menuitem"] },
  { type: "menu", synonyms: ["menu"] },
  // Disclosure / accordion family
  // Multi-word phrases (e.g., "details toggle") sit above the bare "toggle"
  // synonym below so they win precedence. The single-word "details" is
  // softHint because it commonly appears as label text ("Job details"); a
  // label match should still work when nothing else flags this as
  // a disclosure.
  {
    type: "disclosure",
    synonyms: [
      "details toggle",
      "details panel",
      "disclosure",
      "accordion",
      "collapsible",
      "expander",
      "expandable"
    ]
  },
  {
    type: "disclosure",
    synonyms: ["expand", "collapse", "details"],
    softHint: true
  },
  // Switch / toggle
  // Plain "toggle" is a soft hint — "details toggle" already routed above to
  // disclosure; in other contexts the matcher should fall back to a
  // label-only retry rather than hard-pinning the type.
  { type: "switch", synonyms: ["switch"] },
  { type: "switch", synonyms: ["toggle"], softHint: true },
  // Misc
  { type: "slider", synonyms: ["slider"] },
  { type: "label", synonyms: ["label"] },
  { type: "heading", synonyms: ["heading"] }
];
function compileSynonym(type, synonym, softHint) {
  const tokens = synonym.trim().split(/\s+/);
  const escaped = tokens.map((t) => escapeRegExp(t)).join("\\s+");
  return {
    pattern: new RegExp(`\\b${escaped}\\b`, "i"),
    type,
    softHint,
    synonym,
    wordCount: tokens.length
  };
}
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
var COMPILED_ELEMENT_TYPE_SYNONYMS = (() => {
  const compiled = [];
  for (const entry of ELEMENT_TYPE_SYNONYMS) {
    for (const syn of entry.synonyms) {
      compiled.push(compileSynonym(entry.type, syn, entry.softHint === true));
    }
  }
  compiled.sort((a, b) => {
    if (b.wordCount !== a.wordCount) return b.wordCount - a.wordCount;
    return b.synonym.length - a.synonym.length;
  });
  return compiled;
})();
function isSoftTypeHint(decomposed) {
  return decomposed.__softTypeHint === true;
}
var SPATIAL_PATTERNS = [
  { pattern: /\bnext\s+to\s+(.+)$/i, relation: "near" },
  { pattern: /\bbeside\s+(.+)$/i, relation: "near" },
  { pattern: /\bnear\s+(.+)$/i, relation: "near" },
  { pattern: /\babove\s+(.+)$/i, relation: "above" },
  { pattern: /\bbelow\s+(.+)$/i, relation: "below" },
  { pattern: /\bunder(?:neath)?\s+(.+)$/i, relation: "below" },
  { pattern: /\bleft\s+of\s+(.+)$/i, relation: "leftOf" },
  { pattern: /\bright\s+of\s+(.+)$/i, relation: "rightOf" },
  { pattern: /\binside\s+(.+)$/i, relation: "inside" }
];
var CONTAINER_PATTERNS = [
  /\b(?:in|within|inside)\s+(?:the\s+)?(.+?)(?:\s+(?:near|above|below|left of|right of|next to|beside)|\s*$)/i
];
var ORDINAL_MAP = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
  last: -1,
  "1st": 1,
  "2nd": 2,
  "3rd": 3,
  "4th": 4,
  "5th": 5,
  "6th": 6,
  "7th": 7,
  "8th": 8,
  "9th": 9,
  "10th": 10
};
var STATE_FILTERS = /* @__PURE__ */ new Set([
  "disabled",
  "enabled",
  "active",
  "selected",
  "checked",
  "focused",
  "hidden",
  "visible"
]);
function decomposeTarget(description) {
  let remaining = description.trim();
  const result = { elementText: "" };
  remaining = extractStateFilter(remaining, result);
  remaining = extractSpatialRelation(remaining, result);
  if (!result.spatial || result.spatial.relation !== "inside") {
    remaining = extractContainer(remaining, result);
  } else {
    result.container = result.spatial.referenceDescription;
    result.spatial = void 0;
  }
  remaining = extractOrdinal(remaining, result);
  remaining = extractElementType(remaining, result);
  result.elementText = cleanElementText(remaining);
  if (result.elementText) {
    result.label = result.elementText;
    result.ariaLabel = result.elementText;
    result.placeholder = result.elementText;
    result.name = result.elementText;
  }
  return result;
}
function extractStateFilter(text, result) {
  for (const state of STATE_FILTERS) {
    const regex = new RegExp(`\\b${state}\\b`, "i");
    if (regex.test(text)) {
      result.stateFilter = state;
      return text.replace(regex, " ").trim();
    }
  }
  return text;
}
function extractSpatialRelation(text, result) {
  for (const { pattern, relation } of SPATIAL_PATTERNS) {
    const match = text.match(pattern);
    if (match && match[1]) {
      result.spatial = {
        relation,
        referenceDescription: cleanReferenceDescription(match[1])
      };
      return text.slice(0, match.index).trim();
    }
  }
  return text;
}
function extractContainer(text, result) {
  for (const pattern of CONTAINER_PATTERNS) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const container = cleanReferenceDescription(match[1]);
      if (container.length > 2 && !isPartOfCompoundWord(text, match.index)) {
        result.container = container;
        return text.slice(0, match.index).trim();
      }
    }
  }
  return text;
}
function isPartOfCompoundWord(text, matchIndex, _word) {
  const before = text.slice(0, matchIndex).trim().toLowerCase();
  const compoundPrefixes = ["sign", "log", "opt", "check", "plug", "fill", "zoom", "fade", "drop"];
  return compoundPrefixes.some((prefix) => before.endsWith(prefix));
}
function extractOrdinal(text, result) {
  for (const [word, value] of Object.entries(ORDINAL_MAP)) {
    const regex = new RegExp(`\\b${word}\\b`, "i");
    if (regex.test(text)) {
      result.ordinal = value;
      return text.replace(regex, " ").trim();
    }
  }
  const numericMatch = text.match(/\b(\d+)(?:st|nd|rd|th)\b/i);
  if (numericMatch) {
    result.ordinal = parseInt(numericMatch[1], 10);
    return text.replace(numericMatch[0], " ").trim();
  }
  return text;
}
function extractElementType(text, result) {
  for (const entry of COMPILED_ELEMENT_TYPE_SYNONYMS) {
    if (entry.pattern.test(text)) {
      result.elementType = entry.type;
      if (entry.softHint) {
        result.__softTypeHint = true;
      }
      return text.replace(entry.pattern, " ").trim();
    }
  }
  return text;
}
function cleanElementText(text) {
  const words = text.split(/\s+/).filter((w) => !NOISE_WORDS.has(w.toLowerCase()));
  return words.join(" ").replace(/\s+/g, " ").replace(/^[\s,]+|[\s,]+$/g, "").trim();
}
function cleanReferenceDescription(text) {
  return text.replace(/^(?:the|a|an)\s+/i, "").replace(/\s+/g, " ").trim();
}

// src/ai/find.ts
var DEFAULT_FIND_OPTIONS = {
  context: {},
  pickFirst: true,
  confidenceThreshold: 0.5,
  maxResults: 5,
  debug: false
};
var DEBUG_ALTERNATIVES_THRESHOLD = 0.01;
var DEBUG_ALTERNATIVES_LIMIT = 3;
var AMBIGUITY_GAP = 0.1;
var MODAL_PENALTY = 0.3;
var RECENCY_BONUS = 0.05;
function find(query, engine, options) {
  const startTime = performance.now();
  const opts = { ...DEFAULT_FIND_OPTIONS, ...options };
  if (typeof opts.confidenceThreshold !== "number" || Number.isNaN(opts.confidenceThreshold)) {
    opts.confidenceThreshold = DEFAULT_FIND_OPTIONS.confidenceThreshold;
  }
  let criteria;
  let decomposed;
  if (typeof query === "string") {
    decomposed = decomposeTarget(query);
    criteria = resolveCriteria(decomposed, engine, opts);
  } else {
    criteria = query;
    const elementText = query.text || query.textContent || query.accessibleName || "";
    decomposed = {
      elementText,
      elementType: query.type,
      label: elementText || void 0,
      ariaLabel: query.accessibleName || elementText || void 0,
      placeholder: query.placeholder || elementText || void 0,
      name: elementText || void 0
    };
  }
  let searchResponse = engine.search(criteria);
  let results = applyContextScoring(searchResponse.results, opts.context || {}, engine);
  if (decomposed.stateFilter) {
    results = applyStateFilter(results, decomposed.stateFilter);
  }
  if (decomposed.ordinal) {
    results = applyOrdinalFilter(results, decomposed.ordinal);
  }
  let viableResults = results.filter((r) => r.confidence >= opts.confidenceThreshold);
  if (viableResults.length === 0 && typeof query === "string" && isSoftTypeHint(decomposed) && criteria.type) {
    const relaxed = { ...criteria };
    delete relaxed.type;
    searchResponse = engine.search(relaxed);
    results = applyContextScoring(searchResponse.results, opts.context || {}, engine);
    if (decomposed.stateFilter) {
      results = applyStateFilter(results, decomposed.stateFilter);
    }
    if (decomposed.ordinal) {
      results = applyOrdinalFilter(results, decomposed.ordinal);
    }
    viableResults = results.filter((r) => r.confidence >= opts.confidenceThreshold);
  }
  if (viableResults.length === 0 && typeof query === "string" && criteria.type && decomposed.elementType) {
    const cachedTypeLower = String(criteria.type).toLowerCase();
    const cachedSummaries = engine.getCachedElementSummaries();
    const typeIsPresent = cachedSummaries.some((el) => el.type.toLowerCase() === cachedTypeLower);
    if (!typeIsPresent) {
      const relaxed = { ...criteria };
      delete relaxed.type;
      searchResponse = engine.search(relaxed);
      results = applyContextScoring(searchResponse.results, opts.context || {}, engine);
      if (decomposed.stateFilter) {
        results = applyStateFilter(results, decomposed.stateFilter);
      }
      if (decomposed.ordinal) {
        results = applyOrdinalFilter(results, decomposed.ordinal);
      }
      viableResults = results.filter((r) => r.confidence >= opts.confidenceThreshold);
    }
  }
  const durationMs = performance.now() - startTime;
  if (viableResults.length === 0) {
    let alternatives2;
    if (opts.debug) {
      const debugResponse = engine.search({
        ...criteria,
        fuzzyThreshold: DEBUG_ALTERNATIVES_THRESHOLD
      });
      let debugResults = applyContextScoring(
        debugResponse.results,
        opts.context || {},
        engine
      );
      if (decomposed.stateFilter) {
        debugResults = applyStateFilter(debugResults, decomposed.stateFilter);
      }
      if (decomposed.ordinal) {
        debugResults = applyOrdinalFilter(debugResults, decomposed.ordinal);
      }
      debugResults.sort((a, b) => b.confidence - a.confidence);
      alternatives2 = debugResults.slice(0, DEBUG_ALTERNATIVES_LIMIT).map((r) => toCandidate(r));
    }
    return {
      found: false,
      ambiguous: false,
      reason: results.length > 0 ? `Best match confidence (${(results[0].confidence * 100).toFixed(0)}%) below threshold (${(opts.confidenceThreshold * 100).toFixed(0)}%)` : `No elements matching "${decomposed.elementText}" found`,
      partialMatches: results.slice(0, opts.maxResults).map((r) => toCandidate(r)),
      // Diagnostic: how many elements were considered before filtering.
      // Helps agents distinguish "searched 200 elements, none matched" from
      // "searched 10 elements (snapshot truncated?)".
      consideredCount: searchResponse.results.length,
      decomposed,
      durationMs,
      ...alternatives2 !== void 0 ? { alternatives: alternatives2 } : {}
    };
  }
  const isAmbiguous = viableResults.length >= 2 && viableResults[0].confidence - viableResults[1].confidence < AMBIGUITY_GAP;
  if (isAmbiguous && !opts.pickFirst) {
    const candidates = viableResults.slice(0, opts.maxResults).map((r) => toCandidate(r));
    return {
      found: true,
      ambiguous: true,
      candidates,
      suggestion: generateDisambiguationSuggestion(candidates, decomposed),
      decomposed,
      durationMs
    };
  }
  const best = viableResults[0];
  const alternatives = viableResults.slice(1, opts.maxResults).map((r) => toCandidate(r));
  return {
    found: true,
    ambiguous: false,
    element: best.element,
    elementId: best.element.id,
    confidence: best.confidence,
    matchReasons: best.matchReasons,
    alternatives,
    decomposed,
    durationMs
  };
}
function resolveCriteria(decomposed, engine, opts) {
  const criteria = {
    fuzzy: true,
    fuzzyThreshold: opts.confidenceThreshold
  };
  if (decomposed.elementText) {
    criteria.text = decomposed.elementText;
  }
  if (decomposed.elementType) {
    criteria.type = decomposed.elementType;
  }
  if (decomposed.label && decomposed.label !== decomposed.elementText) {
    criteria.accessibleName = decomposed.label;
  } else if (decomposed.ariaLabel && decomposed.ariaLabel !== decomposed.elementText && !criteria.accessibleName) {
    criteria.accessibleName = decomposed.ariaLabel;
  }
  if (decomposed.placeholder && decomposed.placeholder !== decomposed.elementText) {
    criteria.placeholder = decomposed.placeholder;
  }
  if (decomposed.spatial) {
    const refResult = engine.findBest({
      text: decomposed.spatial.referenceDescription,
      fuzzy: true,
      fuzzyThreshold: 0.5
    });
    if (refResult && refResult.confidence >= 0.5) {
      criteria.near = refResult.element.id;
    }
  }
  if (decomposed.container) {
    const containerResult = engine.findBest({
      text: decomposed.container,
      fuzzy: true,
      fuzzyThreshold: 0.4
    });
    if (containerResult && containerResult.confidence >= 0.4) {
      criteria.within = containerResult.element.id;
    }
  }
  return criteria;
}
function applyContextScoring(results, context, engine) {
  if (!context.activeModalId && !context.lastInteractedElement) {
    return results;
  }
  return results.map((result) => {
    let adjustedConfidence = result.confidence;
    const extraReasons = [...result.matchReasons];
    if (context.activeModalId) {
      const inModal = isElementInContainer(result.element, context.activeModalId, engine);
      if (!inModal) {
        adjustedConfidence *= MODAL_PENALTY;
        extraReasons.push("penalty: outside active modal");
      } else {
        extraReasons.push("boost: inside active modal");
      }
    }
    if (context.lastInteractedElement) {
      const nearLastInteracted = isNearElement(
        result.element,
        context.lastInteractedElement,
        engine,
        300
      );
      if (nearLastInteracted) {
        adjustedConfidence = Math.min(1, adjustedConfidence + RECENCY_BONUS);
        extraReasons.push("boost: near last interacted");
      }
    }
    return {
      ...result,
      confidence: adjustedConfidence,
      matchReasons: extraReasons
    };
  }).sort((a, b) => b.confidence - a.confidence);
}
function isElementInContainer(element, containerId, engine) {
  if (element.parentContext && element.parentContext.includes(containerId)) {
    return true;
  }
  const containerResults = engine.findByText(containerId, false);
  if (containerResults.length === 0) return false;
  const containerRect = containerResults[0].element.state.rect;
  const elementRect = element.state.rect;
  return elementRect.x >= containerRect.x && elementRect.y >= containerRect.y && elementRect.x + elementRect.width <= containerRect.x + containerRect.width && elementRect.y + elementRect.height <= containerRect.y + containerRect.height;
}
function isNearElement(element, referenceId, engine, maxDistance) {
  const refResults = engine.findByText(referenceId, false);
  if (refResults.length === 0) return false;
  const refRect = refResults[0].element.state.rect;
  const elRect = element.state.rect;
  const dx = elRect.x + elRect.width / 2 - (refRect.x + refRect.width / 2);
  const dy = elRect.y + elRect.height / 2 - (refRect.y + refRect.height / 2);
  const distance = Math.sqrt(dx * dx + dy * dy);
  return distance <= maxDistance;
}
function applyStateFilter(results, stateFilter) {
  return results.filter((r) => {
    const state = r.element.state;
    switch (stateFilter) {
      case "disabled":
        return !state.enabled;
      case "enabled":
        return state.enabled;
      case "focused":
        return state.focused;
      case "visible":
        return state.visible;
      case "hidden":
        return !state.visible;
      case "checked":
        return state.checked === true;
      case "selected":
        return state.ariaSelected === true;
      case "active":
        return state.focused || state.ariaSelected === true;
      default:
        return true;
    }
  });
}
function applyOrdinalFilter(results, ordinal) {
  if (results.length === 0) return results;
  const sorted = [...results].sort((a, b) => {
    const aRect = a.element.state.rect;
    const bRect = b.element.state.rect;
    const yDiff = aRect.y - bRect.y;
    if (Math.abs(yDiff) > 10) return yDiff;
    return aRect.x - bRect.x;
  });
  if (ordinal === -1) {
    return [sorted[sorted.length - 1]];
  }
  const index = ordinal - 1;
  if (index >= 0 && index < sorted.length) {
    return [sorted[index]];
  }
  return results;
}
function toCandidate(result) {
  return {
    element: result.element,
    elementId: result.element.id,
    confidence: result.confidence,
    matchReasons: result.matchReasons,
    differentiator: generateDifferentiator(result.element)
  };
}
function generateDifferentiator(element) {
  const parts = [];
  if (element.parentContext) {
    parts.push(`in ${element.parentContext}`);
  }
  const rect = element.state.rect;
  if (rect.y < 80) {
    parts.push("at the top of the page");
  } else if (rect.y > 800) {
    parts.push("near the bottom of the page");
  }
  if (rect.x < 250) {
    parts.push("in the left panel");
  } else if (rect.x > 1e3) {
    parts.push("in the right panel");
  }
  if (!element.state.enabled) {
    parts.push("(disabled)");
  }
  if (element.state.focused) {
    parts.push("(focused)");
  }
  if (element.semanticType && element.semanticType !== element.type) {
    parts.push(`[${element.semanticType}]`);
  }
  return parts.length > 0 ? parts.join(", ") : `ID: ${element.id}`;
}
function generateDisambiguationSuggestion(candidates, decomposed) {
  const lines = [`Found ${candidates.length} matching "${decomposed.elementText}" elements:`];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const desc = c.element.description || c.element.label || c.elementId;
    lines.push(`  ${i + 1}. "${desc}" \u2014 ${c.differentiator} (${(c.confidence * 100).toFixed(0)}%)`);
  }
  lines.push("");
  lines.push('Try adding spatial context: "... near X" or "... in the Y"');
  return lines.join("\n");
}

// src/ai/assertions.ts
var DEFAULT_ASSERTION_CONFIG = {
  defaultTimeout: 5e3,
  pollInterval: 100,
  fuzzyThreshold: 0.7,
  includeSuggestions: true
};
var AssertionExecutor = class {
  constructor(config = {}) {
    this.elements = [];
    this.config = { ...DEFAULT_ASSERTION_CONFIG, ...config };
    this.searchEngine = new SearchEngine({ fuzzyThreshold: this.config.fuzzyThreshold });
  }
  /**
   * Update available elements for assertions
   */
  updateElements(elements) {
    this.elements = elements;
    this.searchEngine.updateElements(elements);
  }
  /**
   * Execute a single assertion
   */
  async assert(request) {
    const startTime = performance.now();
    const timeout = request.timeout ?? this.config.defaultTimeout;
    const searchResult = this.findElementDetailed(request.target, request.fuzzy !== false);
    const element = searchResult?.element ?? null;
    const searchDetails = searchResult ? {
      confidence: searchResult.confidence,
      matchReasons: searchResult.matchReasons,
      candidateCount: this.elements.length
    } : void 0;
    if (!element && request.type !== "notExists") {
      const result2 = this.createResult(
        false,
        typeof request.target === "string" ? request.target : JSON.stringify(request.target),
        "element not found",
        request.type === "exists" ? true : request.expected,
        null,
        "Element could not be found",
        this.config.includeSuggestions ? "Check if the element exists and is properly labeled" : void 0,
        startTime
      );
      if (searchDetails) {
        result2.searchDetails = searchDetails;
      }
      return result2;
    }
    const result = await this.executeAssertion(request, element, timeout, startTime);
    if (searchDetails) {
      result.searchDetails = searchDetails;
    }
    return result;
  }
  /**
   * Execute multiple assertions
   */
  async assertBatch(request) {
    const startTime = performance.now();
    const results = [];
    let passedCount = 0;
    let failedCount = 0;
    for (const assertion of request.assertions) {
      const result = await this.assert(assertion);
      results.push(result);
      if (result.passed) {
        passedCount++;
      } else {
        failedCount++;
        if (request.stopOnFailure) {
          break;
        }
      }
    }
    const passed = request.mode === "all" ? failedCount === 0 : passedCount > 0;
    return {
      passed,
      results,
      passedCount,
      failedCount,
      durationMs: performance.now() - startTime,
      timestamp: Date.now()
    };
  }
  /**
   * Convenience method: assert element is visible
   */
  async assertVisible(target, timeout) {
    return this.assert({ target, type: "visible", timeout });
  }
  /**
   * Convenience method: assert element is hidden
   */
  async assertHidden(target, timeout) {
    return this.assert({ target, type: "hidden", timeout });
  }
  /**
   * Convenience method: assert element is enabled
   */
  async assertEnabled(target, timeout) {
    return this.assert({ target, type: "enabled", timeout });
  }
  /**
   * Convenience method: assert element is disabled
   */
  async assertDisabled(target, timeout) {
    return this.assert({ target, type: "disabled", timeout });
  }
  /**
   * Convenience method: assert element has text
   */
  async assertHasText(target, text, timeout) {
    return this.assert({ target, type: "hasText", expected: text, timeout });
  }
  /**
   * Convenience method: assert element contains text
   */
  async assertContainsText(target, text, timeout) {
    return this.assert({ target, type: "containsText", expected: text, timeout });
  }
  /**
   * Convenience method: assert element has value
   */
  async assertHasValue(target, value, timeout) {
    return this.assert({ target, type: "hasValue", expected: value, timeout });
  }
  /**
   * Convenience method: assert element exists
   */
  async assertExists(target, timeout) {
    return this.assert({ target, type: "exists", timeout });
  }
  /**
   * Convenience method: assert element does not exist
   */
  async assertNotExists(target, timeout) {
    return this.assert({ target, type: "notExists", timeout });
  }
  /**
   * Convenience method: assert checkbox is checked
   */
  async assertChecked(target, timeout) {
    return this.assert({ target, type: "checked", timeout });
  }
  /**
   * Convenience method: assert checkbox is unchecked
   */
  async assertUnchecked(target, timeout) {
    return this.assert({ target, type: "unchecked", timeout });
  }
  /**
   * Convenience method: assert element count
   */
  async assertCount(target, expectedCount, timeout) {
    return this.assert({ target, type: "count", expected: expectedCount, timeout });
  }
  /**
   * Find element by target with full search metadata.
   * Returns the SearchResult (including confidence, matchReasons, scores)
   * or null if no match above the fuzzy threshold.
   *
   * Uses the unified find() function for element resolution — the same path
   * used by aiFind — to ensure consistent matching behavior.
   */
  findElementDetailed(target, fuzzy = true) {
    if (typeof target === "string") {
      const directResult = this.searchEngine.search({
        text: target,
        fuzzy,
        fuzzyThreshold: this.config.fuzzyThreshold
      });
      if (directResult.bestMatch && directResult.bestMatch.confidence >= this.config.fuzzyThreshold) {
        return directResult.bestMatch;
      }
    }
    const query = typeof target === "string" ? target : { ...target, fuzzy };
    const findResult = find(query, this.searchEngine, {
      confidenceThreshold: this.config.fuzzyThreshold,
      pickFirst: true
    });
    if (findResult.found && !findResult.ambiguous) {
      return {
        element: findResult.element,
        confidence: findResult.confidence,
        matchReasons: findResult.matchReasons,
        scores: {}
      };
    }
    if (findResult.found && findResult.ambiguous && findResult.candidates.length > 0) {
      const best = findResult.candidates[0];
      return {
        element: best.element,
        confidence: best.confidence,
        matchReasons: best.matchReasons,
        scores: {}
      };
    }
    return null;
  }
  /**
   * Find element by target (string or criteria).
   * Public for use by condition evaluation in SpecExecutor.
   */
  async findElement(target, fuzzy = true) {
    const result = this.findElementDetailed(target, fuzzy);
    return result?.element ?? null;
  }
  /**
   * Execute the actual assertion
   */
  async executeAssertion(request, element, timeout, startTime) {
    const targetStr = typeof request.target === "string" ? request.target : JSON.stringify(request.target);
    const elementDescription = element?.description || targetStr;
    switch (request.type) {
      case "visible":
        return this.assertVisibility(
          element,
          true,
          elementDescription,
          request.message,
          startTime
        );
      case "hidden":
        return this.assertVisibility(
          element,
          false,
          elementDescription,
          request.message,
          startTime
        );
      case "enabled":
        return this.assertEnabledState(
          element,
          true,
          elementDescription,
          request.message,
          startTime
        );
      case "disabled":
        return this.assertEnabledState(
          element,
          false,
          elementDescription,
          request.message,
          startTime
        );
      case "focused":
        return this.assertFocused(element, elementDescription, request.message, startTime);
      case "checked":
        return this.assertCheckedState(
          element,
          true,
          elementDescription,
          request.message,
          startTime
        );
      case "unchecked":
        return this.assertCheckedState(
          element,
          false,
          elementDescription,
          request.message,
          startTime
        );
      case "hasText":
        return this.assertTextMatch(
          element,
          request.expected,
          true,
          elementDescription,
          request.message,
          startTime
        );
      case "containsText":
        return this.assertTextMatch(
          element,
          request.expected,
          false,
          elementDescription,
          request.message,
          startTime
        );
      case "hasValue":
        return this.assertValue(
          element,
          request.expected,
          elementDescription,
          request.message,
          startTime
        );
      case "exists":
        return this.createResult(
          element !== null,
          targetStr,
          elementDescription,
          true,
          element !== null,
          element === null ? "Element does not exist" : void 0,
          void 0,
          startTime,
          element?.state
        );
      case "notExists":
        return this.createResult(
          element === null,
          targetStr,
          elementDescription,
          false,
          element === null,
          element !== null ? "Element exists but should not" : void 0,
          void 0,
          startTime,
          element?.state
        );
      case "count":
        return this.assertElementCount(
          request.target,
          request.expected,
          targetStr,
          request.message,
          startTime
        );
      case "attribute":
        return this.assertAttribute(
          element,
          request.attributeName,
          request.expected,
          elementDescription,
          request.message,
          startTime
        );
      case "hasClass":
        return this.assertHasClass(
          element,
          request.expected,
          elementDescription,
          request.message,
          startTime
        );
      case "cssProperty":
        return this.assertCssProperty(
          element,
          request.propertyName,
          request.expected,
          elementDescription,
          request.message,
          startTime
        );
      case "cssPropertyInSet":
        return this.assertCssPropertyInSet(
          element,
          request.propertyName,
          request.allowedValues || [],
          elementDescription,
          request.message,
          startTime
        );
      case "cssPropertyRange":
        return this.assertCssPropertyRange(
          element,
          request.propertyName,
          request.range || {},
          elementDescription,
          request.message,
          startTime
        );
      case "tokenCompliance":
        return this.assertTokenCompliance(
          element,
          request.propertyName,
          request.tokenPath || "",
          request.expected,
          elementDescription,
          request.message,
          startTime
        );
      case "noOverlap": {
        const relatedResult = this.findElementDetailed(
          request.relatedTarget,
          request.fuzzy !== false
        );
        if (!relatedResult) {
          return this.createResult(
            false,
            targetStr,
            elementDescription,
            "no overlap",
            null,
            "Related target element not found",
            "Check if the related target element exists and is properly labeled",
            startTime,
            element?.state
          );
        }
        const rectA = element.state.rect;
        const rectB = relatedResult.element.state.rect;
        if (!rectA || !rectB) {
          return this.createResult(
            false,
            targetStr,
            elementDescription,
            "no overlap",
            null,
            "Rect data not available for one or both elements",
            "Ensure elements have rect data in their state",
            startTime,
            element?.state
          );
        }
        const overlaps = rectA.right > rectB.left && rectA.left < rectB.right && rectA.bottom > rectB.top && rectA.top < rectB.bottom;
        const overlapDesc = overlaps ? `elements overlap (A: ${rectA.left},${rectA.top}-${rectA.right},${rectA.bottom} B: ${rectB.left},${rectB.top}-${rectB.right},${rectB.bottom})` : `no overlap (gap exists)`;
        return this.createResult(
          !overlaps,
          targetStr,
          elementDescription,
          "no overlap",
          overlapDesc,
          overlaps ? "Elements overlap when they should not" : void 0,
          overlaps ? "Adjust element positions or sizes to remove overlap" : void 0,
          startTime,
          element?.state
        );
      }
      case "minSpacing": {
        const relatedResult2 = this.findElementDetailed(
          request.relatedTarget,
          request.fuzzy !== false
        );
        if (!relatedResult2) {
          return this.createResult(
            false,
            targetStr,
            elementDescription,
            `min gap ${request.minGap ?? 0}px`,
            null,
            "Related target element not found",
            "Check if the related target element exists and is properly labeled",
            startTime,
            element?.state
          );
        }
        const rA = element.state.rect;
        const rB = relatedResult2.element.state.rect;
        if (!rA || !rB) {
          return this.createResult(
            false,
            targetStr,
            elementDescription,
            `min gap ${request.minGap ?? 0}px`,
            null,
            "Rect data not available for one or both elements",
            "Ensure elements have rect data in their state",
            startTime,
            element?.state
          );
        }
        const gapLeft = rB.left - rA.right;
        const gapRight = rA.left - rB.right;
        const gapTop = rB.top - rA.bottom;
        const gapBottom = rA.top - rB.bottom;
        const actualGap = Math.max(gapLeft, gapRight, gapTop, gapBottom);
        const requiredGap = request.minGap ?? 0;
        const spacingPassed = actualGap >= requiredGap;
        return this.createResult(
          spacingPassed,
          targetStr,
          elementDescription,
          `min gap ${requiredGap}px`,
          `${actualGap}px`,
          spacingPassed ? void 0 : `Spacing is ${actualGap}px but expected at least ${requiredGap}px`,
          spacingPassed ? void 0 : "Increase margin or padding between elements",
          startTime,
          element?.state
        );
      }
      default:
        return this.createResult(
          false,
          targetStr,
          elementDescription,
          void 0,
          void 0,
          `Unknown assertion type: ${request.type}`,
          void 0,
          startTime
        );
    }
  }
  /**
   * Assert visibility state
   */
  assertVisibility(element, expectedVisible, description, message, startTime = performance.now()) {
    const isVisible = element.state.visible;
    const passed = isVisible === expectedVisible;
    return this.createResult(
      passed,
      element.id,
      description,
      expectedVisible,
      isVisible,
      passed ? void 0 : message || `Element is ${isVisible ? "visible" : "hidden"} but expected ${expectedVisible ? "visible" : "hidden"}`,
      passed ? void 0 : "Check if element is covered by another element or has display:none",
      startTime,
      element.state
    );
  }
  /**
   * Assert enabled state
   */
  assertEnabledState(element, expectedEnabled, description, message, startTime = performance.now()) {
    const isEnabled = element.state.enabled;
    const passed = isEnabled === expectedEnabled;
    return this.createResult(
      passed,
      element.id,
      description,
      expectedEnabled,
      isEnabled,
      passed ? void 0 : message || `Element is ${isEnabled ? "enabled" : "disabled"} but expected ${expectedEnabled ? "enabled" : "disabled"}`,
      passed ? void 0 : "Check if the element has a disabled attribute or aria-disabled",
      startTime,
      element.state
    );
  }
  /**
   * Assert focused state
   */
  assertFocused(element, description, message, startTime = performance.now()) {
    const isFocused = element.state.focused;
    return this.createResult(
      isFocused,
      element.id,
      description,
      true,
      isFocused,
      isFocused ? void 0 : message || "Element is not focused",
      isFocused ? void 0 : "Click or focus the element first",
      startTime,
      element.state
    );
  }
  /**
   * Assert checked state
   */
  assertCheckedState(element, expectedChecked, description, message, startTime = performance.now()) {
    const isChecked = element.state.checked ?? false;
    const passed = isChecked === expectedChecked;
    return this.createResult(
      passed,
      element.id,
      description,
      expectedChecked,
      isChecked,
      passed ? void 0 : message || `Element is ${isChecked ? "checked" : "unchecked"} but expected ${expectedChecked ? "checked" : "unchecked"}`,
      passed ? void 0 : "Click the checkbox to change its state",
      startTime,
      element.state
    );
  }
  /**
   * Assert text content
   */
  assertTextMatch(element, expectedText, exact, description, message, startTime = performance.now()) {
    const actualText = element.state.textContent || "";
    const passed = exact ? actualText === expectedText : actualText.includes(expectedText);
    return this.createResult(
      passed,
      element.id,
      description,
      expectedText,
      actualText,
      passed ? void 0 : message || (exact ? `Text "${actualText}" does not match expected "${expectedText}"` : `Text "${actualText}" does not contain "${expectedText}"`),
      passed ? void 0 : "Verify the element contains the expected text",
      startTime,
      element.state
    );
  }
  /**
   * Assert input value
   */
  assertValue(element, expectedValue, description, message, startTime = performance.now()) {
    const actualValue = element.state.value || "";
    const passed = actualValue === expectedValue;
    return this.createResult(
      passed,
      element.id,
      description,
      expectedValue,
      actualValue,
      passed ? void 0 : message || `Value "${actualValue}" does not match expected "${expectedValue}"`,
      passed ? void 0 : "Type the expected value into the input",
      startTime,
      element.state
    );
  }
  /**
   * Assert element count
   */
  assertElementCount(criteria, expectedCount, targetStr, message, startTime = performance.now()) {
    const searchResponse = this.searchEngine.search(criteria);
    const actualCount = searchResponse.results.length;
    const passed = actualCount === expectedCount;
    return this.createResult(
      passed,
      targetStr,
      `${actualCount} elements matching criteria`,
      expectedCount,
      actualCount,
      passed ? void 0 : message || `Found ${actualCount} elements but expected ${expectedCount}`,
      passed ? void 0 : "Adjust search criteria or wait for elements to load",
      startTime
    );
  }
  /**
   * Assert attribute value (placeholder for DOM attribute assertions)
   */
  assertAttribute(element, attributeName, expectedValue, description, message, startTime = performance.now()) {
    let actualValue;
    switch (attributeName.toLowerCase()) {
      case "placeholder":
        actualValue = element.placeholder;
        break;
      case "title":
        actualValue = element.title;
        break;
      default:
        return this.createResult(
          false,
          element.id,
          description,
          expectedValue,
          void 0,
          `Cannot check attribute "${attributeName}" without DOM access`,
          "Use the server API to check element attributes",
          startTime,
          element.state
        );
    }
    const passed = actualValue === expectedValue;
    return this.createResult(
      passed,
      element.id,
      description,
      expectedValue,
      actualValue,
      passed ? void 0 : message || `Attribute "${attributeName}" is "${actualValue}" but expected "${expectedValue}"`,
      void 0,
      startTime,
      element.state
    );
  }
  /**
   * Assert element has CSS class
   */
  assertHasClass(element, className, description, message, startTime = performance.now()) {
    return this.createResult(
      false,
      element.id,
      description,
      className,
      void 0,
      "Cannot check CSS classes without DOM access",
      "Use the server API to check element classes",
      startTime,
      element.state
    );
  }
  /**
   * Assert CSS property value is in a set of allowed values
   */
  assertCssPropertyInSet(element, propertyName, allowedValues, description, message, startTime = performance.now()) {
    const computedStyles = element.state.computedStyles;
    if (!computedStyles) {
      return this.createResult(
        false,
        element.id,
        description,
        allowedValues,
        void 0,
        "Computed styles not available",
        "Request element state with computed styles",
        startTime,
        element.state
      );
    }
    const styleKey = propertyName;
    const actualValue = computedStyles[styleKey] || "";
    const normalizedActual = actualValue.trim().toLowerCase();
    const passed = allowedValues.some((v) => v.trim().toLowerCase() === normalizedActual);
    return this.createResult(
      passed,
      element.id,
      description,
      allowedValues,
      actualValue,
      passed ? void 0 : message || `CSS property "${propertyName}" is "${actualValue}" but expected one of [${allowedValues.join(", ")}]`,
      void 0,
      startTime,
      element.state
    );
  }
  /**
   * Assert CSS property numeric value is within a range
   */
  assertCssPropertyRange(element, propertyName, range, description, message, startTime = performance.now()) {
    const computedStyles = element.state.computedStyles;
    if (!computedStyles) {
      return this.createResult(
        false,
        element.id,
        description,
        range,
        void 0,
        "Computed styles not available",
        "Request element state with computed styles",
        startTime,
        element.state
      );
    }
    const styleKey = propertyName;
    const actualValue = computedStyles[styleKey] || "";
    const numericValue = parseFloat(actualValue);
    if (isNaN(numericValue)) {
      return this.createResult(
        false,
        element.id,
        description,
        range,
        actualValue,
        `Cannot parse "${actualValue}" as a number for range check`,
        void 0,
        startTime,
        element.state
      );
    }
    const aboveMin = range.min === void 0 || numericValue >= range.min;
    const belowMax = range.max === void 0 || numericValue <= range.max;
    const passed = aboveMin && belowMax;
    return this.createResult(
      passed,
      element.id,
      description,
      range,
      numericValue,
      passed ? void 0 : message || `CSS property "${propertyName}" is ${numericValue} but expected range [${range.min ?? "-\u221E"}, ${range.max ?? "\u221E"}]`,
      void 0,
      startTime,
      element.state
    );
  }
  /**
   * Assert CSS property matches a design token value.
   * Note: Token resolution requires the token value to be provided as `expected`.
   */
  assertTokenCompliance(element, propertyName, tokenPath, expectedTokenValue, description, message, startTime = performance.now()) {
    const computedStyles = element.state.computedStyles;
    if (!computedStyles) {
      return this.createResult(
        false,
        element.id,
        description,
        expectedTokenValue,
        void 0,
        "Computed styles not available",
        "Request element state with computed styles",
        startTime,
        element.state
      );
    }
    if (expectedTokenValue === void 0) {
      return this.createResult(
        false,
        element.id,
        description,
        void 0,
        void 0,
        `Token value not provided for "${tokenPath}"`,
        "Provide the resolved token value in the expected field",
        startTime,
        element.state
      );
    }
    const styleKey = propertyName;
    const actualValue = (computedStyles[styleKey] || "").trim().toLowerCase();
    const expectedStr = String(expectedTokenValue).trim().toLowerCase();
    const passed = actualValue === expectedStr;
    return this.createResult(
      passed,
      element.id,
      description,
      `${expectedTokenValue} (token: ${tokenPath})`,
      actualValue,
      passed ? void 0 : message || `CSS property "${propertyName}" is "${actualValue}" but expected token "${tokenPath}" (${expectedTokenValue})`,
      void 0,
      startTime,
      element.state
    );
  }
  /**
   * Assert CSS property value
   */
  assertCssProperty(element, propertyName, expectedValue, description, message, startTime = performance.now()) {
    const computedStyles = element.state.computedStyles;
    if (!computedStyles) {
      return this.createResult(
        false,
        element.id,
        description,
        expectedValue,
        void 0,
        "Computed styles not available",
        "Request element state with computed styles",
        startTime,
        element.state
      );
    }
    const styleKey = propertyName;
    const actualValue = computedStyles[styleKey];
    const passed = actualValue === expectedValue;
    return this.createResult(
      passed,
      element.id,
      description,
      expectedValue,
      actualValue,
      passed ? void 0 : message || `CSS property "${propertyName}" is "${actualValue}" but expected "${expectedValue}"`,
      void 0,
      startTime,
      element.state
    );
  }
  /**
   * Create an assertion result
   */
  createResult(passed, target, targetDescription, expected, actual, failureReason, suggestion, startTime = performance.now(), elementState) {
    return {
      passed,
      target,
      targetDescription,
      expected,
      actual,
      failureReason,
      suggestion: this.config.includeSuggestions ? suggestion : void 0,
      elementState,
      durationMs: performance.now() - startTime,
      timestamp: Date.now()
    };
  }
};
function createAssertionExecutor(config) {
  return new AssertionExecutor(config);
}

// src/ai/region-segmentation.ts
var DEFAULT_REGION_SEGMENTATION_CONFIG = {
  minRegionElements: 1,
  headerFraction: 0.12,
  footerFraction: 0.9,
  sidebarFraction: 0.2
};
function toBounded(el) {
  const rect = el.state?.rect;
  if (!rect) return null;
  return {
    element: el,
    x: rect.x ?? 0,
    y: rect.y ?? 0,
    width: rect.width ?? 0,
    height: rect.height ?? 0
  };
}
function classifyRegionType(el, relativeY, relativeX, config = DEFAULT_REGION_SEGMENTATION_CONFIG) {
  const role = (el.role || "").toLowerCase();
  const semanticType = (el.semanticType || "").toLowerCase();
  const tag = (el.tagName || "").toLowerCase();
  if (role === "navigation" || role === "nav" || tag === "nav") {
    return { type: "navigation", confidence: 0.95 };
  }
  if (role === "banner" || tag === "header") {
    return { type: "header", confidence: 0.95 };
  }
  if (role === "contentinfo" || tag === "footer") {
    return { type: "footer", confidence: 0.95 };
  }
  if (role === "main" || tag === "main") {
    return { type: "main-content", confidence: 0.95 };
  }
  if (role === "complementary" || tag === "aside") {
    return { type: "sidebar", confidence: 0.9 };
  }
  if (role === "form" || tag === "form") {
    return { type: "form", confidence: 0.9 };
  }
  if (role === "table" || tag === "table") {
    return { type: "table", confidence: 0.9 };
  }
  if (role === "dialog" || role === "alertdialog") {
    return { type: "modal", confidence: 0.95 };
  }
  if (role === "toolbar") {
    return { type: "toolbar", confidence: 0.9 };
  }
  if (semanticType.includes("card")) {
    return { type: "card", confidence: 0.8 };
  }
  if (relativeY < config.headerFraction) {
    return { type: "header", confidence: 0.6 };
  }
  if (relativeY > config.footerFraction) {
    return { type: "footer", confidence: 0.6 };
  }
  if (relativeX < config.sidebarFraction) {
    return { type: "sidebar", confidence: 0.5 };
  }
  return { type: "main-content", confidence: 0.3 };
}
function segmentPageRegions(elements, config = DEFAULT_REGION_SEGMENTATION_CONFIG) {
  const bounded = elements.map(toBounded).filter((b) => b !== null);
  if (bounded.length === 0) {
    return { regions: [], assignedCount: 0, unassignedIds: elements.map((e) => e.id) };
  }
  let maxX = 0;
  let maxY = 0;
  for (const b of bounded) {
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  if (maxX === 0) maxX = 1;
  if (maxY === 0) maxY = 1;
  const regionGroups = /* @__PURE__ */ new Map();
  const unassignedIds = [];
  for (const b of bounded) {
    const relativeX = b.x / maxX;
    const relativeY = b.y / maxY;
    const { type, confidence } = classifyRegionType(b.element, relativeY, relativeX, config);
    if (!regionGroups.has(type)) {
      regionGroups.set(type, { elements: [], confidences: [] });
    }
    regionGroups.get(type).elements.push(b);
    regionGroups.get(type).confidences.push(confidence);
  }
  const regions = [];
  let assignedCount = 0;
  for (const [type, group] of regionGroups) {
    if (group.elements.length < config.minRegionElements) {
      for (const b of group.elements) unassignedIds.push(b.element.id);
      continue;
    }
    let minX = Infinity, minY = Infinity, maxRX = 0, maxRY = 0;
    const elementIds = [];
    for (const b of group.elements) {
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxRX = Math.max(maxRX, b.x + b.width);
      maxRY = Math.max(maxRY, b.y + b.height);
      elementIds.push(b.element.id);
    }
    const avgConfidence = group.confidences.reduce((a, b) => a + b, 0) / group.confidences.length;
    regions.push({
      type,
      bounds: { x: minX, y: minY, width: maxRX - minX, height: maxRY - minY },
      elementIds,
      label: type.replace("-", " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      confidence: Math.round(avgConfidence * 100) / 100
    });
    assignedCount += elementIds.length;
  }
  return { regions, assignedCount, unassignedIds };
}

// src/ai/semantic-snapshot.ts
var DEFAULT_SNAPSHOT_CONFIG = {
  analyzeForms: true,
  detectModals: true,
  inferPageType: true,
  generateDescriptions: true,
  maxElements: 500,
  useAnnotations: true,
  includeForms: false,
  maxTokens: 0
};
var _SemanticSnapshotManager = class _SemanticSnapshotManager {
  constructor(config = {}) {
    this.history = [];
    this.maxHistorySize = 10;
    this.snapshotCounter = 0;
    this.config = { ...DEFAULT_SNAPSHOT_CONFIG, ...config };
    this.searchEngine = new SearchEngine();
  }
  /**
   * Create a semantic snapshot from a control snapshot.
   *
   * @param controlSnapshot - The control-level snapshot of registered elements.
   * @param pageContext - Optional partial page context to merge in.
   * @param formsResponse - Pre-built FormsResponse from `discoverForms()`.
   *   When provided **and** `config.includeForms` is `true`, this is
   *   attached to the snapshot as `formsDetail`.
   */
  createSnapshot(controlSnapshot, pageContext, formsResponse) {
    const snapshotId = `snapshot-${++this.snapshotCounter}-${Date.now()}`;
    const aiElements = this.convertElements(controlSnapshot.elements);
    this.searchEngine.updateElements(aiElements);
    const fullPageContext = this.buildPageContext(aiElements, pageContext);
    const forms = this.config.analyzeForms ? this.analyzeForms(aiElements) : [];
    const modals = this.config.detectModals ? this.detectModals(aiElements) : [];
    const elementCounts = this.countElementTypes(aiElements);
    const summary = generatePageSummary(aiElements, fullPageContext);
    const focusedElement = aiElements.find((el) => el.state.focused)?.id;
    let budgetedElements = aiElements.slice(0, this.config.maxElements);
    if (this.config.maxTokens > 0) {
      budgetedElements = this.applyTokenBudget(budgetedElements, this.config.maxTokens);
    }
    const snapshot = {
      timestamp: Date.now(),
      snapshotId,
      page: fullPageContext,
      elements: budgetedElements,
      forms,
      activeModals: modals,
      focusedElement,
      summary,
      elementCounts
    };
    if (formsResponse) {
      snapshot.formsDetail = formsResponse;
    }
    this.addToHistory(snapshot);
    return snapshot;
  }
  /**
   * Get the last snapshot
   */
  getLastSnapshot() {
    if (this.history.length === 0) return null;
    return this.history[this.history.length - 1].snapshot;
  }
  /**
   * Get snapshot by ID
   */
  getSnapshot(snapshotId) {
    const entry = this.history.find((h) => h.snapshot.snapshotId === snapshotId);
    return entry?.snapshot || null;
  }
  /**
   * Get snapshot history
   */
  getHistory() {
    return this.history.map((h) => h.snapshot);
  }
  /**
   * Clear history
   */
  clearHistory() {
    this.history = [];
  }
  /**
   * Convert control snapshot elements to AI elements
   */
  convertElements(elements) {
    return elements.map((el) => this.convertElement(el));
  }
  /**
   * Convert a single element to AI element
   */
  convertElement(element) {
    const isContent = element.category === "content";
    const aliases = generateAliases({
      textContent: element.state.textContent,
      elementType: element.type,
      id: element.id,
      labelText: element.label
    });
    let description;
    if (isContent && element.contentMetadata) {
      description = this.generateContentDescription(element);
    } else if (this.config.generateDescriptions) {
      description = generateDescription({
        textContent: element.state.textContent,
        elementType: element.type,
        id: element.id,
        labelText: element.label
      });
    } else {
      description = element.label || element.id;
    }
    const purpose = isContent ? generatePurpose({ textContent: element.state.textContent, elementType: element.type }) : generatePurpose({ textContent: element.state.textContent, elementType: element.type });
    const suggestedActions = isContent ? generateSuggestedActions({
      textContent: element.state.textContent,
      elementType: element.type
    }) : generateSuggestedActions({
      textContent: element.state.textContent,
      elementType: element.type
    });
    let finalDescription = description;
    let finalPurpose = purpose;
    let finalAliases = aliases;
    if (this.config.useAnnotations) {
      const annotation = getGlobalAnnotationStore().get(element.id);
      if (annotation) {
        if (annotation.description) {
          finalDescription = annotation.description;
        }
        if (annotation.purpose) {
          finalPurpose = annotation.purpose;
        }
        if (annotation.tags && annotation.tags.length > 0) {
          const tagSet = /* @__PURE__ */ new Set([...finalAliases, ...annotation.tags.map((t) => t.toLowerCase())]);
          finalAliases = [...tagSet];
        }
      }
    }
    return {
      id: element.id,
      type: element.type,
      label: element.label,
      tagName: this.inferTagName(element.type),
      role: this.inferRole(element.type),
      accessibleName: element.label || element.state.textContent?.trim(),
      actions: element.actions,
      state: element.state,
      registered: true,
      description: finalDescription,
      aliases: finalAliases,
      purpose: finalPurpose,
      suggestedActions,
      semanticType: this.inferSemanticType(element),
      category: element.category,
      contentMetadata: element.contentMetadata
    };
  }
  /**
   * Generate a content-specific description
   */
  generateContentDescription(element) {
    const meta = element.contentMetadata;
    const text = element.state.textContent?.trim() || "";
    const truncatedText = text.length > 60 ? text.substring(0, 57) + "..." : text;
    if (!meta) return `"${truncatedText}"`;
    switch (meta.contentRole) {
      case "heading":
        return `Level ${meta.headingLevel || "?"} heading: '${truncatedText}'`;
      case "table-cell":
        return `Table cell${meta.structuralContext ? ` (${meta.structuralContext})` : ""}: '${truncatedText}'`;
      case "table-header":
        return `Table header${meta.structuralContext ? ` (${meta.structuralContext})` : ""}: '${truncatedText}'`;
      case "status":
        return `Status message: '${truncatedText}'`;
      case "badge":
        return `Badge: '${truncatedText}'`;
      case "metric":
        return `Metric value: '${truncatedText}'`;
      case "body-text":
        return `Text: '${truncatedText}'`;
      case "list-item":
        return `List item: '${truncatedText}'`;
      case "quote":
        return `Blockquote: '${truncatedText}'`;
      case "code":
        return `Code block: '${truncatedText}'`;
      case "caption":
        return `Caption: '${truncatedText}'`;
      case "label":
        return `Label: '${truncatedText}'`;
      case "description":
        return `Description: '${truncatedText}'`;
      case "navigation":
        return `Navigation text: '${truncatedText}'`;
      default:
        return `Content: '${truncatedText}'`;
    }
  }
  /**
   * Build full page context
   */
  buildPageContext(elements, partial) {
    const url = partial?.url || (typeof window !== "undefined" ? window.location.href : "");
    const title = partial?.title || (typeof document !== "undefined" ? document.title : "");
    const pageType = this.config.inferPageType ? inferPageType(url, title, elements) : partial?.pageType || "unknown";
    const activeModals = elements.filter((el) => el.type === "dialog" && el.state.visible).map((el) => el.id);
    return {
      url,
      title,
      pageType,
      activeModals: partial?.activeModals || activeModals,
      focusedElement: partial?.focusedElement || elements.find((el) => el.state.focused)?.id,
      navigation: partial?.navigation,
      pathname: partial?.pathname,
      pageName: partial?.pageName,
      section: partial?.section,
      breadcrumb: partial?.breadcrumb,
      routePattern: partial?.routePattern,
      routeParams: partial?.routeParams
    };
  }
  /**
   * Analyze forms in the snapshot
   */
  analyzeForms(elements) {
    const forms = [];
    const formElements = elements.filter((el) => el.type === "form");
    if (formElements.length === 0) {
      const implicitForm = this.detectImplicitForm(elements);
      if (implicitForm) {
        forms.push(implicitForm);
      }
    } else {
      for (const form of formElements) {
        const formState = this.analyzeForm(form, elements);
        if (formState) {
          forms.push(formState);
        }
      }
    }
    return forms;
  }
  /**
   * Detect implicit form from inputs
   */
  detectImplicitForm(elements) {
    const inputs = elements.filter(
      (el) => el.type === "input" || el.type === "textarea" || el.type === "select" || el.type === "checkbox"
    );
    if (inputs.length === 0) return null;
    const submitButton = elements.find(
      (el) => el.type === "button" && el.state.visible && (el.semanticType === "submit-button" || el.state.textContent?.toLowerCase().match(/submit|save|send|continue/))
    );
    const fields = this.analyzeFormFields(inputs);
    const hasErrors = fields.some((f) => !f.valid);
    return {
      id: "implicit-form",
      purpose: this.inferFormPurpose(inputs),
      fields,
      isValid: !hasErrors,
      submitButton: submitButton?.id,
      isDirty: fields.some((f) => f.isDirty)
    };
  }
  /**
   * Analyze a specific form
   */
  analyzeForm(form, allElements) {
    const inputs = allElements.filter(
      (el) => (el.type === "input" || el.type === "textarea" || el.type === "select") && el.state.visible
    );
    const fields = this.analyzeFormFields(inputs);
    const hasErrors = fields.some((f) => !f.valid);
    const submitButton = allElements.find(
      (el) => el.type === "button" && el.state.visible && el.semanticType === "submit-button"
    );
    return {
      id: form.id,
      name: form.label,
      purpose: form.purpose,
      fields,
      isValid: !hasErrors,
      submitButton: submitButton?.id,
      isDirty: fields.some((f) => f.isDirty)
    };
  }
  /**
   * Analyze form fields
   */
  analyzeFormFields(inputs) {
    return inputs.map((input) => {
      const valid = input.state.validationState ? input.state.validationState.valid : true;
      const error = input.state.validationState?.validationMessage || void 0;
      return {
        id: input.id,
        label: input.accessibleName || input.label || input.id,
        type: input.type,
        value: input.state.value || "",
        valid,
        error,
        required: input.state.required ?? false,
        touched: input.state.focused || (input.state.value?.length || 0) > 0,
        placeholder: void 0,
        // Not available from AIDiscoveredElement
        isDirty: (input.state.value?.length || 0) > 0,
        checked: input.state.checked,
        selectedOptions: input.state.selectedOptions,
        constraints: input.state.constraints
      };
    });
  }
  /**
   * Detect modal dialogs
   */
  detectModals(elements) {
    const modals = [];
    const dialogElements = elements.filter((el) => el.type === "dialog" && el.state.visible);
    for (const dialog of dialogElements) {
      const closeButton = elements.find(
        (el) => el.type === "button" && el.state.visible && (el.semanticType === "cancel-button" || el.state.textContent?.toLowerCase().match(/close|cancel|x|dismiss/))
      );
      const primaryAction = elements.find(
        (el) => el.type === "button" && el.state.visible && el.semanticType === "submit-button"
      );
      modals.push({
        id: dialog.id,
        title: dialog.accessibleName || dialog.label,
        type: this.inferModalType(dialog),
        blocking: true,
        // Assume dialogs are blocking
        closeButton: closeButton?.id,
        primaryAction: primaryAction?.id
      });
    }
    return modals;
  }
  /**
   * Infer modal type
   */
  inferModalType(dialog) {
    const text = (dialog.accessibleName || dialog.state.textContent || "").toLowerCase();
    if (text.includes("alert") || text.includes("warning") || text.includes("error")) {
      return "alert";
    }
    if (text.includes("confirm") || text.includes("are you sure")) {
      return "confirm";
    }
    if (text.includes("prompt") || text.includes("enter")) {
      return "prompt";
    }
    return "dialog";
  }
  /**
   * Count elements by type
   */
  countElementTypes(elements) {
    const counts = {};
    for (const el of elements) {
      const type = el.type.toLowerCase();
      counts[type] = (counts[type] || 0) + 1;
    }
    return counts;
  }
  /**
   * Infer form purpose from fields
   */
  inferFormPurpose(fields) {
    const labels = fields.map((f) => (f.accessibleName || f.label || "").toLowerCase());
    const allLabels = labels.join(" ");
    if (allLabels.includes("email") && allLabels.includes("password")) {
      if (allLabels.includes("confirm") || allLabels.includes("name")) {
        return "Registration";
      }
      return "Login";
    }
    if (allLabels.includes("search")) return "Search";
    if (allLabels.includes("address") || allLabels.includes("city")) return "Address";
    if (allLabels.includes("card") || allLabels.includes("payment")) return "Payment";
    if (allLabels.includes("contact") || allLabels.includes("message")) return "Contact";
    return "Form";
  }
  /**
   * Infer tag name from element type
   */
  inferTagName(type) {
    const typeMap = {
      button: "button",
      input: "input",
      textarea: "textarea",
      select: "select",
      checkbox: "input",
      radio: "input",
      link: "a",
      form: "form",
      dialog: "dialog"
    };
    return typeMap[type] || "div";
  }
  /**
   * Infer ARIA role from element type
   */
  inferRole(type) {
    const roleMap = {
      button: "button",
      input: "textbox",
      textarea: "textbox",
      select: "combobox",
      checkbox: "checkbox",
      radio: "radio",
      link: "link",
      dialog: "dialog",
      menu: "menu",
      menuitem: "menuitem",
      tab: "tab"
    };
    return roleMap[type];
  }
  /**
   * Infer semantic type
   */
  inferSemanticType(element) {
    if (element.category === "content" && element.contentMetadata) {
      const role = element.contentMetadata.contentRole;
      if (role === "heading" && element.contentMetadata.headingLevel) {
        return `heading-${element.contentMetadata.headingLevel}`;
      }
      return role;
    }
    const text = (element.state.textContent || element.label || "").toLowerCase();
    const type = element.type.toLowerCase();
    if (type === "button") {
      if (text.match(/submit|save|confirm|ok|done|apply/)) return "submit-button";
      if (text.match(/cancel|close|dismiss/)) return "cancel-button";
      if (text.match(/delete|remove|trash/)) return "delete-button";
      if (text.match(/add|create|new|\+/)) return "add-button";
      if (text.match(/edit|modify/)) return "edit-button";
      if (text.match(/next|continue/)) return "next-button";
      if (text.match(/back|previous/)) return "back-button";
      return "action-button";
    }
    if (type === "input") {
      if (text.includes("email") || element.id.includes("email")) return "email-input";
      if (text.includes("password") || element.id.includes("password")) return "password-input";
      if (text.includes("search") || element.id.includes("search")) return "search-input";
      return "text-input";
    }
    return type;
  }
  /**
   * Estimate token count from serialized JSON length.
   * Uses ~4 characters per token as a rough approximation.
   */
  estimateTokens(elements) {
    let charCount = 0;
    for (const el of elements) {
      charCount += (el.id?.length ?? 0) + (el.type?.length ?? 0);
      charCount += (el.label?.length ?? 0) + (el.description?.length ?? 0);
      charCount += el.purpose?.length ?? 0;
      if (el.aliases) charCount += el.aliases.join(",").length;
      if (el.suggestedActions) charCount += el.suggestedActions.join(",").length;
      charCount += 100;
      if (el.contentMetadata) charCount += 50;
    }
    return Math.ceil(charCount / 4);
  }
  /**
   * Apply token budget by pruning low-priority elements.
   * Uses region classification to determine which elements to keep.
   * Interactive elements in main-content are prioritized highest.
   */
  applyTokenBudget(elements, maxTokens) {
    if (this.estimateTokens(elements) <= maxTokens) {
      return elements;
    }
    const scored = elements.map((el) => {
      const viewportHeight = (typeof window !== "undefined" ? window.innerHeight : 0) || 800;
      const viewportWidth = (typeof window !== "undefined" ? window.innerWidth : 0) || 1280;
      const relativeY = (el.state?.rect?.y ?? 0) / viewportHeight;
      const relativeX = (el.state?.rect?.x ?? 0) / viewportWidth;
      const region = classifyRegionType(el, relativeY, relativeX);
      const regionPriority = _SemanticSnapshotManager.REGION_PRIORITY[region.type] ?? 50;
      const interactiveBoost = el.type === "content" ? 0 : 20;
      const visibleBoost = el.state?.visible ? 10 : 0;
      const focusBoost = el.state?.focused ? 30 : 0;
      return {
        element: el,
        priority: regionPriority + interactiveBoost + visibleBoost + focusBoost
      };
    });
    scored.sort((a, b) => b.priority - a.priority);
    const result = [];
    let currentTokens = 0;
    for (const { element } of scored) {
      const elementTokens = this.estimateTokens([element]);
      if (currentTokens + elementTokens > maxTokens && result.length > 0) {
        break;
      }
      result.push(element);
      currentTokens += elementTokens;
    }
    return result;
  }
  addToHistory(snapshot) {
    this.history.push({
      snapshot,
      timestamp: Date.now()
    });
    if (this.history.length > this.maxHistorySize) {
      this.history = this.history.slice(-this.maxHistorySize);
    }
  }
};
/**
 * Add snapshot to history
 */
/**
 * Region priority for token budget pruning.
 * Higher priority regions are kept; lower priority regions are pruned first.
 */
_SemanticSnapshotManager.REGION_PRIORITY = {
  "main-content": 100,
  form: 90,
  modal: 85,
  table: 80,
  card: 75,
  toolbar: 70,
  navigation: 50,
  sidebar: 40,
  header: 30,
  footer: 20,
  unknown: 10
};
var SemanticSnapshotManager = _SemanticSnapshotManager;
function createSnapshotManager(config) {
  return new SemanticSnapshotManager(config);
}

// src/ai/semantic-diff.ts
var DEFAULT_DIFF_CONFIG = {
  ignoreInsignificant: true,
  trackedProperties: ["visible", "enabled", "focused", "checked", "value", "textContent"],
  generateSuggestions: true,
  maxModifications: 20
};
var INSIGNIFICANT_PROPERTIES = /* @__PURE__ */ new Set(["rect", "computedStyles", "innerHTML"]);
function computeDiff(fromSnapshot, toSnapshot, config = {}) {
  const startTime = performance.now();
  const finalConfig = { ...DEFAULT_DIFF_CONFIG, ...config };
  const fromElements = new Map(fromSnapshot.elements.map((el) => [el.id, el]));
  const toElements = new Map(toSnapshot.elements.map((el) => [el.id, el]));
  const appeared = [];
  for (const [id, element] of toElements) {
    if (!fromElements.has(id)) {
      appeared.push({
        elementId: id,
        description: element.description,
        type: element.type,
        semanticType: element.semanticType
      });
    }
  }
  const disappeared = [];
  for (const [id, element] of fromElements) {
    if (!toElements.has(id)) {
      disappeared.push({
        elementId: id,
        description: element.description,
        type: element.type,
        semanticType: element.semanticType
      });
    }
  }
  const modified = [];
  for (const [id, toElement] of toElements) {
    const fromElement = fromElements.get(id);
    if (fromElement) {
      const modifications = compareElements(fromElement, toElement, finalConfig);
      modified.push(...modifications);
    }
  }
  const limitedModifications = modified.slice(0, finalConfig.maxModifications);
  const probableTrigger = detectTrigger(appeared, disappeared, limitedModifications);
  const suggestedActions = finalConfig.generateSuggestions ? generateSuggestedActionsFromDiff(appeared, disappeared, limitedModifications, probableTrigger) : void 0;
  const pageChanges = detectPageChanges(fromSnapshot, toSnapshot);
  const contentChanges = detectContentChanges(fromElements, toElements);
  const summary = generateDiffSummary(
    appeared.map((e) => e.description),
    disappeared.map((e) => e.description),
    limitedModifications
  );
  return {
    summary,
    fromSnapshotId: fromSnapshot.snapshotId,
    toSnapshotId: toSnapshot.snapshotId,
    changes: {
      appeared,
      disappeared,
      modified: limitedModifications
    },
    contentChanges: contentChanges || void 0,
    probableTrigger,
    suggestedActions,
    pageChanges,
    durationMs: performance.now() - startTime,
    timestamp: Date.now()
  };
}
function compareElements(fromElement, toElement, config) {
  const modifications = [];
  for (const property of config.trackedProperties) {
    const fromValue = getPropertyValue(fromElement, property);
    const toValue = getPropertyValue(toElement, property);
    if (fromValue !== toValue) {
      const isSignificant = isSignificantChange(property, fromValue, toValue);
      if (!config.ignoreInsignificant || isSignificant) {
        modifications.push({
          elementId: toElement.id,
          description: toElement.description,
          property,
          from: formatValue(fromValue),
          to: formatValue(toValue),
          significant: isSignificant
        });
      }
    }
  }
  return modifications;
}
function getPropertyValue(element, property) {
  if (property in element.state) {
    return element.state[property];
  }
  return element[property];
}
function isSignificantChange(property, fromValue, toValue) {
  if (INSIGNIFICANT_PROPERTIES.has(property)) {
    return false;
  }
  if (property === "visible") {
    return true;
  }
  if (property === "enabled") {
    return true;
  }
  if (property === "focused") {
    return true;
  }
  if (property === "checked") {
    return true;
  }
  if (property === "value") {
    return Boolean(fromValue) || Boolean(toValue);
  }
  if (property === "textContent") {
    const fromText = String(fromValue || "");
    const toText = String(toValue || "");
    return fromText.trim() !== toText.trim();
  }
  return true;
}
function formatValue(value) {
  if (value === void 0) return "undefined";
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") {
    if (value.length > 50) {
      return value.substring(0, 47) + "...";
    }
    return value;
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "[object]";
    }
  }
  return String(value);
}
function detectTrigger(appeared, disappeared, modified) {
  const hasNewErrors = appeared.some(
    (e) => e.description.toLowerCase().includes("error") || e.type === "error"
  );
  if (hasNewErrors) {
    return "Form validation";
  }
  const hasNewModal = appeared.some(
    (e) => e.type === "dialog" || e.semanticType?.includes("dialog")
  );
  if (hasNewModal) {
    return "Modal opened";
  }
  const hasModalDismissed = disappeared.some(
    (e) => e.type === "dialog" || e.semanticType?.includes("dialog")
  );
  if (hasModalDismissed) {
    return "Modal closed";
  }
  const hasLoading = modified.some((m) => m.description.toLowerCase().includes("loading"));
  if (hasLoading) {
    return "Loading state change";
  }
  const hasFocusChange = modified.some((m) => m.property === "focused");
  if (hasFocusChange && modified.length <= 2) {
    return "Focus changed";
  }
  const hasValueChange = modified.some((m) => m.property === "value");
  if (hasValueChange && modified.length <= 2) {
    return "User input";
  }
  const visibilityChanges = modified.filter((m) => m.property === "visible");
  if (visibilityChanges.length > 0 && visibilityChanges.length <= 5) {
    return "UI expansion/collapse";
  }
  if (appeared.length > 5) {
    return "Page navigation";
  }
  return void 0;
}
function detectPageChanges(fromSnapshot, toSnapshot) {
  const urlChanged = fromSnapshot.page.url !== toSnapshot.page.url;
  const titleChanged = fromSnapshot.page.title !== toSnapshot.page.title;
  if (!urlChanged && !titleChanged) {
    return void 0;
  }
  return {
    urlChanged,
    titleChanged,
    newUrl: urlChanged ? toSnapshot.page.url : void 0,
    newTitle: titleChanged ? toSnapshot.page.title : void 0
  };
}
function generateSuggestedActionsFromDiff(appeared, disappeared, modified, trigger) {
  const suggestions = [];
  if (trigger === "Form validation") {
    suggestions.push("Fix the validation errors before submitting");
  }
  if (trigger === "Modal opened") {
    const modal = appeared.find((e) => e.type === "dialog" || e.semanticType?.includes("dialog"));
    if (modal) {
      suggestions.push(`Interact with the "${modal.description}" dialog`);
    }
  }
  if (trigger === "Modal closed") {
    suggestions.push("Continue with the main page interaction");
  }
  for (const element of appeared.slice(0, 3)) {
    if (element.type === "button" && element.semanticType === "submit-button") {
      suggestions.push(`Click the "${element.description}" to proceed`);
    }
    if (element.description.toLowerCase().includes("error")) {
      suggestions.push(`Address the error: ${element.description}`);
    }
  }
  for (const mod of modified.slice(0, 3)) {
    if (mod.property === "enabled" && mod.to === "true") {
      suggestions.push(`"${mod.description}" is now enabled`);
    }
    if (mod.property === "visible" && mod.to === "true") {
      suggestions.push(`"${mod.description}" is now visible`);
    }
  }
  return suggestions.slice(0, 5);
}
var SemanticDiffManager = class {
  constructor(config = {}) {
    this.lastSnapshot = null;
    this.config = { ...DEFAULT_DIFF_CONFIG, ...config };
  }
  /**
   * Update with new snapshot and get diff
   */
  update(newSnapshot) {
    if (!this.lastSnapshot) {
      this.lastSnapshot = newSnapshot;
      return null;
    }
    const diff = computeDiff(this.lastSnapshot, newSnapshot, this.config);
    this.lastSnapshot = newSnapshot;
    return diff;
  }
  /**
   * Get diff from a specific snapshot to current
   */
  diffFrom(fromSnapshot) {
    if (!this.lastSnapshot) return null;
    return computeDiff(fromSnapshot, this.lastSnapshot, this.config);
  }
  /**
   * Reset the manager
   */
  reset() {
    this.lastSnapshot = null;
  }
  /**
   * Get the last known snapshot
   */
  getLastSnapshot() {
    return this.lastSnapshot;
  }
};
function createDiffManager(config) {
  return new SemanticDiffManager(config);
}
function hasSignificantChanges(diff) {
  if (diff.changes.appeared.length > 0) return true;
  if (diff.changes.disappeared.length > 0) return true;
  if (diff.changes.modified.some((m) => m.significant)) return true;
  if (diff.pageChanges?.urlChanged) return true;
  if (diff.contentChanges) {
    const cc = diff.contentChanges;
    if (cc.textChanges.length > 0) return true;
    if (cc.metricChanges.some((m) => m.significant)) return true;
    if (cc.statusChanges.length > 0) return true;
  }
  return false;
}
function describeDiff(diff) {
  const parts = [];
  if (diff.changes.appeared.length > 0) {
    parts.push(`${diff.changes.appeared.length} elements appeared`);
  }
  if (diff.changes.disappeared.length > 0) {
    parts.push(`${diff.changes.disappeared.length} elements disappeared`);
  }
  const significantMods = diff.changes.modified.filter((m) => m.significant);
  if (significantMods.length > 0) {
    parts.push(`${significantMods.length} elements modified`);
  }
  if (diff.pageChanges?.urlChanged) {
    parts.push("URL changed");
  }
  if (diff.contentChanges) {
    parts.push(diff.contentChanges.summary);
  }
  if (parts.length === 0) {
    return "No significant changes";
  }
  return parts.join(", ");
}
var METRIC_CONTENT_TYPES = /* @__PURE__ */ new Set(["metric-value"]);
var STATUS_CONTENT_TYPES = /* @__PURE__ */ new Set(["status-message", "badge"]);
var HEADING_CONTENT_TYPES = /* @__PURE__ */ new Set(["heading"]);
function isContentElement(element) {
  return element.category === "content" || element.contentMetadata !== void 0;
}
function getContentType(element) {
  if (element.contentMetadata?.contentRole) {
    return element.contentMetadata.contentRole;
  }
  return element.type;
}
function detectContentChanges(fromElements, toElements) {
  const textChanges = [];
  const metricChanges = [];
  const statusChanges = [];
  for (const [id, toElement] of toElements) {
    const fromElement = fromElements.get(id);
    if (fromElement) {
      if (isContentElement(toElement) || isContentElement(fromElement)) {
        const fromText = (fromElement.state.textContent || "").trim();
        const toText = (toElement.state.textContent || "").trim();
        if (fromText !== toText) {
          const contentType = getContentType(toElement);
          const label = toElement.description || toElement.accessibleName || id;
          if (METRIC_CONTENT_TYPES.has(contentType) || contentType === "metric") {
            const parsed = parseMetricChange(fromText, toText, id, label);
            if (parsed) {
              metricChanges.push(parsed);
            }
          } else if (STATUS_CONTENT_TYPES.has(contentType) || contentType === "status") {
            statusChanges.push({
              elementId: id,
              label,
              oldStatus: fromText,
              newStatus: toText,
              direction: classifyStatusDirection(fromText, toText)
            });
          } else {
            textChanges.push({
              elementId: id,
              contentType,
              oldText: fromText,
              newText: toText,
              changeType: "modified"
            });
          }
        }
      }
    } else {
      if (isContentElement(toElement)) {
        const toText = (toElement.state.textContent || "").trim();
        if (toText) {
          textChanges.push({
            elementId: id,
            contentType: getContentType(toElement),
            oldText: "",
            newText: toText,
            changeType: "added"
          });
        }
      }
    }
  }
  for (const [id, fromElement] of fromElements) {
    if (!toElements.has(id) && isContentElement(fromElement)) {
      const fromText = (fromElement.state.textContent || "").trim();
      if (fromText) {
        textChanges.push({
          elementId: id,
          contentType: getContentType(fromElement),
          oldText: fromText,
          newText: "",
          changeType: "removed"
        });
      }
    }
  }
  if (textChanges.length === 0 && metricChanges.length === 0 && statusChanges.length === 0) {
    return null;
  }
  return {
    textChanges,
    metricChanges,
    statusChanges,
    summary: generateContentChangeSummary(textChanges, metricChanges, statusChanges)
  };
}
function parseNumericValue(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  let working = trimmed;
  let negate = false;
  if (working.startsWith("(") && working.endsWith(")")) {
    working = working.slice(1, -1).trim();
    negate = true;
  }
  if (working.startsWith("-")) {
    negate = !negate;
    working = working.slice(1).trim();
  }
  if (working.startsWith("+")) {
    working = working.slice(1).trim();
  }
  working = working.replace(/^[£€¥₹$]/, "").trim();
  const isPercent = working.endsWith("%");
  if (isPercent) {
    working = working.slice(0, -1).trim();
  }
  working = working.replace(/\s*(ms|s|m|h|d|hrs?|mins?|secs?|days?)$/i, "").trim();
  working = working.replace(/,/g, "");
  const num = Number(working);
  if (isNaN(num) || !isFinite(num) || working === "") {
    return null;
  }
  return negate ? -num : num;
}
function parseMetricChange(fromText, toText, elementId, label) {
  const fromNum = parseNumericValue(fromText);
  const toNum = parseNumericValue(toText);
  let numericDelta;
  let percentChange;
  let significant = false;
  if (fromNum !== null && toNum !== null) {
    numericDelta = toNum - fromNum;
    if (fromNum !== 0) {
      percentChange = (toNum - fromNum) / Math.abs(fromNum) * 100;
    }
    if (percentChange !== void 0 && Math.abs(percentChange) > 10) {
      significant = true;
    }
    if (fromNum > 0 && toNum < 0) significant = true;
    if (fromNum < 0 && toNum > 0) significant = true;
    if (fromNum === 0 && toNum !== 0) significant = true;
    if (fromNum !== 0 && toNum === 0) significant = true;
  } else {
    significant = fromText !== toText;
  }
  return {
    elementId,
    label,
    oldValue: fromText,
    newValue: toText,
    numericDelta,
    percentChange: percentChange !== void 0 ? Math.round(percentChange * 100) / 100 : void 0,
    significant
  };
}
var STATUS_PROGRESSIONS = [
  [
    "failed",
    "error",
    "pending",
    "queued",
    "running",
    "in progress",
    "completed",
    "success",
    "done"
  ],
  ["disconnected", "connecting", "connected"],
  ["unhealthy", "degraded", "healthy"],
  ["offline", "online"],
  ["inactive", "active"],
  ["disabled", "enabled"],
  ["down", "up"],
  ["stopped", "starting", "started", "running"],
  ["closed", "open"],
  ["blocked", "unblocked"],
  ["rejected", "pending", "approved"],
  ["critical", "warning", "info", "ok"],
  ["red", "yellow", "green"]
];
function classifyStatusDirection(oldStatus, newStatus) {
  const oldLower = oldStatus.toLowerCase().trim();
  const newLower = newStatus.toLowerCase().trim();
  for (const progression of STATUS_PROGRESSIONS) {
    let oldIndex = -1;
    let newIndex = -1;
    for (let i = 0; i < progression.length; i++) {
      if (oldLower.includes(progression[i])) oldIndex = i;
      if (newLower.includes(progression[i])) newIndex = i;
    }
    if (oldIndex >= 0 && newIndex >= 0 && oldIndex !== newIndex) {
      return newIndex > oldIndex ? "improved" : "degraded";
    }
  }
  return "neutral";
}
function generateContentChangeSummary(textChanges, metricChanges, statusChanges) {
  const parts = [];
  const modified = textChanges.filter((t) => t.changeType === "modified").length;
  const added = textChanges.filter((t) => t.changeType === "added").length;
  const removed = textChanges.filter((t) => t.changeType === "removed").length;
  const headingChanges = textChanges.filter(
    (t) => HEADING_CONTENT_TYPES.has(t.contentType) || t.contentType === "heading"
  );
  if (headingChanges.length > 0) {
    parts.push(`${headingChanges.length} heading${headingChanges.length > 1 ? "s" : ""} changed`);
  }
  if (metricChanges.length > 0) {
    const significantMetrics = metricChanges.filter((m) => m.significant);
    if (significantMetrics.length > 0) {
      parts.push(
        `${significantMetrics.length} metric${significantMetrics.length > 1 ? "s" : ""} changed significantly`
      );
    } else {
      parts.push(`${metricChanges.length} metric${metricChanges.length > 1 ? "s" : ""} changed`);
    }
  }
  if (statusChanges.length > 0) {
    const degraded = statusChanges.filter((s) => s.direction === "degraded");
    const improved = statusChanges.filter((s) => s.direction === "improved");
    if (degraded.length > 0) {
      parts.push(`${degraded.length} status${degraded.length > 1 ? "es" : ""} degraded`);
    }
    if (improved.length > 0) {
      parts.push(`${improved.length} status${improved.length > 1 ? "es" : ""} improved`);
    }
    const neutral = statusChanges.length - degraded.length - improved.length;
    if (neutral > 0 && degraded.length === 0 && improved.length === 0) {
      parts.push(`${neutral} status${neutral > 1 ? "es" : ""} changed`);
    }
  }
  const otherModified = modified - headingChanges.filter((h) => h.changeType === "modified").length;
  if (otherModified > 0) {
    parts.push(`${otherModified} text${otherModified > 1 ? " values" : " value"} modified`);
  }
  if (added > 0) {
    parts.push(`${added} content${added > 1 ? " elements" : " element"} added`);
  }
  if (removed > 0) {
    parts.push(`${removed} content${removed > 1 ? " elements" : " element"} removed`);
  }
  if (parts.length === 0) {
    return "No content changes";
  }
  return parts.join(", ");
}

// src/ai/data-extraction.ts
var DEFAULT_DATA_EXTRACTION_CONFIG = {
  minConfidence: 0.3,
  normalizeWhitespace: true
};
function classifyDataType(value) {
  const trimmed = value.trim();
  if (!trimmed) return { type: "unknown", confidence: 0 };
  if (/^(true|false|yes|no|on|off)$/i.test(trimmed)) {
    return { type: "boolean", confidence: 0.95 };
  }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { type: "email", confidence: 0.95 };
  }
  if (/^https?:\/\/\S+/.test(trimmed)) {
    return { type: "url", confidence: 0.95 };
  }
  if (/^[+]?[\d\s\-().]{7,20}$/.test(trimmed) && /\d{3,}/.test(trimmed)) {
    return { type: "phone", confidence: 0.7 };
  }
  if (/^[£$€¥₹][\s]?[\d,.]+$/.test(trimmed) || /^[\d,.]+[\s]?[£$€¥₹]$/.test(trimmed)) {
    return { type: "currency", confidence: 0.9 };
  }
  if (/^[\d,.]+\s?%$/.test(trimmed)) {
    return { type: "percentage", confidence: 0.95 };
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed) || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(trimmed) || /^\d{1,2}\.\d{1,2}\.\d{2,4}$/.test(trimmed) || /^\w{3,9}\s+\d{1,2},?\s+\d{4}$/.test(trimmed)) {
    return { type: "date", confidence: 0.85 };
  }
  if (/^-?[\d,]+\.?\d*$/.test(trimmed) && trimmed !== "") {
    return { type: "number", confidence: 0.9 };
  }
  return { type: "text", confidence: 0.5 };
}
function normalizeValue(value, dataType) {
  const trimmed = value.trim();
  switch (dataType) {
    case "number":
    case "currency":
    case "percentage": {
      const numeric = trimmed.replace(/[^0-9.-]/g, "");
      const parsed = parseFloat(numeric);
      return isNaN(parsed) ? trimmed.toLowerCase() : parsed.toString();
    }
    case "date": {
      const d = new Date(trimmed);
      return isNaN(d.getTime()) ? trimmed.toLowerCase() : d.toISOString().split("T")[0];
    }
    case "boolean":
      return /^(true|yes|on)$/i.test(trimmed) ? "true" : "false";
    case "email":
      return trimmed.toLowerCase();
    case "url":
      return trimmed.replace(/\/+$/, "").toLowerCase();
    case "phone":
      return trimmed.replace(/[^\d+]/g, "");
    default:
      return trimmed.toLowerCase().replace(/\s+/g, " ");
  }
}
function extractElementValue(element) {
  const state = element.state;
  if (state?.value !== void 0 && state.value !== "") {
    return String(state.value);
  }
  if (state?.textContent !== void 0 && state.textContent !== "") {
    return String(state.textContent);
  }
  return "";
}
function extractLabel(element) {
  return element.accessibleName || element.labelText || element.label || element.description || element.id;
}
function extractPageData(elements, config = DEFAULT_DATA_EXTRACTION_CONFIG) {
  const values = {};
  let extractedCount = 0;
  for (const element of elements) {
    const rawValue = extractElementValue(element);
    if (!rawValue) continue;
    const label = extractLabel(element);
    const { type: dataType, confidence } = classifyDataType(rawValue);
    if (confidence < config.minConfidence) continue;
    const normalizedValue = normalizeValue(rawValue, dataType);
    values[label] = {
      elementId: element.id,
      label,
      rawValue: config.normalizeWhitespace ? rawValue.replace(/\s+/g, " ").trim() : rawValue,
      normalizedValue,
      dataType,
      confidence
    };
    extractedCount++;
  }
  return {
    values,
    scannedCount: elements.length,
    extractedCount
  };
}

// src/ai/table-extraction.ts
var DEFAULT_TABLE_EXTRACTION_CONFIG = {
  minTableColumns: 2,
  minTableRows: 2,
  minListItems: 2,
  columnTolerance: 20,
  rowTolerance: 10
};
function getElementBounds(el) {
  const rect = el.state?.rect;
  if (!rect || rect.width === 0) return null;
  const text = el.state?.textContent ?? el.state?.value ?? "";
  if (!text) return null;
  return {
    element: el,
    x: rect.x ?? 0,
    y: rect.y ?? 0,
    width: rect.width ?? 0,
    height: rect.height ?? 0,
    text: text.trim()
  };
}
function clusterPositions(values, tolerance) {
  if (values.length === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const clusters = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - clusters[clusters.length - 1] > tolerance) {
      clusters.push(sorted[i]);
    }
  }
  return clusters;
}
function assignToCluster(value, clusters, tolerance) {
  let best = 0;
  let bestDist = Math.abs(value - clusters[0]);
  for (let i = 1; i < clusters.length; i++) {
    const dist = Math.abs(value - clusters[i]);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return bestDist <= tolerance ? best : -1;
}
function detectTable(elements, config = DEFAULT_TABLE_EXTRACTION_CONFIG) {
  const withBounds = elements.map(getElementBounds).filter((b) => b !== null);
  if (withBounds.length < config.minTableColumns * config.minTableRows) return null;
  const xPositions = withBounds.map((b) => b.x);
  const yPositions = withBounds.map((b) => b.y);
  const columnClusters = clusterPositions(xPositions, config.columnTolerance);
  const rowClusters = clusterPositions(yPositions, config.rowTolerance);
  if (columnClusters.length < config.minTableColumns || rowClusters.length < config.minTableRows) {
    return null;
  }
  const grid = Array.from(
    { length: rowClusters.length },
    () => Array(columnClusters.length).fill(null)
  );
  for (const b of withBounds) {
    const col = assignToCluster(b.x, columnClusters, config.columnTolerance);
    const row = assignToCluster(b.y, rowClusters, config.rowTolerance);
    if (col >= 0 && row >= 0 && grid[row][col] === null) {
      grid[row][col] = b.text;
    }
  }
  const headers = grid[0].map((h) => h ?? "");
  const columns = headers.map((header, index) => {
    const bodyCells = grid.slice(1).map((r) => r[index]).filter((c) => c !== null);
    const types = bodyCells.map((c) => classifyDataType(c).type);
    const mostCommon = mode(types) ?? "text";
    return { header, index, dataType: mostCommon };
  });
  const rows = grid.slice(1).map((row) => row.map((cell) => cell ?? ""));
  return {
    label: headers[0] || "Table",
    columns,
    rows
  };
}
function detectList(elements, config = DEFAULT_TABLE_EXTRACTION_CONFIG) {
  const withBounds = elements.map(getElementBounds).filter((b) => b !== null);
  if (withBounds.length < config.minListItems) return null;
  const sorted = [...withBounds].sort((a, b) => a.y - b.y);
  const yPositions = sorted.map((b) => b.y);
  const rowClusters = clusterPositions(yPositions, config.rowTolerance);
  if (rowClusters.length < config.minListItems) return null;
  const rowGroups = /* @__PURE__ */ new Map();
  for (const b of sorted) {
    const row = assignToCluster(b.y, rowClusters, config.rowTolerance);
    if (row >= 0) {
      if (!rowGroups.has(row)) rowGroups.set(row, []);
      rowGroups.get(row).push(b);
    }
  }
  const items = [];
  const fieldLabels = [];
  let fieldLabelsInitialized = false;
  for (const [, rowElements] of [...rowGroups.entries()].sort(([a], [b]) => a - b)) {
    const sortedRow = [...rowElements].sort((a, b) => a.x - b.x);
    const item = {};
    for (let i = 0; i < sortedRow.length; i++) {
      const label = `field_${i}`;
      if (!fieldLabelsInitialized) fieldLabels.push(label);
      item[label] = sortedRow[i].text;
    }
    fieldLabelsInitialized = true;
    items.push(item);
  }
  if (items.length < config.minListItems) return null;
  const fields = fieldLabels.map((label) => {
    const values = items.map((item) => item[label]).filter(Boolean);
    const types = values.map((v) => classifyDataType(v).type);
    return { label, dataType: mode(types) ?? "text" };
  });
  return {
    label: "List",
    fields,
    items
  };
}
function extractStructuredData(elements, config = DEFAULT_TABLE_EXTRACTION_CONFIG) {
  const tables = [];
  const lists = [];
  const table = detectTable(elements, config);
  if (table) {
    tables.push(table);
  }
  const listCandidates = elements.filter((el) => {
    const role = el.role || el.type;
    return ["listitem", "row", "option", "link", "button"].includes(role);
  });
  if (listCandidates.length >= config.minListItems) {
    const list = detectList(listCandidates, config);
    if (list) {
      lists.push(list);
    }
  }
  return { tables, lists };
}
function mode(arr) {
  if (arr.length === 0) return void 0;
  const counts = /* @__PURE__ */ new Map();
  let best = arr[0];
  let bestCount = 0;
  for (const v of arr) {
    const c = (counts.get(v) ?? 0) + 1;
    counts.set(v, c);
    if (c > bestCount) {
      bestCount = c;
      best = v;
    }
  }
  return best;
}

// src/ai/bookmarks.ts
var BookmarkStore = class {
  constructor(maxBookmarks = 50) {
    this.bookmarks = /* @__PURE__ */ new Map();
    this.maxBookmarks = Math.max(1, maxBookmarks);
  }
  /**
   * Configure the eviction cap. The store keeps the configured number of
   * most-recently-saved bookmarks. Overwriting an existing name does not
   * count toward the cap.
   */
  setMaxBookmarks(max) {
    this.maxBookmarks = Math.max(1, max);
    while (this.bookmarks.size > this.maxBookmarks) {
      const oldest = this.findOldestKey();
      if (oldest === null) break;
      this.bookmarks.delete(oldest);
    }
  }
  /** Save (or overwrite) a bookmark. Returns the stored entry. */
  save(entry) {
    if (this.bookmarks.size >= this.maxBookmarks && !this.bookmarks.has(entry.name)) {
      const oldest = this.findOldestKey();
      if (oldest !== null) {
        this.bookmarks.delete(oldest);
      }
    }
    this.bookmarks.set(entry.name, entry);
    return entry;
  }
  /** Get a bookmark by name, or null if missing. */
  get(name) {
    return this.bookmarks.get(name) ?? null;
  }
  /** Returns true if the named bookmark exists. */
  has(name) {
    return this.bookmarks.has(name);
  }
  /** Delete a bookmark. Returns true if it existed. */
  delete(name) {
    return this.bookmarks.delete(name);
  }
  /** List bookmark names in insertion order. */
  listNames() {
    return [...this.bookmarks.keys()];
  }
  /** List all bookmark entries in insertion order. */
  list() {
    return [...this.bookmarks.values()];
  }
  /** Number of bookmarks currently stored. */
  size() {
    return this.bookmarks.size;
  }
  /** Remove every bookmark. Returns the number cleared. */
  clear() {
    const n = this.bookmarks.size;
    this.bookmarks.clear();
    return n;
  }
  findOldestKey() {
    let oldestKey = null;
    let oldestSavedAt = Number.POSITIVE_INFINITY;
    for (const [key, entry] of this.bookmarks) {
      if (entry.savedAt < oldestSavedAt) {
        oldestSavedAt = entry.savedAt;
        oldestKey = key;
      }
    }
    return oldestKey;
  }
};
var globalStore2 = null;
function getGlobalBookmarkStore() {
  if (!globalStore2) {
    globalStore2 = new BookmarkStore();
  }
  return globalStore2;
}
function __resetGlobalBookmarkStoreForTest(maxBookmarks) {
  globalStore2 = new BookmarkStore(maxBookmarks);
  return globalStore2;
}

// src/ai/change-tracker.ts
var DEFAULT_CONFIG = {
  defaultSettleTimeout: 5e3,
  defaultSettleMinStable: 300,
  defaultPollInterval: 200,
  defaultWaitTimeout: 1e4,
  maxBufferSize: 1e3,
  maxBookmarks: 50
};
var ChangeTracker = class {
  constructor(deps, config) {
    // Bookmarks — backed by the process-wide singleton store
    // (`getGlobalBookmarkStore()`). Previously this was a per-instance Map,
    // but parallel code paths (the SDK browser dispatcher and the runner-side
    // ChangeTracker) each owned their own map, so a `POST /ai/bookmarks` save
    // wasn't visible to a follow-up `GET /ai/bookmarks` list resolved through
    // the other path. The singleton ensures every reader/writer hits the
    // same backing storage. See B2 / `ai/bookmarks.ts`.
    // Change buffer — DOM mutations and SPA route changes share the same
    // buffer so a drain returns them interleaved by `recordedAt`. The DOM
    // entry shape is unchanged for backward compatibility; route entries
    // carry `type: "route-change"` as a discriminator (P1.3).
    this.changeBuffer = [];
    this.bufferEnabled = false;
    this.bufferSequence = 0;
    this.bufferEnabledAt = 0;
    // Tier 3.3: Extended change-buffer sub-lists
    this.domMutationBuffer = [];
    this.consoleErrorBuffer = [];
    this.networkRequestBuffer = [];
    // Tier 3.3: Active subscriptions / observers (live while buffer is enabled)
    this.mutationObserver = null;
    this.unsubscribeBrowserEvents = null;
    this.unsubscribeNetworkEvents = null;
    // Phase 2a: Tauri events sub-buffer. Only populated inside a Tauri webview
    // (guarded by `window.__TAURI_INTERNALS__`). `@tauri-apps/api` is loaded via
    // dynamic import so non-Tauri hosts don't pay for the dependency.
    this.tauriEventBuffer = [];
    this.tauriEventNames = [];
    this.tauriEventUnlisteners = [];
    this.tauriEventBufferCap = 200;
    // Recent route-change ring buffer — always on, independent of `bufferEnabled`.
    // Used by `/ai/wait-for-route-change` to resolve immediately when a matching
    // navigation happened between the HTTP request arriving and the subscription
    // being attached.
    this.recentRouteChanges = [];
    this.recentRouteChangesCap = 100;
    // Listeners fired synchronously from `pushRouteChange`. Independent of the
    // buffer-enabled gate so consumers like wait-for-route-change can subscribe
    // without first having to toggle the change buffer.
    this.routeChangeListeners = /* @__PURE__ */ new Set();
    // Last diff for categorization
    this.lastDiff = null;
    this.deps = deps;
    this.config = { ...DEFAULT_CONFIG, ...config };
    getGlobalBookmarkStore().setMaxBookmarks(this.config.maxBookmarks);
  }
  // ==========================================================================
  // Feature 1: Action-Integrated Diffing
  // ==========================================================================
  /**
   * Execute an action and return the diff of what changed.
   *
   * Flow: snapshot before → execute action → wait for idle → snapshot after → diff
   */
  async executeWithDiff(request) {
    const startTime = performance.now();
    let changeReceivedDuringAction = false;
    const unsubscribeChanges = this.deps.subscribeChanges?.(() => {
      changeReceivedDuringAction = true;
    });
    this.deps.refreshElements?.();
    const beforeControl = this.deps.createControlSnapshot();
    const beforeSnapshot = this.deps.snapshotManager.createSnapshot(beforeControl);
    let actionResult;
    let actionSuccess;
    if (request.instruction && this.deps.executeNLAction) {
      const nlResult = await this.deps.executeNLAction(request.instruction);
      actionResult = nlResult;
      actionSuccess = nlResult.success;
    } else if (request.elementAction && this.deps.executeElementAction) {
      const result = await this.deps.executeElementAction(request.elementAction.elementId, {
        action: request.elementAction.action,
        params: request.elementAction.params
      });
      actionResult = result;
      actionSuccess = result !== null && typeof result === "object" && "success" in result && result.success;
    } else {
      throw new Error(
        "Either instruction (with executeNLAction) or elementAction (with executeElementAction) must be provided"
      );
    }
    const settleTimeout = request.settleTimeout ?? this.config.defaultSettleTimeout;
    const settleMinStable = request.settleMinStable ?? this.config.defaultSettleMinStable;
    let settleTimedOut = false;
    let timeline;
    if (request.timeline) {
      timeline = await this.recordTimeline(
        beforeSnapshot,
        startTime,
        settleTimeout,
        settleMinStable,
        request.timelineInterval ?? 100,
        request.scope
      );
      settleTimedOut = !timeline.settled;
    } else if (this.deps.idleDetector) {
      try {
        await this.deps.idleDetector.waitForIdle({
          timeout: settleTimeout,
          minStableMs: settleMinStable
        });
      } catch {
        settleTimedOut = true;
      }
    } else {
      await sleep(settleMinStable);
    }
    this.deps.refreshElements?.();
    const afterControl = this.deps.createControlSnapshot();
    const afterSnapshot = this.deps.snapshotManager.createSnapshot(afterControl);
    let diff;
    if (this.deps.subscribeChanges && !changeReceivedDuringAction && afterControl.elements?.length === beforeControl.elements?.length) {
      diff = computeDiff(beforeSnapshot, afterSnapshot, this.config.diffConfig);
    } else if (request.scope) {
      diff = this.computeScopedDiff(beforeSnapshot, afterSnapshot, request.scope);
    } else {
      diff = computeDiff(beforeSnapshot, afterSnapshot, this.config.diffConfig);
    }
    const categorize = request.categorize !== false;
    const categorized = categorize ? this.categorizeChanges(diff) : void 0;
    this.lastDiff = diff;
    if (this.bufferEnabled) {
      this.appendToBuffer(diff, categorized?.category ?? this.categorizeChanges(diff).category);
    }
    const budgetSummary = request.summaryBudget != null ? this.summarizeDiff(diff, {
      budget: request.summaryBudget,
      includeCategory: !!categorized
    }) : void 0;
    const structuredChanges = request.analyzeStructured ? analyzeStructuredChanges(beforeSnapshot, afterSnapshot) : void 0;
    unsubscribeChanges?.();
    return {
      actionSuccess,
      actionResult,
      beforeSnapshot,
      afterSnapshot,
      diff,
      categorized,
      timeline,
      settleTimedOut,
      budgetSummary,
      structuredChanges,
      durationMs: performance.now() - startTime,
      timestamp: Date.now()
    };
  }
  // ==========================================================================
  // Feature 2: waitForChange
  // ==========================================================================
  /**
   * Wait for a specific change condition to be met.
   *
   * Polls at configurable intervals, computing diffs until the predicate matches.
   */
  async waitForChange(predicate, options) {
    const timeout = options?.timeout ?? this.config.defaultWaitTimeout;
    const startTime = performance.now();
    this.deps.refreshElements?.();
    const baselineControl = this.deps.createControlSnapshot();
    const baselineSnapshot = this.deps.snapshotManager.createSnapshot(baselineControl);
    if (this.deps.subscribeChanges) {
      return this.waitForChangePush(predicate, baselineSnapshot, options, startTime, timeout);
    }
    return this.waitForChangePoll(predicate, baselineSnapshot, options, startTime, timeout);
  }
  /**
   * Push-based path: subscribe to change events, snapshot + diff only when
   * a change event arrives. Safety-net poll at 2000ms to catch missed events.
   */
  async waitForChangePush(predicate, baselineSnapshot, options, startTime, timeout) {
    const safetyPollMs = 2e3;
    let changeReceived = false;
    let unsubscribe = null;
    try {
      unsubscribe = this.deps.subscribeChanges(() => {
        changeReceived = true;
      });
      while (performance.now() - startTime < timeout) {
        await sleep(
          changeReceived ? 0 : Math.min(safetyPollMs, timeout - (performance.now() - startTime))
        );
        changeReceived = false;
        const diff = this.snapshotAndDiff(baselineSnapshot, options);
        if (this.matchesPredicate(diff, predicate)) {
          this.lastDiff = diff;
          if (this.bufferEnabled) {
            this.appendToBuffer(diff, this.categorizeChanges(diff).category);
          }
          return diff;
        }
      }
    } finally {
      unsubscribe?.();
    }
    return this.timeoutWithDiff(baselineSnapshot, options, timeout);
  }
  /**
   * Polling path: original behavior — poll at defaultPollInterval (200ms).
   */
  async waitForChangePoll(predicate, baselineSnapshot, options, startTime, timeout) {
    const interval = options?.interval ?? this.config.defaultPollInterval;
    while (performance.now() - startTime < timeout) {
      await sleep(interval);
      const diff = this.snapshotAndDiff(baselineSnapshot, options);
      if (this.matchesPredicate(diff, predicate)) {
        this.lastDiff = diff;
        if (this.bufferEnabled) {
          this.appendToBuffer(diff, this.categorizeChanges(diff).category);
        }
        return diff;
      }
    }
    return this.timeoutWithDiff(baselineSnapshot, options, timeout);
  }
  /** Snapshot current state and diff against baseline. */
  snapshotAndDiff(baselineSnapshot, options) {
    this.deps.refreshElements?.();
    const currentControl = this.deps.createControlSnapshot();
    const currentSnapshot = this.deps.snapshotManager.createSnapshot(currentControl);
    if (options?.scope) {
      return this.computeScopedDiff(baselineSnapshot, currentSnapshot, options.scope);
    }
    return computeDiff(baselineSnapshot, currentSnapshot, this.config.diffConfig);
  }
  /** Handle timeout: capture final diff and throw. */
  timeoutWithDiff(baselineSnapshot, options, timeout) {
    const finalDiff = this.snapshotAndDiff(baselineSnapshot, options);
    this.lastDiff = finalDiff;
    throw new Error(
      `waitForChange timed out after ${timeout}ms. Changes detected: ${finalDiff.changes.appeared.length} appeared, ${finalDiff.changes.disappeared.length} disappeared, ${finalDiff.changes.modified.length} modified`
    );
  }
  /**
   * Check if a diff matches a predicate
   */
  matchesPredicate(diff, predicate) {
    if (predicate.anySignificantChange) {
      if (hasSignificantChanges(diff)) return true;
    }
    if (predicate.elementAppeared !== void 0) {
      const matcher = predicate.elementAppeared;
      if (typeof matcher === "string") {
        const found = diff.changes.appeared.some(
          (e) => e.elementId === matcher || e.description.toLowerCase().includes(matcher.toLowerCase())
        );
        if (found) return true;
      } else {
        const found = diff.changes.appeared.some((e) => {
          if (matcher.text && !e.description.toLowerCase().includes(matcher.text.toLowerCase())) {
            return false;
          }
          if (matcher.type && e.type !== matcher.type) {
            return false;
          }
          return true;
        });
        if (found) return true;
      }
    }
    if (predicate.elementDisappeared !== void 0) {
      const found = diff.changes.disappeared.some(
        (e) => e.elementId === predicate.elementDisappeared || e.description.toLowerCase().includes(predicate.elementDisappeared.toLowerCase())
      );
      if (found) return true;
    }
    if (predicate.propertyChanged) {
      const { elementId, property, expectedValue } = predicate.propertyChanged;
      const found = diff.changes.modified.some((m) => {
        if (m.elementId !== elementId) return false;
        if (m.property !== property) return false;
        if (expectedValue !== void 0 && m.to !== expectedValue) return false;
        return true;
      });
      if (found) return true;
    }
    if (predicate.textContains) {
      const { elementId, text } = predicate.textContains;
      const textLower = text.toLowerCase();
      if (elementId) {
        const found = diff.changes.modified.some(
          (m) => m.elementId === elementId && m.property === "textContent" && m.to.toLowerCase().includes(textLower)
        );
        if (found) return true;
        const appeared = diff.changes.appeared.some(
          (e) => e.elementId === elementId && e.description.toLowerCase().includes(textLower)
        );
        if (appeared) return true;
      } else {
        const inModified = diff.changes.modified.some(
          (m) => m.property === "textContent" && m.to.toLowerCase().includes(textLower)
        );
        if (inModified) return true;
        const inAppeared = diff.changes.appeared.some(
          (e) => e.description.toLowerCase().includes(textLower)
        );
        if (inAppeared) return true;
        if (diff.contentChanges) {
          const inText = diff.contentChanges.textChanges.some(
            (t) => t.newText.toLowerCase().includes(textLower)
          );
          if (inText) return true;
        }
      }
    }
    if (predicate.category) {
      const categorized = this.categorizeChanges(diff);
      if (categorized.category === predicate.category || categorized.secondaryCategories.includes(predicate.category)) {
        return true;
      }
    }
    if (predicate.elementCount) {
      const { min, type, text } = predicate.elementCount;
      const matchingAppeared = diff.changes.appeared.filter((e) => {
        if (type && e.type !== type) return false;
        if (text && !e.description.toLowerCase().includes(text.toLowerCase())) return false;
        return true;
      });
      if (matchingAppeared.length >= min) return true;
    }
    if (predicate.urlChanged) {
      if (diff.pageChanges?.urlChanged) return true;
    }
    if (predicate.urlContains) {
      if (diff.pageChanges?.urlChanged && diff.pageChanges.newUrl?.toLowerCase().includes(predicate.urlContains.toLowerCase())) {
        return true;
      }
    }
    if (predicate.formValid) {
      const { formId } = predicate.formValid;
      const errorAppeared = diff.changes.appeared.some((e) => {
        const desc = e.description.toLowerCase();
        const inScope = !formId || e.elementId.toLowerCase().includes(formId.toLowerCase());
        return inScope && (desc.includes("error") || desc.includes("invalid") || desc.includes("validation"));
      });
      const errorDisappeared = diff.changes.disappeared.some((e) => {
        const desc = e.description.toLowerCase();
        const inScope = !formId || e.elementId.toLowerCase().includes(formId.toLowerCase());
        return inScope && (desc.includes("error") || desc.includes("invalid") || desc.includes("validation"));
      });
      if (errorDisappeared && !errorAppeared) return true;
    }
    if (predicate.statusChanged) {
      const { elementId, direction, newStatus } = predicate.statusChanged;
      if (diff.contentChanges?.statusChanges) {
        const found = diff.contentChanges.statusChanges.some((s) => {
          if (elementId && s.elementId !== elementId) return false;
          if (direction && s.direction !== direction) return false;
          if (newStatus && !s.newStatus.toLowerCase().includes(newStatus.toLowerCase()))
            return false;
          return true;
        });
        if (found) return true;
      }
    }
    return false;
  }
  // ==========================================================================
  // Feature: Change Timeline
  // ==========================================================================
  /**
   * Record a timeline of changes during the settle period.
   *
   * Takes intermediate snapshots at regular intervals and records what changed
   * at each step, producing a time-ordered sequence of events.
   */
  async recordTimeline(beforeSnapshot, actionStartTime, settleTimeout, settleMinStable, intervalMs, scope) {
    const events = [];
    let lastSnapshot = beforeSnapshot;
    let stableMs = 0;
    let settled = false;
    const timelineStart = performance.now();
    events.push({
      offsetMs: 0,
      type: "action",
      summary: "Action executed"
    });
    while (performance.now() - timelineStart < settleTimeout) {
      await sleep(intervalMs);
      const offsetMs = Math.round(performance.now() - actionStartTime);
      this.deps.refreshElements?.();
      const control = this.deps.createControlSnapshot();
      const currentSnapshot = this.deps.snapshotManager.createSnapshot(control);
      const incrementalDiff = scope ? this.computeScopedDiff(lastSnapshot, currentSnapshot, scope) : computeDiff(lastSnapshot, currentSnapshot, this.config.diffConfig);
      const hasChanges = hasSignificantChanges(incrementalDiff);
      if (hasChanges) {
        stableMs = 0;
        if (incrementalDiff.changes.appeared.length > 0) {
          events.push({
            offsetMs,
            type: "elements-appeared",
            summary: `${incrementalDiff.changes.appeared.length} element(s) appeared`,
            elementIds: incrementalDiff.changes.appeared.map((e) => e.elementId),
            count: incrementalDiff.changes.appeared.length
          });
        }
        if (incrementalDiff.changes.disappeared.length > 0) {
          events.push({
            offsetMs,
            type: "elements-disappeared",
            summary: `${incrementalDiff.changes.disappeared.length} element(s) disappeared`,
            elementIds: incrementalDiff.changes.disappeared.map((e) => e.elementId),
            count: incrementalDiff.changes.disappeared.length
          });
        }
        const significantMods = incrementalDiff.changes.modified.filter((m) => m.significant);
        if (significantMods.length > 0) {
          events.push({
            offsetMs,
            type: "elements-modified",
            summary: `${significantMods.length} element(s) modified`,
            elementIds: significantMods.map((m) => m.elementId),
            count: significantMods.length
          });
        }
        if (incrementalDiff.pageChanges?.urlChanged) {
          events.push({
            offsetMs,
            type: "page-changed",
            summary: `URL changed to ${incrementalDiff.pageChanges.newUrl ?? "unknown"}`
          });
        }
        lastSnapshot = currentSnapshot;
      } else {
        stableMs += intervalMs;
        if (stableMs >= settleMinStable) {
          settled = true;
          events.push({
            offsetMs,
            type: "settled",
            summary: `UI settled after ${stableMs}ms of stability`
          });
          break;
        }
      }
    }
    return {
      events,
      settleMs: Math.round(performance.now() - timelineStart),
      settled
    };
  }
  // ==========================================================================
  // Feature 3: Semantic Change Categories
  // ==========================================================================
  /**
   * Classify a diff into a semantic category.
   */
  categorizeChanges(diff) {
    const scores = {
      navigation: 0,
      feedback: 0,
      "data-update": 0,
      "ui-state": 0,
      loading: 0,
      "no-op": 0
    };
    if (!hasSignificantChanges(diff)) {
      return {
        category: "no-op",
        confidence: 1,
        secondaryCategories: [],
        diff
      };
    }
    if (diff.pageChanges?.urlChanged) {
      scores.navigation += 0.8;
    }
    if (diff.changes.appeared.length > 10 && diff.changes.disappeared.length > 10) {
      scores.navigation += 0.4;
    }
    if (diff.probableTrigger === "Page navigation") {
      scores.navigation += 0.6;
    }
    const feedbackAppeared = diff.changes.appeared.filter((e) => {
      const desc = e.description.toLowerCase();
      return desc.includes("error") || desc.includes("success") || desc.includes("warning") || desc.includes("toast") || desc.includes("notification") || desc.includes("alert") || desc.includes("validation") || e.type === "dialog";
    });
    if (feedbackAppeared.length > 0) {
      scores.feedback += 0.3 + Math.min(feedbackAppeared.length * 0.2, 0.5);
    }
    if (diff.probableTrigger === "Form validation") {
      scores.feedback += 0.6;
    }
    if (diff.probableTrigger === "Modal opened" || diff.probableTrigger === "Modal closed") {
      scores.feedback += 0.3;
    }
    if (diff.contentChanges?.statusChanges && diff.contentChanges.statusChanges.length > 0) {
      scores.feedback += 0.3;
    }
    if (diff.contentChanges?.metricChanges && diff.contentChanges.metricChanges.length > 0) {
      scores["data-update"] += 0.3 + Math.min(diff.contentChanges.metricChanges.length * 0.15, 0.5);
    }
    if (diff.contentChanges?.textChanges) {
      const dataTextChanges = diff.contentChanges.textChanges.filter(
        (t) => t.changeType === "modified"
      );
      if (dataTextChanges.length > 0) {
        scores["data-update"] += 0.2 + Math.min(dataTextChanges.length * 0.1, 0.4);
      }
    }
    const visibilityMods = diff.changes.modified.filter(
      (m) => m.property === "visible" || m.property === "enabled" || m.property === "checked"
    );
    if (visibilityMods.length > 0) {
      scores["ui-state"] += 0.3 + Math.min(visibilityMods.length * 0.15, 0.5);
    }
    if (diff.probableTrigger === "UI expansion/collapse" || diff.probableTrigger === "Focus changed") {
      scores["ui-state"] += 0.4;
    }
    const loadingAppeared = diff.changes.appeared.filter((e) => {
      const desc = e.description.toLowerCase();
      return desc.includes("loading") || desc.includes("spinner") || desc.includes("skeleton") || desc.includes("progress");
    });
    const loadingDisappeared = diff.changes.disappeared.filter((e) => {
      const desc = e.description.toLowerCase();
      return desc.includes("loading") || desc.includes("spinner") || desc.includes("skeleton") || desc.includes("progress");
    });
    if (loadingAppeared.length > 0 || loadingDisappeared.length > 0) {
      scores.loading += 0.5 + Math.min((loadingAppeared.length + loadingDisappeared.length) * 0.15, 0.4);
    }
    if (diff.probableTrigger === "Loading state change") {
      scores.loading += 0.5;
    }
    const sortedCategories = Object.entries(scores).filter(([, score]) => score > 0).sort(([, a], [, b]) => b - a);
    if (sortedCategories.length === 0) {
      return {
        category: "ui-state",
        confidence: 0.3,
        secondaryCategories: [],
        diff
      };
    }
    const [primary, primaryScore] = sortedCategories[0];
    const secondaryCategories = sortedCategories.slice(1).filter(([, score]) => score > 0.2).map(([cat]) => cat);
    const confidence = Math.min(primaryScore, 1);
    return {
      category: primary,
      confidence,
      secondaryCategories,
      diff
    };
  }
  /**
   * Categorize the last computed diff (convenience for the server handler).
   */
  categorizeLastDiff() {
    if (!this.lastDiff) return null;
    return this.categorizeChanges(this.lastDiff);
  }
  // ==========================================================================
  // Feature: Budget-Aware Diff Summary
  // ==========================================================================
  /**
   * Generate a text summary of a diff that fits within a character budget.
   *
   * Prioritizes information by importance:
   * 1. Category header (if available)
   * 2. Page changes (URL/title)
   * 3. Appeared elements
   * 4. Disappeared elements
   * 5. Significant modifications
   * 6. Content changes (metrics, statuses, text)
   * 7. Minor modifications
   *
   * Each section is only included if there's remaining budget.
   */
  summarizeDiff(diff, options) {
    const { budget, includeIds = false, includeCategory = true } = options;
    const sections = [];
    let remaining = budget;
    const addSection = (text) => {
      if (text.length + 1 > remaining) return false;
      sections.push(text);
      remaining -= text.length + 1;
      return true;
    };
    const truncateText = (text, max) => {
      if (text.length <= max) return text;
      return text.substring(0, max - 3) + "...";
    };
    if (includeCategory) {
      const cat = this.categorizeChanges(diff);
      const header = `[${cat.category}] (${Math.round(cat.confidence * 100)}% confidence)`;
      addSection(header);
    }
    if (diff.pageChanges?.urlChanged) {
      addSection(`Page: navigated to ${diff.pageChanges.newUrl ?? "new URL"}`);
    } else if (diff.pageChanges?.titleChanged) {
      addSection(`Page: title changed to "${diff.pageChanges.newTitle ?? ""}"`);
    }
    if (diff.changes.appeared.length > 0) {
      const count = diff.changes.appeared.length;
      if (count <= 3 && remaining > 80) {
        const details = diff.changes.appeared.map((e) => {
          const id = includeIds ? ` [${e.elementId}]` : "";
          return `  + ${truncateText(e.description, 40)}${id}`;
        }).join("\n");
        addSection(`Appeared (${count}):
${details}`);
      } else {
        const firstFew = diff.changes.appeared.slice(0, 2).map((e) => e.description).join(", ");
        addSection(`Appeared: ${count} elements (${truncateText(firstFew, 50)}...)`);
      }
    }
    if (diff.changes.disappeared.length > 0) {
      const count = diff.changes.disappeared.length;
      if (count <= 3 && remaining > 80) {
        const details = diff.changes.disappeared.map((e) => {
          const id = includeIds ? ` [${e.elementId}]` : "";
          return `  - ${truncateText(e.description, 40)}${id}`;
        }).join("\n");
        addSection(`Disappeared (${count}):
${details}`);
      } else {
        addSection(`Disappeared: ${count} elements`);
      }
    }
    const significantMods = diff.changes.modified.filter((m) => m.significant);
    if (significantMods.length > 0 && remaining > 40) {
      const maxItems = Math.min(significantMods.length, 3);
      const details = significantMods.slice(0, maxItems).map((m) => `  ~ ${m.description}: ${m.property} "${m.from}" -> "${m.to}"`).join("\n");
      const suffix = significantMods.length > maxItems ? `
  ... +${significantMods.length - maxItems} more` : "";
      addSection(
        `Modified (${significantMods.length} significant):
${truncateText(details + suffix, remaining - 30)}`
      );
    }
    if (diff.contentChanges && remaining > 30) {
      const { metricChanges, statusChanges, textChanges } = diff.contentChanges;
      if (metricChanges.length > 0) {
        const metricSummary = metricChanges.slice(0, 2).map((m) => `${m.label}: ${m.oldValue} -> ${m.newValue}`).join(", ");
        addSection(`Metrics: ${truncateText(metricSummary, remaining - 12)}`);
      }
      if (statusChanges.length > 0 && remaining > 20) {
        const statusSummary = statusChanges.slice(0, 2).map((s) => `${s.label}: ${s.oldStatus} -> ${s.newStatus} (${s.direction})`).join(", ");
        addSection(`Statuses: ${truncateText(statusSummary, remaining - 12)}`);
      }
      if (textChanges.length > 0 && remaining > 20) {
        addSection(`Text changes: ${textChanges.length}`);
      }
    }
    const minorMods = diff.changes.modified.filter((m) => !m.significant);
    if (minorMods.length > 0 && remaining > 30) {
      addSection(`Minor changes: ${minorMods.length}`);
    }
    if (sections.length === 0) {
      return "No changes detected";
    }
    return sections.join("\n");
  }
  // ==========================================================================
  // Feature 4: Scoped Diffs
  // ==========================================================================
  /**
   * Compute a diff scoped to elements within a CSS selector container.
   *
   * When `resolveScope` is provided (browser environment), uses actual DOM containment
   * to determine which elements are inside the container. Falls back to string-based
   * matching on parentContext, ID prefix, and description.
   */
  computeScopedDiff(fromSnapshot, toSnapshot, scope) {
    const domScopedIds = this.deps.resolveScope?.(scope) ?? null;
    const filterElements = (elements) => {
      if (domScopedIds) {
        return elements.filter((el) => domScopedIds.has(el.id));
      }
      const scopeLower = scope.toLowerCase();
      return elements.filter((el) => {
        if (el.parentContext && el.parentContext.toLowerCase().includes(scopeLower)) {
          return true;
        }
        if (el.id.toLowerCase().startsWith(scopeLower)) {
          return true;
        }
        if (el.description.toLowerCase().includes(scopeLower)) {
          return true;
        }
        return false;
      });
    };
    const scopedFrom = {
      ...fromSnapshot,
      snapshotId: `${fromSnapshot.snapshotId}:scoped(${scope})`,
      elements: filterElements(fromSnapshot.elements)
    };
    const scopedTo = {
      ...toSnapshot,
      snapshotId: `${toSnapshot.snapshotId}:scoped(${scope})`,
      elements: filterElements(toSnapshot.elements)
    };
    return computeDiff(scopedFrom, scopedTo, this.config.diffConfig);
  }
  /**
   * Get a scoped diff from the current state vs. a named bookmark.
   */
  scopedDiffFromBookmark(bookmarkName, scope) {
    const bookmark = getGlobalBookmarkStore().get(bookmarkName);
    if (!bookmark) return null;
    this.deps.refreshElements?.();
    const currentControl = this.deps.createControlSnapshot();
    const currentSnapshot = this.deps.snapshotManager.createSnapshot(currentControl);
    return this.computeScopedDiff(bookmark.snapshot, currentSnapshot, scope);
  }
  // ==========================================================================
  // Feature 5: Change Buffer
  // ==========================================================================
  /** Enable change buffering. Starts MutationObserver and subscribes to
   * console/network events. When running inside a Tauri webview and
   * `setTauriEventNames()` has been called, also subscribes to those Tauri
   * backend events. The returned promise resolves once Tauri-event
   * subscriptions are in place; all other subscriptions are synchronous. In
   * non-Tauri hosts the promise resolves immediately. */
  async enableBuffer() {
    this.bufferEnabled = true;
    this.bufferEnabledAt = Date.now();
    if (typeof MutationObserver !== "undefined" && typeof document !== "undefined" && !this.mutationObserver) {
      this.mutationObserver = new MutationObserver((records) => {
        for (const record of records) {
          if (this.domMutationBuffer.length >= 500) {
            this.domMutationBuffer.shift();
          }
          const entry = {
            type: record.type,
            target_selector: this.selectorFor(record.target),
            timestamp: Date.now()
          };
          if (record.type === "childList") {
            entry.added = record.addedNodes.length;
            entry.removed = record.removedNodes.length;
          } else if (record.type === "attributes") {
            entry.attribute_name = record.attributeName ?? void 0;
          }
          this.domMutationBuffer.push(entry);
        }
      });
      try {
        this.mutationObserver.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true,
          attributeOldValue: false,
          characterDataOldValue: false
        });
      } catch {
        this.mutationObserver = null;
      }
    }
    if (this.deps.subscribeBrowserEvents && !this.unsubscribeBrowserEvents) {
      const enabledAt = this.bufferEnabledAt;
      this.unsubscribeBrowserEvents = this.deps.subscribeBrowserEvents((event) => {
        if (event.timestamp < enabledAt) return;
        if (event.type !== "console") return;
        if (this.consoleErrorBuffer.length >= 100) {
          this.consoleErrorBuffer.shift();
        }
        this.consoleErrorBuffer.push({
          level: event.level ?? "error",
          message: event.message ?? "",
          stack: event.stack,
          timestamp: event.timestamp
        });
      });
    }
    if (this.deps.subscribeNetworkEvents && !this.unsubscribeNetworkEvents) {
      const enabledAt = this.bufferEnabledAt;
      this.unsubscribeNetworkEvents = this.deps.subscribeNetworkEvents((event) => {
        if (event.type === "request-start") {
          if (event.entry.request.startedAt < enabledAt) return;
          if (this.networkRequestBuffer.length >= 200) {
            this.networkRequestBuffer.shift();
          }
          this.networkRequestBuffer.push({
            url: event.entry.request.url,
            method: event.entry.request.method,
            timestamp: event.entry.request.startedAt
          });
        } else if (event.type === "request-complete" || event.type === "request-error") {
          if (event.entry.request.startedAt < enabledAt) return;
          const existing = this.networkRequestBuffer.find(
            (e) => e.url === event.entry.request.url && e.timestamp === event.entry.request.startedAt
          );
          if (existing) {
            existing.status = event.entry.response?.statusCode;
            existing.duration_ms = event.entry.response?.durationMs;
          } else {
            if (this.networkRequestBuffer.length >= 200) {
              this.networkRequestBuffer.shift();
            }
            this.networkRequestBuffer.push({
              url: event.entry.request.url,
              method: event.entry.request.method,
              status: event.entry.response?.statusCode,
              duration_ms: event.entry.response?.durationMs,
              timestamp: event.entry.request.startedAt
            });
          }
        }
      });
    }
    await this.subscribeTauriEvents();
  }
  /** Disable change buffering. Stops MutationObserver and unsubscribes from services. */
  disableBuffer() {
    this.bufferEnabled = false;
    this._teardownExtendedObservers();
  }
  /**
   * Set the list of Tauri event names to capture in the change buffer.
   * Safe to call before or after `enableBuffer()`. When the buffer is
   * currently enabled, this unsubscribes from the previous names and
   * subscribes to the new ones (best-effort — returns a promise that
   * resolves once resubscription completes).
   */
  async setTauriEventNames(names) {
    this.tauriEventNames = [...names];
    if (this.bufferEnabled) {
      this.unsubscribeTauriEvents();
      await this.subscribeTauriEvents();
    }
  }
  /**
   * Subscribe to Tauri backend events. No-op when not running inside a
   * Tauri webview (detected via `window.__TAURI_INTERNALS__`) or when the
   * event-name list is empty. Loads `@tauri-apps/api/event` via dynamic
   * import so the SDK stays usable in non-Tauri hosts without the optional
   * dependency installed.
   */
  async subscribeTauriEvents() {
    if (this.tauriEventUnlisteners.length > 0) return;
    if (typeof window === "undefined" || !window.__TAURI_INTERNALS__) {
      return;
    }
    if (this.tauriEventNames.length === 0) return;
    const globalTauri = window.__TAURI__;
    let listen = globalTauri?.event?.listen;
    if (typeof listen !== "function") {
      try {
        const specifier = `@tauri-apps/api/event`;
        const mod = await loadTauriEventModule(specifier);
        const dynListen = mod.listen;
        if (typeof dynListen === "function") {
          listen = dynListen;
        }
      } catch (err) {
        console.warn("[ui-bridge] Tauri event subscription unavailable:", err);
        return;
      }
    }
    if (typeof listen !== "function") {
      return;
    }
    for (const name of this.tauriEventNames) {
      try {
        const unlisten = await listen(name, (e) => {
          if (!this.bufferEnabled) return;
          if (this.tauriEventBuffer.length >= this.tauriEventBufferCap) return;
          this.tauriEventBuffer.push({
            event: e.event,
            payload: e.payload,
            timestamp: Date.now()
          });
        });
        if (!this.bufferEnabled) {
          try {
            unlisten();
          } catch {
          }
          return;
        }
        this.tauriEventUnlisteners.push(unlisten);
      } catch (err) {
        console.warn(`[ui-bridge] Failed to subscribe to Tauri event "${name}":`, err);
      }
    }
  }
  /** Invoke every stored unlisten function and clear the list. */
  unsubscribeTauriEvents() {
    for (const unlisten of this.tauriEventUnlisteners) {
      try {
        unlisten();
      } catch {
      }
    }
    this.tauriEventUnlisteners = [];
  }
  /** Stop MutationObserver and unsubscribe from console/network services. */
  _teardownExtendedObservers() {
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }
    if (this.unsubscribeBrowserEvents) {
      try {
        this.unsubscribeBrowserEvents();
      } catch {
      }
      this.unsubscribeBrowserEvents = null;
    }
    if (this.unsubscribeNetworkEvents) {
      try {
        this.unsubscribeNetworkEvents();
      } catch {
      }
      this.unsubscribeNetworkEvents = null;
    }
    this.unsubscribeTauriEvents();
    this.tauriEventBuffer = [];
  }
  /** Whether the buffer is enabled */
  isBufferEnabled() {
    return this.bufferEnabled;
  }
  /** Get buffer size (registry-level changes only, for backward compat) */
  getBufferSize() {
    return this.changeBuffer.length;
  }
  /**
   * Drain all buffered changes and clear the four sub-lists.
   * Observers remain active if the buffer is still enabled (incremental semantics:
   * subsequent drains return only events since the previous drain).
   *
   * Route-change and registry-diff entries are returned in `changes`, interleaved by
   * `recordedAt`. Raw DOM mutations, console errors, and network requests are returned
   * in separate typed lists.
   */
  drainBuffer() {
    const changes = [...this.changeBuffer];
    this.changeBuffer = [];
    changes.sort((a, b) => a.recordedAt - b.recordedAt || a.sequence - b.sequence);
    const dom = [...this.domMutationBuffer];
    this.domMutationBuffer = [];
    const console_errors = [...this.consoleErrorBuffer];
    this.consoleErrorBuffer = [];
    const network_requests = [...this.networkRequestBuffer];
    this.networkRequestBuffer = [];
    const tauri_events = [...this.tauriEventBuffer];
    this.tauriEventBuffer = [];
    return {
      changes,
      dom,
      console_errors,
      network_requests,
      tauri_events,
      count: changes.length,
      enabled_at: this.bufferEnabledAt,
      fromTimestamp: changes.length > 0 ? changes[0].recordedAt : 0,
      toTimestamp: changes.length > 0 ? changes[changes.length - 1].recordedAt : 0
    };
  }
  /**
   * Derive a best-effort CSS selector string for a DOM node.
   * Used for DomMutationEntry.target_selector.
   */
  selectorFor(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return node.nodeName.toLowerCase();
    }
    const el = node;
    const parts = [el.tagName.toLowerCase()];
    if (el.id) {
      return `#${el.id}`;
    }
    const cls = classList(el).slice(0, 2).join(".");
    if (cls) parts.push(`.${cls}`);
    return parts.join("");
  }
  /**
   * Push a SPA route-change entry into the buffer (P1.3). Called by the
   * runner's `useChangeTrackingEvents` integration when the
   * NavigationTracker fires a `navigation:change` event.
   *
   * Always feeds the always-on `recentRouteChanges` ring buffer and fires
   * any `subscribeRouteChange` listeners, regardless of `bufferEnabled`, so
   * that `/ai/wait-for-route-change` can resolve without the change buffer
   * being explicitly enabled. The existing `changeBuffer` append remains
   * gated on `bufferEnabled` for backward compatibility with drain semantics.
   */
  pushRouteChange(from, to, at) {
    const recordedAt = at ?? Date.now();
    this.recentRouteChanges.push({ from, to, at: recordedAt });
    if (this.recentRouteChanges.length > this.recentRouteChangesCap) {
      this.recentRouteChanges.splice(
        0,
        this.recentRouteChanges.length - this.recentRouteChangesCap
      );
    }
    for (const listener of this.routeChangeListeners) {
      try {
        listener({ from, to, at: recordedAt });
      } catch {
      }
    }
    if (!this.bufferEnabled) return;
    const entry = {
      type: "route-change",
      from,
      to,
      at: recordedAt,
      recordedAt,
      sequence: this.bufferSequence++
    };
    this.changeBuffer.push(entry);
    this.evictIfOverLimit();
  }
  /**
   * Subscribe to SPA route-change events.
   *
   * Fires synchronously from `pushRouteChange`, regardless of whether the
   * change buffer is enabled. Returns an unsubscribe function.
   */
  subscribeRouteChange(listener) {
    this.routeChangeListeners.add(listener);
    return () => {
      this.routeChangeListeners.delete(listener);
    };
  }
  /**
   * Return recent route-change events from the always-on ring buffer,
   * optionally filtered to entries recorded at or after `sinceMs`.
   *
   * Used by `/ai/wait-for-route-change` to resolve immediately when a
   * matching navigation occurred between the HTTP request arriving and the
   * listener being attached.
   */
  getRecentRouteChanges(sinceMs) {
    if (sinceMs === void 0) return [...this.recentRouteChanges];
    return this.recentRouteChanges.filter((entry) => entry.at >= sinceMs);
  }
  /** Append a diff to the buffer */
  appendToBuffer(diff, category) {
    if (!this.bufferEnabled) return;
    const entry = {
      diff,
      category,
      recordedAt: Date.now(),
      sequence: this.bufferSequence++
    };
    this.changeBuffer.push(entry);
    this.evictIfOverLimit();
  }
  /** Trim oldest entries when the buffer exceeds its configured size. */
  evictIfOverLimit() {
    if (this.changeBuffer.length > this.config.maxBufferSize) {
      this.changeBuffer = this.changeBuffer.slice(
        this.changeBuffer.length - this.config.maxBufferSize
      );
    }
  }
  // ==========================================================================
  // Feature 6: Snapshot Bookmarks
  // ==========================================================================
  /**
   * Save a named snapshot of the current state.
   */
  saveBookmark(name) {
    this.deps.refreshElements?.();
    const controlSnapshot = this.deps.createControlSnapshot();
    const snapshot = this.deps.snapshotManager.createSnapshot(controlSnapshot);
    const bookmark = {
      name,
      snapshot,
      savedAt: Date.now()
    };
    getGlobalBookmarkStore().save(bookmark);
    return bookmark;
  }
  /**
   * Get a named bookmark.
   */
  getBookmark(name) {
    return getGlobalBookmarkStore().get(name);
  }
  /**
   * Delete a named bookmark.
   */
  deleteBookmark(name) {
    return getGlobalBookmarkStore().delete(name);
  }
  /**
   * List all bookmark names.
   */
  listBookmarks() {
    return getGlobalBookmarkStore().listNames();
  }
  /**
   * Compute a diff from a named bookmark to the current state.
   */
  diffFromBookmark(name) {
    const bookmark = getGlobalBookmarkStore().get(name);
    if (!bookmark) return null;
    this.deps.refreshElements?.();
    const currentControl = this.deps.createControlSnapshot();
    const currentSnapshot = this.deps.snapshotManager.createSnapshot(currentControl);
    const diff = computeDiff(bookmark.snapshot, currentSnapshot, this.config.diffConfig);
    this.lastDiff = diff;
    return diff;
  }
};
function analyzeStructuredChanges(before, after) {
  const tableChanges = [];
  const listChanges = [];
  const beforeTable = detectTable(before.elements);
  const afterTable = detectTable(after.elements);
  if (beforeTable || afterTable) {
    const analysis = diffTables(beforeTable, afterTable);
    if (analysis) {
      tableChanges.push(analysis);
    }
  }
  const beforeList = detectList(before.elements);
  const afterList = detectList(after.elements);
  if (beforeList || afterList) {
    const analysis = diffLists(beforeList, afterList);
    if (analysis) {
      listChanges.push(analysis);
    }
  }
  return {
    tableChanges,
    listChanges,
    hasStructuredData: tableChanges.length > 0 || listChanges.length > 0
  };
}
function diffTables(before, after) {
  if (!before && after) {
    return {
      label: after.label,
      columns: after.columns.map((c) => c.header),
      addedRows: after.rows,
      removedRows: [],
      modifiedRows: [],
      summary: `Table "${after.label}" appeared with ${after.rows.length} rows`
    };
  }
  if (before && !after) {
    return {
      label: before.label,
      columns: before.columns.map((c) => c.header),
      addedRows: [],
      removedRows: before.rows,
      modifiedRows: [],
      summary: `Table "${before.label}" disappeared (had ${before.rows.length} rows)`
    };
  }
  if (before && after) {
    const columns = after.columns.map((c) => c.header);
    const addedRows = [];
    const removedRows = [];
    const modifiedRows = [];
    const keyFn = (row) => row[0] ?? row.join("|");
    const beforeRowMap = /* @__PURE__ */ new Map();
    for (let i = 0; i < before.rows.length; i++) {
      beforeRowMap.set(keyFn(before.rows[i]), { row: before.rows[i], index: i });
    }
    const afterRowMap = /* @__PURE__ */ new Map();
    for (let i = 0; i < after.rows.length; i++) {
      afterRowMap.set(keyFn(after.rows[i]), { row: after.rows[i], index: i });
    }
    for (const [key, { row }] of afterRowMap) {
      if (!beforeRowMap.has(key)) {
        addedRows.push(row);
      }
    }
    for (const [key, { row }] of beforeRowMap) {
      if (!afterRowMap.has(key)) {
        removedRows.push(row);
      }
    }
    for (const [key, afterEntry] of afterRowMap) {
      const beforeEntry = beforeRowMap.get(key);
      if (beforeEntry) {
        const changes = [];
        const maxCols = Math.max(beforeEntry.row.length, afterEntry.row.length);
        for (let c = 0; c < maxCols; c++) {
          const fromVal = beforeEntry.row[c] ?? "";
          const toVal = afterEntry.row[c] ?? "";
          if (fromVal !== toVal) {
            changes.push({
              column: columns[c] ?? `col_${c}`,
              from: fromVal,
              to: toVal
            });
          }
        }
        if (changes.length > 0) {
          modifiedRows.push({ rowIndex: afterEntry.index, changes });
        }
      }
    }
    if (addedRows.length === 0 && removedRows.length === 0 && modifiedRows.length === 0) {
      return null;
    }
    const parts = [];
    if (addedRows.length > 0) parts.push(`${addedRows.length} rows added`);
    if (removedRows.length > 0) parts.push(`${removedRows.length} rows removed`);
    if (modifiedRows.length > 0) parts.push(`${modifiedRows.length} rows modified`);
    return {
      label: after.label,
      columns,
      addedRows,
      removedRows,
      modifiedRows,
      summary: `Table "${after.label}": ${parts.join(", ")}`
    };
  }
  return null;
}
function diffLists(before, after) {
  if (!before && after) {
    return {
      label: after.label,
      addedItems: after.items,
      removedItems: [],
      summary: `List appeared with ${after.items.length} items`
    };
  }
  if (before && !after) {
    return {
      label: before.label,
      addedItems: [],
      removedItems: before.items,
      summary: `List disappeared (had ${before.items.length} items)`
    };
  }
  if (before && after) {
    const itemKey = (item) => Object.values(item).join("|");
    const beforeKeys = new Set(before.items.map(itemKey));
    const afterKeys = new Set(after.items.map(itemKey));
    const addedItems = after.items.filter((item) => !beforeKeys.has(itemKey(item)));
    const removedItems = before.items.filter((item) => !afterKeys.has(itemKey(item)));
    if (addedItems.length === 0 && removedItems.length === 0) {
      return null;
    }
    const parts = [];
    if (addedItems.length > 0) parts.push(`${addedItems.length} items added`);
    if (removedItems.length > 0) parts.push(`${removedItems.length} items removed`);
    return {
      label: after.label,
      addedItems,
      removedItems,
      summary: `List: ${parts.join(", ")}`
    };
  }
  return null;
}
function createChangeTracker(deps, config) {
  return new ChangeTracker(deps, config);
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function loadTauriEventModule(specifier) {
  return import(
    /* @vite-ignore */
    specifier
  );
}

// src/ai/format-analysis.ts
var DEFAULT_FORMAT_ANALYSIS_CONFIG = {
  lenientFormatting: true
};
function detectFormatPattern(value, dataType) {
  const trimmed = value.trim();
  switch (dataType) {
    case "currency": {
      const hasLeadingSymbol = /^[£$€¥₹]/.test(trimmed);
      const hasTrailingSymbol = /[£$€¥₹]$/.test(trimmed);
      const usesCommaThousands = /\d{1,3}(,\d{3})+/.test(trimmed);
      const usesPeriodThousands = /\d{1,3}(\.\d{3})+,/.test(trimmed);
      let pattern = hasLeadingSymbol ? "$" : "";
      if (usesCommaThousands) pattern += "#,###";
      else if (usesPeriodThousands) pattern += "#.###";
      else pattern += "#";
      if (/\.\d{2}$/.test(trimmed)) pattern += ".##";
      else if (/,\d{2}$/.test(trimmed)) pattern += ",##";
      if (hasTrailingSymbol) pattern += "$";
      return pattern;
    }
    case "date": {
      if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return "YYYY-MM-DD";
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) return "MM/DD/YYYY";
      if (/^\d{2}\.\d{2}\.\d{4}$/.test(trimmed)) return "DD.MM.YYYY";
      if (/^\d{1,2}\/\d{1,2}\/\d{2}$/.test(trimmed)) return "M/D/YY";
      if (/^\w{3,9}\s+\d{1,2},?\s+\d{4}$/.test(trimmed)) return "Month DD, YYYY";
      return "date";
    }
    case "percentage":
      return /\s%$/.test(trimmed) ? "#.## %" : "#.##%";
    case "number": {
      const hasCommas = /,/.test(trimmed);
      const decimalPlaces = trimmed.includes(".") ? trimmed.split(".")[1]?.length || 0 : 0;
      return (hasCommas ? "#,###" : "#") + (decimalPlaces > 0 ? "." + "#".repeat(decimalPlaces) : "");
    }
    case "phone": {
      if (/^\(\d{3}\)\s?\d{3}-\d{4}$/.test(trimmed)) return "(###) ###-####";
      if (/^\d{3}-\d{3}-\d{4}$/.test(trimmed)) return "###-###-####";
      if (/^\+\d/.test(trimmed)) return "+# ###...";
      return "phone";
    }
    default:
      return dataType;
  }
}
function analyzeFormat(elementId, label, rawValue) {
  const { type: dataType } = classifyDataType(rawValue);
  const pattern = detectFormatPattern(rawValue, dataType);
  return {
    elementId,
    label,
    dataType,
    pattern,
    example: rawValue.trim()
  };
}
function analyzePageFormats(elements) {
  const descriptors = [];
  for (const el of elements) {
    const rawValue = el.state?.value ?? el.state?.textContent ?? "";
    if (!rawValue) continue;
    const label = el.accessibleName || el.labelText || el.label || el.description || el.id;
    descriptors.push(analyzeFormat(el.id, label, rawValue));
  }
  return descriptors;
}
function compareFormats(sourceFormats, targetFormats, config = DEFAULT_FORMAT_ANALYSIS_CONFIG) {
  const mismatches = [];
  const targetByLabel = /* @__PURE__ */ new Map();
  for (const t of targetFormats) {
    targetByLabel.set(t.label.toLowerCase(), t);
  }
  for (const source of sourceFormats) {
    const target = targetByLabel.get(source.label.toLowerCase());
    if (!target) continue;
    if (source.dataType !== target.dataType) {
      mismatches.push({
        label: source.label,
        sourceFormat: source,
        targetFormat: target,
        severity: "error",
        description: `Data type mismatch: source is ${source.dataType}, target is ${target.dataType}`
      });
      continue;
    }
    if (source.pattern !== target.pattern) {
      const severity = config.lenientFormatting ? "warning" : "error";
      mismatches.push({
        label: source.label,
        sourceFormat: source,
        targetFormat: target,
        severity,
        description: `Format differs: source uses "${source.pattern}", target uses "${target.pattern}"`
      });
    }
  }
  return mismatches;
}

// src/ai/cross-app-diff.ts
var DEFAULT_CROSS_APP_DIFF_CONFIG = {
  matchThreshold: 0.5,
  accessibleNameWeight: 1,
  textWeight: 0.95,
  rolePositionWeight: 0.7
};
function getElementText(el) {
  return el.accessibleName || el.labelText || el.label || el.state?.textContent || el.description || "";
}
function getRole(el) {
  return (el.role || el.type || "").toLowerCase();
}
function getCenter(el) {
  const rect = el.state?.rect;
  if (!rect) return null;
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2
  };
}
function computeMatchScore(source, target, config) {
  let bestScore = 0;
  let bestStrategy = "none";
  const srcName = (source.accessibleName || "").trim();
  const tgtName = (target.accessibleName || "").trim();
  if (srcName && tgtName && srcName.toLowerCase() === tgtName.toLowerCase()) {
    return { score: config.accessibleNameWeight, strategy: "accessible-name-exact" };
  }
  const srcText = getElementText(source);
  const tgtText = getElementText(target);
  if (srcText && tgtText && srcText.toLowerCase() === tgtText.toLowerCase()) {
    const score = config.textWeight;
    if (score > bestScore) {
      bestScore = score;
      bestStrategy = "text-exact";
    }
  }
  if (srcText && tgtText) {
    const srcNorm = normalizeString(srcText);
    const tgtNorm = normalizeString(tgtText);
    const similarity = jaroWinklerSimilarity(srcNorm, tgtNorm);
    const score = similarity * 0.85;
    if (score > bestScore) {
      bestScore = score;
      bestStrategy = "text-fuzzy";
    }
  }
  const srcRole = getRole(source);
  const tgtRole = getRole(target);
  if (srcRole && srcRole === tgtRole) {
    const srcCenter = getCenter(source);
    const tgtCenter = getCenter(target);
    if (srcCenter && tgtCenter) {
      const dx = Math.abs(srcCenter.x - tgtCenter.x) / 1920;
      const dy = Math.abs(srcCenter.y - tgtCenter.y) / 1080;
      const posSimilarity = 1 - Math.min(1, Math.sqrt(dx * dx + dy * dy));
      const score = config.rolePositionWeight * posSimilarity;
      if (score > bestScore) {
        bestScore = score;
        bestStrategy = "role-position";
      }
    }
  }
  const srcVal = source.state?.value ?? source.state?.textContent ?? "";
  const tgtVal = target.state?.value ?? target.state?.textContent ?? "";
  if (srcVal && tgtVal) {
    const srcType = classifyDataType(srcVal).type;
    const tgtType = classifyDataType(tgtVal).type;
    const srcNorm = normalizeValue(srcVal, srcType);
    const tgtNorm = normalizeValue(tgtVal, tgtType);
    if (srcNorm === tgtNorm && srcNorm !== "") {
      const score = 0.6;
      if (score > bestScore) {
        bestScore = score;
        bestStrategy = "data-overlap";
      }
    }
  }
  return { score: bestScore, strategy: bestStrategy };
}
function matchElements(sourceElements, targetElements, config = DEFAULT_CROSS_APP_DIFF_CONFIG) {
  const candidates = [];
  for (let si = 0; si < sourceElements.length; si++) {
    for (let ti = 0; ti < targetElements.length; ti++) {
      const { score, strategy } = computeMatchScore(sourceElements[si], targetElements[ti], config);
      if (score >= config.matchThreshold) {
        candidates.push({ sourceIdx: si, targetIdx: ti, score, strategy });
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const usedSource = /* @__PURE__ */ new Set();
  const usedTarget = /* @__PURE__ */ new Set();
  const pairs = [];
  for (const c of candidates) {
    if (usedSource.has(c.sourceIdx) || usedTarget.has(c.targetIdx)) continue;
    usedSource.add(c.sourceIdx);
    usedTarget.add(c.targetIdx);
    const src = sourceElements[c.sourceIdx];
    const tgt = targetElements[c.targetIdx];
    pairs.push({
      sourceId: src.id,
      targetId: tgt.id,
      sourceLabel: getElementText(src) || src.id,
      targetLabel: getElementText(tgt) || tgt.id,
      confidence: Math.round(c.score * 100) / 100,
      matchStrategy: c.strategy
    });
  }
  return pairs;
}
function computeCrossAppDiff(sourceElements, targetElements, config = DEFAULT_CROSS_APP_DIFF_CONFIG) {
  const matchedPairs = matchElements(sourceElements, targetElements, config);
  const matchedSourceIds = new Set(matchedPairs.map((p) => p.sourceId));
  const matchedTargetIds = new Set(matchedPairs.map((p) => p.targetId));
  const unmatchedSourceIds = sourceElements.filter((e) => !matchedSourceIds.has(e.id)).map((e) => e.id);
  const unmatchedTargetIds = targetElements.filter((e) => !matchedTargetIds.has(e.id)).map((e) => e.id);
  const sourceData = extractPageData(sourceElements);
  const targetData = extractPageData(targetElements);
  const dataComparisons = [];
  for (const pair of matchedPairs) {
    const srcEntry = Object.values(sourceData.values).find((v) => v.elementId === pair.sourceId);
    const tgtEntry = Object.values(targetData.values).find((v) => v.elementId === pair.targetId);
    if (srcEntry && tgtEntry) {
      dataComparisons.push({
        label: pair.sourceLabel,
        sourceValue: srcEntry.rawValue,
        targetValue: tgtEntry.rawValue,
        valuesMatch: srcEntry.normalizedValue === tgtEntry.normalizedValue,
        formatsMatch: srcEntry.dataType === tgtEntry.dataType
      });
    }
  }
  const sourceFormats = analyzePageFormats(sourceElements);
  const targetFormats = analyzePageFormats(targetElements);
  const formatMismatches = compareFormats(sourceFormats, targetFormats);
  return {
    matchedPairs,
    unmatchedSourceIds,
    unmatchedTargetIds,
    dataComparisons,
    formatMismatches
  };
}

// src/ai/action-parity.ts
var DEFAULT_ACTION_PARITY_CONFIG = {
  ignoreActions: []
};
function getActions(el, ignoreActions) {
  const actions = el.actions || el.suggestedActions || [];
  const ignoreSet = new Set(ignoreActions.map((a) => a.toLowerCase()));
  return actions.map(
    (a) => typeof a === "string" ? a : a.action || a.name || ""
  ).filter((a) => a && !ignoreSet.has(a.toLowerCase()));
}
function analyzeActionParity(matchedPairs, sourceElements, targetElements, config = DEFAULT_ACTION_PARITY_CONFIG) {
  const sourceById = new Map(sourceElements.map((e) => [e.id, e]));
  const targetById = new Map(targetElements.map((e) => [e.id, e]));
  const results = [];
  for (const pair of matchedPairs) {
    const src = sourceById.get(pair.sourceId);
    const tgt = targetById.get(pair.targetId);
    if (!src || !tgt) continue;
    const sourceActions = getActions(src, config.ignoreActions);
    const targetActions = getActions(tgt, config.ignoreActions);
    const sourceSet = new Set(sourceActions.map((a) => a.toLowerCase()));
    const targetSet = new Set(targetActions.map((a) => a.toLowerCase()));
    const missingInTarget = sourceActions.filter((a) => !targetSet.has(a.toLowerCase()));
    const missingInSource = targetActions.filter((a) => !sourceSet.has(a.toLowerCase()));
    results.push({
      pair,
      sourceActions,
      targetActions,
      missingInTarget,
      missingInSource
    });
  }
  return results;
}

// src/ai/navigation-map.ts
var DEFAULT_NAVIGATION_MAP_CONFIG = {
  labelMatchThreshold: 0.8
};
function isNavigationElement(el) {
  const role = (el.role || "").toLowerCase();
  const type = (el.type || "").toLowerCase();
  const semanticType = (el.semanticType || "").toLowerCase();
  if (["link", "menuitem", "tab"].includes(role)) return true;
  if (["link", "menuitem"].includes(type)) return true;
  if (semanticType.includes("nav") || semanticType.includes("menu") || semanticType.includes("tab")) {
    return true;
  }
  const context = (el.parentContext || "").toLowerCase();
  if (context.includes("nav") || context.includes("menu") || context.includes("sidebar")) {
    if (role === "button" || type === "button" || role === "link" || type === "link") {
      return true;
    }
  }
  return false;
}
function getNavLabel(el) {
  return el.accessibleName || el.labelText || el.label || el.description || el.id;
}
function getHref(el) {
  return el.state?.href || void 0;
}
function hrefsMatch(a, b) {
  if (!a || !b) return false;
  const normalize = (h) => h.replace(/^https?:\/\//, "").replace(/localhost:\d+/, "").replace(/\/+$/, "").toLowerCase();
  return normalize(a) === normalize(b);
}
function buildNavigationMap(sourceElements, targetElements, config = DEFAULT_NAVIGATION_MAP_CONFIG) {
  const sourceNav = sourceElements.filter(isNavigationElement);
  const targetNav = targetElements.filter(isNavigationElement);
  const pairs = [];
  const matchedTargetIds = /* @__PURE__ */ new Set();
  for (const src of sourceNav) {
    const srcLabel = getNavLabel(src);
    const srcNorm = normalizeString(srcLabel);
    let bestTarget = null;
    let bestScore = 0;
    for (const tgt of targetNav) {
      if (matchedTargetIds.has(tgt.id)) continue;
      const tgtLabel = getNavLabel(tgt);
      const tgtNorm = normalizeString(tgtLabel);
      if (srcNorm === tgtNorm) {
        bestTarget = tgt;
        break;
      }
      const similarity = jaroWinklerSimilarity(srcNorm, tgtNorm);
      if (similarity > bestScore && similarity >= config.labelMatchThreshold) {
        bestScore = similarity;
        bestTarget = tgt;
      }
    }
    if (bestTarget) {
      matchedTargetIds.add(bestTarget.id);
      const srcHref = getHref(src);
      const tgtHref = getHref(bestTarget);
      pairs.push({
        sourceId: src.id,
        targetId: bestTarget.id,
        label: srcLabel,
        sourceHref: srcHref,
        targetHref: tgtHref,
        destinationMatch: hrefsMatch(srcHref, tgtHref)
      });
    }
  }
  const sourceOnly = sourceNav.filter((s) => !pairs.some((p) => p.sourceId === s.id)).map((s) => s.id);
  const targetOnly = targetNav.filter((t) => !matchedTargetIds.has(t.id)).map((t) => t.id);
  return { pairs, sourceOnly, targetOnly };
}

// src/ai/component-comparison.ts
var DEFAULT_COMPONENT_COMPARISON_CONFIG = {
  nameMatchThreshold: 0.75
};
function computeComponentMatchScore(source, target) {
  if (source.name.toLowerCase() === target.name.toLowerCase()) return 1;
  let score = 0;
  if (source.type === target.type) {
    score += 0.3;
  }
  const nameSimilarity = jaroWinklerSimilarity(
    normalizeString(source.name),
    normalizeString(target.name)
  );
  score += nameSimilarity * 0.7;
  return score;
}
function compareComponents(sourceComponents, targetComponents, config = DEFAULT_COMPONENT_COMPARISON_CONFIG) {
  const candidates = [];
  for (let si = 0; si < sourceComponents.length; si++) {
    for (let ti = 0; ti < targetComponents.length; ti++) {
      const score = computeComponentMatchScore(sourceComponents[si], targetComponents[ti]);
      if (score >= config.nameMatchThreshold) {
        candidates.push({ sourceIdx: si, targetIdx: ti, score });
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const usedSource = /* @__PURE__ */ new Set();
  const usedTarget = /* @__PURE__ */ new Set();
  const matches = [];
  for (const c of candidates) {
    if (usedSource.has(c.sourceIdx) || usedTarget.has(c.targetIdx)) continue;
    usedSource.add(c.sourceIdx);
    usedTarget.add(c.targetIdx);
    const src = sourceComponents[c.sourceIdx];
    const tgt = targetComponents[c.targetIdx];
    const srcKeys = new Set(src.stateKeys);
    const tgtKeys = new Set(tgt.stateKeys);
    const missingKeys = src.stateKeys.filter((k) => !tgtKeys.has(k));
    const extraKeys = tgt.stateKeys.filter((k) => !srcKeys.has(k));
    const srcActions = new Set(src.actions.map((a) => a.toLowerCase()));
    const tgtActions = new Set(tgt.actions.map((a) => a.toLowerCase()));
    const missingActions = src.actions.filter((a) => !tgtActions.has(a.toLowerCase()));
    const extraActions = tgt.actions.filter((a) => !srcActions.has(a.toLowerCase()));
    matches.push({
      source: src,
      target: tgt,
      confidence: Math.round(c.score * 100) / 100,
      stateKeyDiff: { missing: missingKeys, extra: extraKeys },
      actionDiff: { missing: missingActions, extra: extraActions }
    });
  }
  const sourceOnly = sourceComponents.filter((_, i) => !usedSource.has(i));
  const targetOnly = targetComponents.filter((_, i) => !usedTarget.has(i));
  return { matches, sourceOnly, targetOnly };
}

// src/ai/layout-comparison.ts
var DEFAULT_LAYOUT_COMPARISON_CONFIG = {
  gridTolerance: 20
};
function getRect(el) {
  const rect = el.state?.rect;
  if (!rect || !rect.width) return null;
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}
function clusterValues(values, tolerance) {
  if (values.length === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const clusters = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - clusters[clusters.length - 1] > tolerance) {
      clusters.push(sorted[i]);
    }
  }
  return clusters;
}
function detectGridStructure(elements, config = DEFAULT_LAYOUT_COMPARISON_CONFIG) {
  const rects = elements.map(getRect).filter((r) => r !== null);
  const xPositions = rects.map((r) => r.x);
  const yPositions = rects.map((r) => r.y);
  const columns = clusterValues(xPositions, config.gridTolerance);
  const rows = clusterValues(yPositions, config.gridTolerance);
  return {
    columns,
    rows,
    columnCount: columns.length,
    rowCount: rows.length
  };
}
function computeMaxDepth(elements) {
  let maxDepth = 0;
  for (const el of elements) {
    const context = el.parentContext || "";
    const depth = context ? context.split(">").length : 1;
    maxDepth = Math.max(maxDepth, depth);
  }
  return maxDepth;
}
function computeProminence(element, pageWidth, pageHeight) {
  const rect = getRect(element);
  if (!rect || pageWidth === 0 || pageHeight === 0) return 0;
  const sizeScore = rect.width * rect.height / (pageWidth * pageHeight);
  const positionScore = 1 - rect.y / pageHeight;
  return Math.min(1, sizeScore * 0.6 + positionScore * 0.4);
}
function compareLayouts(sourceElements, targetElements, sourceRegions, targetRegions, config = DEFAULT_LAYOUT_COMPARISON_CONFIG) {
  const sourceGrid = detectGridStructure(sourceElements, config);
  const targetGrid = detectGridStructure(targetElements, config);
  const gridDiff = {
    sourceGrid,
    targetGrid,
    columnDiff: sourceGrid.columnCount - targetGrid.columnCount,
    rowDiff: sourceGrid.rowCount - targetGrid.rowCount
  };
  const sourceDepth = computeMaxDepth(sourceElements);
  const targetDepth = computeMaxDepth(targetElements);
  const hierarchyDiff = {
    sourceDepth,
    targetDepth,
    depthDiff: sourceDepth - targetDepth
  };
  const sourceRegionCount = sourceRegions?.regions.length || 1;
  const targetRegionCount = targetRegions?.regions.length || 1;
  const sourceDensity = sourceElements.length / sourceRegionCount;
  const targetDensity = targetElements.length / targetRegionCount;
  const density = {
    sourceDensity: Math.round(sourceDensity * 100) / 100,
    targetDensity: Math.round(targetDensity * 100) / 100,
    ratio: targetDensity > 0 ? Math.round(sourceDensity / targetDensity * 100) / 100 : 0
  };
  const gridSimilarity = sourceGrid.columnCount === 0 && targetGrid.columnCount === 0 ? 1 : 1 - Math.abs(gridDiff.columnDiff) / Math.max(sourceGrid.columnCount, targetGrid.columnCount, 1);
  const hierarchySimilarity = sourceDepth === 0 && targetDepth === 0 ? 1 : 1 - Math.abs(hierarchyDiff.depthDiff) / Math.max(sourceDepth, targetDepth, 1);
  const densitySimilarity = density.ratio > 0 ? Math.min(density.ratio, 1 / density.ratio) : 0;
  const similarity = Math.round((gridSimilarity * 0.4 + hierarchySimilarity * 0.3 + densitySimilarity * 0.3) * 100) / 100;
  return {
    gridDiff,
    hierarchyDiff,
    density,
    similarity
  };
}

// src/ai/content-comparison.ts
var DEFAULT_CONTENT_COMPARISON_CONFIG = {
  labelMatchThreshold: 0.8,
  headingMatchThreshold: 0.75,
  maxCellDifferences: 50
};
function getElementText2(el) {
  return (el.accessibleName || el.labelText || el.label || el.state?.textContent || el.description || "").trim();
}
function getContentRole(el) {
  if (el.contentMetadata?.contentRole) {
    return el.contentMetadata.contentRole;
  }
  const t = (el.type || "").toLowerCase();
  if (t === "heading" || t.startsWith("h") && /^h[1-6]$/.test(t)) return "heading";
  if (t === "metric-value" || t === "metric") return "metric";
  if (t === "status-message" || t === "status") return "status";
  if (t === "label") return "label";
  if (t === "badge") return "badge";
  if (t === "table-cell") return "table-cell";
  if (t === "table-header") return "table-header";
  if (t === "caption") return "caption";
  return null;
}
function getHeadingLevel(el) {
  if (el.contentMetadata?.headingLevel) {
    return el.contentMetadata.headingLevel;
  }
  const tag = (el.tagName || el.type || "").toLowerCase();
  const match = /^h([1-6])$/.exec(tag);
  if (match) return parseInt(match[1], 10);
  return void 0;
}
function isContentElement2(el) {
  if (el.category === "content") return true;
  if (el.contentMetadata) return true;
  const role = getContentRole(el);
  return role !== null;
}
function normalizeText(text) {
  return normalizeString(text, { caseSensitive: false, ignoreWhitespace: true });
}
function parseMetricText(el) {
  const text = getElementText2(el);
  const colonMatch = text.match(/^(.+?):\s*(.+)$/);
  if (colonMatch) {
    return { label: colonMatch[1].trim(), value: colonMatch[2].trim() };
  }
  const dashMatch = text.match(/^(.+?)\s*[-]\s*(.+)$/);
  if (dashMatch) {
    return { label: dashMatch[1].trim(), value: dashMatch[2].trim() };
  }
  const elLabel = el.accessibleName || el.labelText || el.label || el.id;
  return { label: elLabel, value: text };
}
function filterHeadings(elements) {
  return elements.filter((el) => getContentRole(el) === "heading");
}
function filterMetrics(elements) {
  return elements.filter((el) => getContentRole(el) === "metric");
}
function filterStatuses(elements) {
  return elements.filter((el) => {
    const role = getContentRole(el);
    return role === "status" || role === "badge";
  });
}
function filterLabels(elements) {
  return elements.filter((el) => {
    const role = getContentRole(el);
    return role === "label" || role === "caption";
  });
}
function matchTexts(sourceTexts, targetTexts, threshold) {
  const candidates = [];
  for (let si = 0; si < sourceTexts.length; si++) {
    const sNorm = normalizeText(sourceTexts[si]);
    if (!sNorm) continue;
    for (let ti = 0; ti < targetTexts.length; ti++) {
      const tNorm = normalizeText(targetTexts[ti]);
      if (!tNorm) continue;
      const score = sNorm === tNorm ? 1 : jaroWinklerSimilarity(sNorm, tNorm);
      if (score >= threshold) {
        candidates.push({ sourceIdx: si, targetIdx: ti, score });
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const usedSource = /* @__PURE__ */ new Set();
  const usedTarget = /* @__PURE__ */ new Set();
  const matched = [];
  for (const c of candidates) {
    if (usedSource.has(c.sourceIdx) || usedTarget.has(c.targetIdx)) continue;
    usedSource.add(c.sourceIdx);
    usedTarget.add(c.targetIdx);
    matched.push(c);
  }
  const unmatchedSource = sourceTexts.map((_, i) => i).filter((i) => !usedSource.has(i));
  const unmatchedTarget = targetTexts.map((_, i) => i).filter((i) => !usedTarget.has(i));
  return { matched, unmatchedSource, unmatchedTarget };
}
function compareHeadings(sourceElements, targetElements, config) {
  const srcHeadings = filterHeadings(sourceElements);
  const tgtHeadings = filterHeadings(targetElements);
  const srcTexts = srcHeadings.map(getElementText2);
  const tgtTexts = tgtHeadings.map(getElementText2);
  const { matched, unmatchedSource, unmatchedTarget } = matchTexts(
    srcTexts,
    tgtTexts,
    config.headingMatchThreshold
  );
  const headingMatched = [];
  const headingChanged = [];
  for (const m of matched) {
    const srcText = srcTexts[m.sourceIdx];
    const tgtText = tgtTexts[m.targetIdx];
    const srcLevel = getHeadingLevel(srcHeadings[m.sourceIdx]);
    const tgtLevel = getHeadingLevel(tgtHeadings[m.targetIdx]);
    if (normalizeText(srcText) === normalizeText(tgtText)) {
      headingMatched.push({
        source: srcText,
        target: tgtText,
        level: srcLevel
      });
    } else {
      headingChanged.push({
        source: srcText,
        target: tgtText,
        level: srcLevel ?? tgtLevel
      });
    }
  }
  return {
    matched: headingMatched,
    sourceOnly: unmatchedSource.map((i) => srcTexts[i]),
    targetOnly: unmatchedTarget.map((i) => tgtTexts[i]),
    changed: headingChanged
  };
}
function compareMetrics(sourceElements, targetElements, config) {
  const srcMetrics = filterMetrics(sourceElements);
  const tgtMetrics = filterMetrics(targetElements);
  const srcParsed = srcMetrics.map(parseMetricText);
  const tgtParsed = tgtMetrics.map(parseMetricText);
  const srcLabels = srcParsed.map((p) => p.label);
  const tgtLabels = tgtParsed.map((p) => p.label);
  const { matched, unmatchedSource, unmatchedTarget } = matchTexts(
    srcLabels,
    tgtLabels,
    config.labelMatchThreshold
  );
  const metricMatched = [];
  const metricChanged = [];
  for (const m of matched) {
    const src = srcParsed[m.sourceIdx];
    const tgt = tgtParsed[m.targetIdx];
    if (normalizeText(src.value) === normalizeText(tgt.value)) {
      metricMatched.push({
        label: src.label,
        sourceValue: src.value,
        targetValue: tgt.value
      });
    } else {
      metricChanged.push({
        label: src.label,
        sourceValue: src.value,
        targetValue: tgt.value
      });
    }
  }
  return {
    matched: metricMatched,
    changed: metricChanged,
    sourceOnly: unmatchedSource.map((i) => srcParsed[i].label),
    targetOnly: unmatchedTarget.map((i) => tgtParsed[i].label)
  };
}
function compareStatuses(sourceElements, targetElements, config) {
  const srcStatuses = filterStatuses(sourceElements);
  const tgtStatuses = filterStatuses(targetElements);
  const srcParsed = srcStatuses.map(parseMetricText);
  const tgtParsed = tgtStatuses.map(parseMetricText);
  const srcLabels = srcParsed.map((p) => p.label);
  const tgtLabels = tgtParsed.map((p) => p.label);
  const { matched } = matchTexts(srcLabels, tgtLabels, config.labelMatchThreshold);
  const statusMatched = [];
  const statusChanged = [];
  for (const m of matched) {
    const src = srcParsed[m.sourceIdx];
    const tgt = tgtParsed[m.targetIdx];
    if (normalizeText(src.value) === normalizeText(tgt.value)) {
      statusMatched.push({
        label: src.label,
        sourceStatus: src.value,
        targetStatus: tgt.value
      });
    } else {
      statusChanged.push({
        label: src.label,
        sourceStatus: src.value,
        targetStatus: tgt.value
      });
    }
  }
  return {
    matched: statusMatched,
    changed: statusChanged
  };
}
function compareLabels(sourceElements, targetElements, config) {
  const srcLabels = filterLabels(sourceElements);
  const tgtLabels = filterLabels(targetElements);
  const srcTexts = srcLabels.map(getElementText2);
  const tgtTexts = tgtLabels.map(getElementText2);
  const { matched, unmatchedSource, unmatchedTarget } = matchTexts(
    srcTexts,
    tgtTexts,
    config.labelMatchThreshold
  );
  return {
    matched: matched.map((m) => srcTexts[m.sourceIdx]),
    sourceOnly: unmatchedSource.map((i) => srcTexts[i]),
    targetOnly: unmatchedTarget.map((i) => tgtTexts[i])
  };
}
function compareTables(sourceElements, targetElements, config) {
  const srcData = extractStructuredData(sourceElements);
  const tgtData = extractStructuredData(targetElements);
  const srcTables = srcData.tables;
  const tgtTables = tgtData.tables;
  if (srcTables.length === 0 || tgtTables.length === 0) {
    return [];
  }
  const srcTableLabels = srcTables.map((t) => t.label || "");
  const tgtTableLabels = tgtTables.map((t) => t.label || "");
  const { matched } = matchTexts(srcTableLabels, tgtTableLabels, config.labelMatchThreshold);
  const tablePairs = [];
  if (matched.length > 0) {
    for (const m of matched) {
      tablePairs.push({ srcIdx: m.sourceIdx, tgtIdx: m.targetIdx });
    }
  } else if (srcTables.length === 1 && tgtTables.length === 1) {
    tablePairs.push({ srcIdx: 0, tgtIdx: 0 });
  }
  const comparisons = [];
  for (const pair of tablePairs) {
    const srcTable = srcTables[pair.srcIdx];
    const tgtTable = tgtTables[pair.tgtIdx];
    const srcHeaders = srcTable.columns.map((c) => c.header);
    const tgtHeaders = tgtTable.columns.map((c) => c.header);
    const srcHeaderSet = new Set(srcHeaders.map(normalizeText));
    const tgtHeaderSet = new Set(tgtHeaders.map(normalizeText));
    const sourceOnlyColumns = srcHeaders.filter((h) => !tgtHeaderSet.has(normalizeText(h)));
    const targetOnlyColumns = tgtHeaders.filter((h) => !srcHeaderSet.has(normalizeText(h)));
    const columnsMatch = sourceOnlyColumns.length === 0 && targetOnlyColumns.length === 0;
    const cellDifferences = [];
    const commonHeaders = srcHeaders.filter((h) => tgtHeaderSet.has(normalizeText(h)));
    const minRows = Math.min(srcTable.rows.length, tgtTable.rows.length);
    for (let row = 0; row < minRows; row++) {
      if (cellDifferences.length >= config.maxCellDifferences) break;
      for (const header of commonHeaders) {
        const srcColIdx = srcHeaders.indexOf(header);
        const tgtColIdx = tgtHeaders.findIndex((h) => normalizeText(h) === normalizeText(header));
        if (srcColIdx < 0 || tgtColIdx < 0) continue;
        const srcValue = srcTable.rows[row]?.[srcColIdx] ?? "";
        const tgtValue = tgtTable.rows[row]?.[tgtColIdx] ?? "";
        if (normalizeText(srcValue) !== normalizeText(tgtValue)) {
          cellDifferences.push({
            row,
            column: header,
            sourceValue: srcValue,
            targetValue: tgtValue
          });
        }
      }
    }
    comparisons.push({
      sourceLabel: srcTable.label,
      targetLabel: tgtTable.label,
      columnsMatch,
      sourceOnlyColumns,
      targetOnlyColumns,
      sourceRowCount: srcTable.rows.length,
      targetRowCount: tgtTable.rows.length,
      cellDifferences
    });
  }
  return comparisons;
}
function compareHeadingHierarchy(sourceElements, targetElements) {
  const srcHeadings = filterHeadings(sourceElements);
  const tgtHeadings = filterHeadings(targetElements);
  const srcByLevel = /* @__PURE__ */ new Map();
  const tgtByLevel = /* @__PURE__ */ new Map();
  for (const el of srcHeadings) {
    const level = getHeadingLevel(el) ?? 0;
    srcByLevel.set(level, (srcByLevel.get(level) ?? 0) + 1);
  }
  for (const el of tgtHeadings) {
    const level = getHeadingLevel(el) ?? 0;
    tgtByLevel.set(level, (tgtByLevel.get(level) ?? 0) + 1);
  }
  const allLevels = /* @__PURE__ */ new Set([...srcByLevel.keys(), ...tgtByLevel.keys()]);
  const result = [];
  for (const level of [...allLevels].sort()) {
    result.push({
      level,
      sourceCount: srcByLevel.get(level) ?? 0,
      targetCount: tgtByLevel.get(level) ?? 0
    });
  }
  return result;
}
function compareContent(sourceElements, targetElements, config = DEFAULT_CONTENT_COMPARISON_CONFIG) {
  const srcContent = sourceElements.filter(isContentElement2);
  const tgtContent = targetElements.filter(isContentElement2);
  const headings = compareHeadings(srcContent, tgtContent, config);
  const metrics = compareMetrics(srcContent, tgtContent, config);
  const statuses = compareStatuses(srcContent, tgtContent, config);
  const labels = compareLabels(srcContent, tgtContent, config);
  const tables = compareTables(sourceElements, targetElements, config);
  const headingHierarchy = compareHeadingHierarchy(srcContent, tgtContent);
  const contentParity = calculateContentParity(headings, metrics, statuses, labels, tables);
  return {
    headings,
    metrics,
    statuses,
    labels,
    tables,
    headingHierarchy,
    contentParity
  };
}
function calculateContentParity(headings, metrics, statuses, labels, tables) {
  const scores = [];
  const totalHeadings = headings.matched.length + headings.changed.length + headings.sourceOnly.length + headings.targetOnly.length;
  if (totalHeadings > 0) {
    scores.push(headings.matched.length / totalHeadings);
  }
  const totalMetrics = metrics.matched.length + metrics.changed.length + metrics.sourceOnly.length + metrics.targetOnly.length;
  if (totalMetrics > 0) {
    const metricScore = (metrics.matched.length + metrics.changed.length * 0.5) / totalMetrics;
    scores.push(metricScore);
  }
  const totalStatuses = statuses.matched.length + statuses.changed.length;
  if (totalStatuses > 0) {
    scores.push(statuses.matched.length / totalStatuses);
  }
  const totalLabels = labels.matched.length + labels.sourceOnly.length + labels.targetOnly.length;
  if (totalLabels > 0) {
    scores.push(labels.matched.length / totalLabels);
  }
  if (tables.length > 0) {
    let tableScore = 0;
    for (const table of tables) {
      let tScore = table.columnsMatch ? 0.5 : 0;
      if (table.sourceRowCount > 0) {
        const rowRatio = Math.min(
          table.targetRowCount / table.sourceRowCount,
          table.sourceRowCount / table.targetRowCount
        );
        tScore += rowRatio * 0.3;
      } else {
        tScore += 0.3;
      }
      const totalCells = Math.max(table.sourceRowCount, 1) * Math.max(
        table.sourceOnlyColumns.length + table.targetOnlyColumns.length + (table.columnsMatch ? 1 : 0),
        1
      );
      const diffRatio = totalCells > 0 ? 1 - Math.min(table.cellDifferences.length / totalCells, 1) : 1;
      tScore += diffRatio * 0.2;
      tableScore += tScore;
    }
    scores.push(tableScore / tables.length);
  }
  if (scores.length === 0) return 1;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 100) / 100;
}

// src/ai/comparison-report.ts
var DEFAULT_COMPARISON_REPORT_CONFIG = {
  includeComponents: false
};
function generateComparisonReport(source, target, options) {
  const startTime = Date.now();
  const config = { ...DEFAULT_COMPARISON_REPORT_CONFIG, ...options?.config };
  const srcElements = source.elements;
  const tgtElements = target.elements;
  const diff = computeCrossAppDiff(srcElements, tgtElements);
  const navigation = buildNavigationMap(srcElements, tgtElements);
  const sourceRegions = segmentPageRegions(srcElements);
  const targetRegions = segmentPageRegions(tgtElements);
  const layout = compareLayouts(srcElements, tgtElements, sourceRegions, targetRegions);
  const actionParityResults = analyzeActionParity(diff.matchedPairs, srcElements, tgtElements);
  const componentComparison = config.includeComponents && options?.sourceComponents && options?.targetComponents ? compareComponents(options.sourceComponents, options.targetComponents) : null;
  const contentComparison = compareContent(srcElements, tgtElements);
  const sourceData = extractPageData(srcElements);
  extractPageData(tgtElements);
  const sourceFieldCount = Object.keys(sourceData.values).length;
  const matchedDataCount = diff.dataComparisons.length;
  const dataCompleteness = sourceFieldCount > 0 ? Math.round(matchedDataCount / sourceFieldCount * 100) / 100 : 1;
  const formatMatchCount = diff.dataComparisons.filter((c) => c.formatsMatch).length;
  const formatAlignment = matchedDataCount > 0 ? Math.round(formatMatchCount / matchedDataCount * 100) / 100 : 1;
  const presentationAlignment = layout.similarity;
  const totalNavItems = navigation.pairs.length + navigation.sourceOnly.length;
  const navigationParity = totalNavItems > 0 ? Math.round(navigation.pairs.length / totalNavItems * 100) / 100 : 1;
  const totalActionChecks = actionParityResults.length;
  const fullParityCount = actionParityResults.filter((r) => r.missingInTarget.length === 0).length;
  const actionParity = totalActionChecks > 0 ? Math.round(fullParityCount / totalActionChecks * 100) / 100 : 1;
  const contentParity = contentComparison.contentParity;
  const overallScore = Math.round(
    (dataCompleteness * 0.2 + formatAlignment * 0.1 + presentationAlignment * 0.15 + navigationParity * 0.15 + actionParity * 0.15 + contentParity * 0.25) * 100
  ) / 100;
  const issues = [];
  for (const srcId of diff.unmatchedSourceIds) {
    const srcVal = Object.values(sourceData.values).find((v) => v.elementId === srcId);
    if (srcVal) {
      issues.push({
        severity: "warning",
        category: "missing-data",
        description: `Data field "${srcVal.label}" (${srcVal.dataType}) exists in source but has no match in target`,
        sourceElementId: srcId
      });
    }
  }
  for (const comp of diff.dataComparisons) {
    if (!comp.valuesMatch) {
      issues.push({
        severity: "error",
        category: "value-mismatch",
        description: `Value mismatch for "${comp.label}": source="${comp.sourceValue}", target="${comp.targetValue}"`
      });
    }
  }
  for (const fm of diff.formatMismatches) {
    issues.push({
      severity: fm.severity,
      category: "format-mismatch",
      description: fm.description
    });
  }
  for (const ap of actionParityResults) {
    for (const action of ap.missingInTarget) {
      issues.push({
        severity: "warning",
        category: "missing-action",
        description: `Action "${action}" available on source element "${ap.pair.sourceLabel}" is missing in target`,
        sourceElementId: ap.pair.sourceId,
        targetElementId: ap.pair.targetId
      });
    }
  }
  for (const srcId of navigation.sourceOnly) {
    issues.push({
      severity: "warning",
      category: "navigation-gap",
      description: `Navigation item "${srcId}" in source has no match in target`,
      sourceElementId: srcId
    });
  }
  if (layout.similarity < 0.5) {
    issues.push({
      severity: "warning",
      category: "layout-difference",
      description: `Layout similarity is low (${layout.similarity}). Grid: ${layout.gridDiff.sourceGrid.columnCount} cols vs ${layout.gridDiff.targetGrid.columnCount} cols`
    });
  }
  if (componentComparison) {
    for (const src of componentComparison.sourceOnly) {
      issues.push({
        severity: "info",
        category: "component-mismatch",
        description: `Component "${src.name}" (${src.type}) exists in source but not target`
      });
    }
    for (const match of componentComparison.matches) {
      if (match.stateKeyDiff.missing.length > 0) {
        issues.push({
          severity: "warning",
          category: "component-mismatch",
          description: `Component "${match.source.name}": state keys missing in target: ${match.stateKeyDiff.missing.join(", ")}`
        });
      }
    }
  }
  for (const heading of contentComparison.headings.sourceOnly) {
    issues.push({
      severity: "warning",
      category: "content-difference",
      description: `Heading "${heading}" exists in source but not in target`
    });
  }
  for (const heading of contentComparison.headings.targetOnly) {
    issues.push({
      severity: "info",
      category: "content-difference",
      description: `Heading "${heading}" exists in target but not in source`
    });
  }
  for (const change of contentComparison.headings.changed) {
    issues.push({
      severity: "warning",
      category: "content-difference",
      description: `Heading changed: "${change.source}" -> "${change.target}"`
    });
  }
  for (const change of contentComparison.metrics.changed) {
    issues.push({
      severity: "warning",
      category: "content-difference",
      description: `Metric "${change.label}" value differs: "${change.sourceValue}" vs "${change.targetValue}"`
    });
  }
  for (const label of contentComparison.metrics.sourceOnly) {
    issues.push({
      severity: "warning",
      category: "content-difference",
      description: `Metric "${label}" exists in source but not in target`
    });
  }
  for (const change of contentComparison.statuses.changed) {
    issues.push({
      severity: "warning",
      category: "content-difference",
      description: `Status "${change.label}" differs: "${change.sourceStatus}" vs "${change.targetStatus}"`
    });
  }
  for (const table of contentComparison.tables) {
    if (!table.columnsMatch) {
      issues.push({
        severity: "warning",
        category: "content-difference",
        description: `Table "${table.sourceLabel}" column mismatch: source-only=[${table.sourceOnlyColumns.join(", ")}], target-only=[${table.targetOnlyColumns.join(", ")}]`
      });
    }
    if (table.sourceRowCount !== table.targetRowCount) {
      issues.push({
        severity: "info",
        category: "content-difference",
        description: `Table "${table.sourceLabel}" row count differs: ${table.sourceRowCount} vs ${table.targetRowCount}`
      });
    }
    if (table.cellDifferences.length > 0) {
      issues.push({
        severity: "warning",
        category: "content-difference",
        description: `Table "${table.sourceLabel}" has ${table.cellDifferences.length} cell value difference(s)`
      });
    }
  }
  const severityOrder = { error: 0, warning: 1, info: 2 };
  issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;
  const infoCount = issues.filter((i) => i.severity === "info").length;
  const summaryLines = [
    `Cross-app comparison: ${source.page.url} vs ${target.page.url}`,
    `Overall score: ${(overallScore * 100).toFixed(0)}%`,
    `Matched elements: ${diff.matchedPairs.length}`,
    `Unmatched: ${diff.unmatchedSourceIds.length} source, ${diff.unmatchedTargetIds.length} target`,
    `Navigation: ${navigation.pairs.length} matched, ${navigation.sourceOnly.length} source-only, ${navigation.targetOnly.length} target-only`
  ];
  if (componentComparison) {
    summaryLines.push(
      `Components: ${componentComparison.matches.length} matched, ${componentComparison.sourceOnly.length} source-only, ${componentComparison.targetOnly.length} target-only`
    );
  }
  const hMatched = contentComparison.headings.matched.length;
  const hChanged = contentComparison.headings.changed.length;
  const hSrcOnly = contentComparison.headings.sourceOnly.length;
  const hTgtOnly = contentComparison.headings.targetOnly.length;
  const mMatched = contentComparison.metrics.matched.length;
  const mChanged = contentComparison.metrics.changed.length;
  const sMatched = contentComparison.statuses.matched.length;
  const sChanged = contentComparison.statuses.changed.length;
  const totalContent = hMatched + hChanged + hSrcOnly + hTgtOnly + mMatched + mChanged + sMatched + sChanged;
  if (totalContent > 0) {
    summaryLines.push(
      `Content: headings=${hMatched} matched/${hChanged} changed/${hSrcOnly + hTgtOnly} unmatched, metrics=${mMatched} matched/${mChanged} changed, statuses=${sMatched} matched/${sChanged} changed, parity=${(contentParity * 100).toFixed(0)}%`
    );
  }
  summaryLines.push(`Issues: ${errorCount} errors, ${warningCount} warnings, ${infoCount} info`);
  const summary = summaryLines.join("\n");
  const report = {
    sourceUrl: source.page.url,
    targetUrl: target.page.url,
    timestamp: Date.now(),
    durationMs: Date.now() - startTime,
    scores: {
      dataCompleteness,
      formatAlignment,
      presentationAlignment,
      navigationParity,
      actionParity,
      overallScore
    },
    diff,
    navigation,
    layout,
    contentComparison,
    issues,
    summary
  };
  if (componentComparison) {
    report.components = componentComparison;
  }
  return report;
}

// src/ai/design-inspector.ts
var DESIGN_PROPERTIES = [
  // Layout
  "display",
  "position",
  "boxSizing",
  "width",
  "height",
  "minWidth",
  "maxWidth",
  "minHeight",
  "maxHeight",
  "margin",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  "padding",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "overflow",
  "overflowX",
  "overflowY",
  // Flex/Grid
  "flexDirection",
  "flexWrap",
  "justifyContent",
  "alignItems",
  "alignSelf",
  "gap",
  "gridTemplateColumns",
  "gridTemplateRows",
  // Typography
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "textAlign",
  "textTransform",
  "textDecoration",
  "color",
  // Visual
  "backgroundColor",
  "backgroundImage",
  "border",
  "borderRadius",
  "boxShadow",
  "opacity",
  "outline",
  // Effects
  "transform",
  "transition",
  "cursor",
  "zIndex",
  "visibility",
  "pointerEvents"
];
var INTERACTION_STATES = ["hover", "focus", "active", "disabled"];
var DEFAULT_VIEWPORTS = {
  mobile: 375,
  tablet: 768,
  desktop: 1280,
  wide: 1920
};
function getExtendedComputedStyles(el) {
  const computed = window.getComputedStyle(el);
  const styles = {};
  for (const prop of DESIGN_PROPERTIES) {
    styles[prop] = computed.getPropertyValue(camelToKebab(prop)) || computed[prop] || "";
  }
  return styles;
}
function getElementDesignData(el, opts) {
  const rect = el.getBoundingClientRect();
  const styles = getExtendedComputedStyles(el);
  const pseudoElements = [];
  if (opts?.includePseudoElements) {
    for (const selector of ["::before", "::after"]) {
      const pseudo = getPseudoElementStyles(el, selector);
      if (pseudo) {
        pseudoElements.push(pseudo);
      }
    }
  }
  const customProperties = getCSSCustomProperties(el);
  return {
    elementId: opts?.elementId || el.id || el.getAttribute("data-testid") || "",
    label: opts?.label,
    type: opts?.type || el.tagName.toLowerCase(),
    styles,
    pseudoElements: pseudoElements.length > 0 ? pseudoElements : void 0,
    customProperties: Object.keys(customProperties).length > 0 ? customProperties : void 0,
    className: classString(el) || void 0,
    classes: el.classList.length > 0 ? Array.from(el.classList) : void 0,
    rect: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    }
  };
}
async function captureStateVariations(el, states) {
  const targetStates = states || INTERACTION_STATES;
  const defaultStyles = getExtendedComputedStyles(el);
  const results = [];
  results.push({
    state: "default",
    styles: defaultStyles,
    diffFromDefault: []
  });
  for (const stateName of targetStates) {
    if (stateName === "default") continue;
    try {
      applyInteractionState(el, stateName);
      await waitFrame();
      const stateStyles = getExtendedComputedStyles(el);
      const diff = computeStyleDiff(defaultStyles, stateStyles);
      results.push({
        state: stateName,
        styles: stateStyles,
        diffFromDefault: diff
      });
    } finally {
      restoreInteractionState(el, stateName);
      await waitFrame();
    }
  }
  return results;
}
async function captureResponsiveSnapshots(registry, viewports) {
  const viewportEntries = Array.isArray(viewports) ? viewports.map((w) => [`${w}px`, w]) : Object.entries(viewports);
  const docEl = document.documentElement;
  const originalWidth = docEl.style.width;
  const originalMinWidth = docEl.style.minWidth;
  const originalMaxWidth = docEl.style.maxWidth;
  const originalOverflow = docEl.style.overflow;
  const snapshots = [];
  try {
    for (const [label, width] of viewportEntries) {
      docEl.style.width = `${width}px`;
      docEl.style.minWidth = `${width}px`;
      docEl.style.maxWidth = `${width}px`;
      docEl.style.overflow = "hidden";
      void docEl.offsetHeight;
      await waitFrame();
      const elements = registry.getAllElements();
      const elementData = elements.map(
        (regEl) => getElementDesignData(regEl.element, {
          elementId: regEl.id,
          label: regEl.label,
          type: regEl.type
        })
      );
      snapshots.push({
        viewportWidth: width,
        viewportLabel: label,
        elements: elementData,
        timestamp: Date.now()
      });
    }
  } finally {
    docEl.style.width = originalWidth;
    docEl.style.minWidth = originalMinWidth;
    docEl.style.maxWidth = originalMaxWidth;
    docEl.style.overflow = originalOverflow;
  }
  return snapshots;
}
function computeContrastRatio(fgColor, bgColor) {
  const fgLuminance = getRelativeLuminance(parseColor(fgColor));
  const bgLuminance = getRelativeLuminance(parseColor(bgColor));
  const lighter = Math.max(fgLuminance, bgLuminance);
  const darker = Math.min(fgLuminance, bgLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}
function checkContrastCompliance(fgColor, bgColor, fontSize, fontWeight) {
  const ratio = computeContrastRatio(fgColor, bgColor);
  const isLargeText = isLargeTextForContrast(fontSize, fontWeight);
  return {
    ratio,
    passesAA: ratio >= (isLargeText ? 3 : 4.5),
    passesAAA: ratio >= (isLargeText ? 4.5 : 7)
  };
}
function getCSSCustomProperties(el) {
  const result = {};
  const computed = window.getComputedStyle(el);
  for (let i = 0; i < el.style.length; i++) {
    const prop = el.style[i];
    if (prop.startsWith("--")) {
      result[prop] = computed.getPropertyValue(prop).trim();
    }
  }
  try {
    for (const sheet of document.styleSheets) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of rules) {
        if (!(rule instanceof CSSStyleRule)) continue;
        try {
          if (!el.matches(rule.selectorText)) continue;
        } catch {
          continue;
        }
        for (let i = 0; i < rule.style.length; i++) {
          const prop = rule.style[i];
          if (prop.startsWith("--")) {
            result[prop] = computed.getPropertyValue(prop).trim();
          }
        }
      }
    }
  } catch {
  }
  return result;
}
function camelToKebab(str) {
  return str.replace(/([A-Z])/g, "-$1").toLowerCase();
}
function getPseudoElementStyles(el, selector) {
  let computed;
  try {
    computed = window.getComputedStyle(el, selector);
  } catch {
    return null;
  }
  const content = computed.getPropertyValue("content");
  if (!content || content === "none" || content === "normal") {
    return null;
  }
  const styles = {};
  for (const prop of DESIGN_PROPERTIES) {
    const val = computed.getPropertyValue(camelToKebab(prop)) || computed[prop] || "";
    if (val) {
      styles[prop] = val;
    }
  }
  return { selector, content, styles };
}
function computeStyleDiff(defaultStyles, stateStyles) {
  const diffs = [];
  for (const prop of DESIGN_PROPERTIES) {
    if (defaultStyles[prop] !== stateStyles[prop]) {
      diffs.push({
        property: prop,
        defaultValue: defaultStyles[prop],
        stateValue: stateStyles[prop]
      });
    }
  }
  return diffs;
}
function applyInteractionState(el, state) {
  switch (state) {
    case "hover":
      el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
      el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      break;
    case "focus":
      el.focus();
      el.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
      break;
    case "active":
      el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      break;
    case "disabled":
      el.disabled = true;
      break;
  }
}
function restoreInteractionState(el, state) {
  switch (state) {
    case "hover":
      el.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
      el.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
      break;
    case "focus":
      el.blur();
      el.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
      break;
    case "active":
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      break;
    case "disabled":
      el.disabled = false;
      break;
  }
}
function waitFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
function parseColor(color) {
  if (typeof document !== "undefined") {
    const temp = document.createElement("div");
    temp.style.color = color;
    temp.style.display = "none";
    document.body.appendChild(temp);
    const computed = window.getComputedStyle(temp).color;
    document.body.removeChild(temp);
    const match = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (match) {
      return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
    }
  }
  const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgbMatch) {
    return [parseInt(rgbMatch[1], 10), parseInt(rgbMatch[2], 10), parseInt(rgbMatch[3], 10)];
  }
  return [0, 0, 0];
}
function getRelativeLuminance(rgb) {
  const [r, g, b] = rgb.map((c) => {
    const sRGB = c / 255;
    return sRGB <= 0.03928 ? sRGB / 12.92 : Math.pow((sRGB + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function isLargeTextForContrast(fontSize, fontWeight) {
  const sizeInPx = parseFloat(fontSize);
  const weight = parseInt(fontWeight, 10) || (fontWeight === "bold" ? 700 : 400);
  if (sizeInPx >= 24) return true;
  if (sizeInPx >= 18.66 && weight >= 700) return true;
  return false;
}

// src/ai/form-diff.ts
function captureFormSnapshot() {
  if (typeof document === "undefined") {
    return { forms: [], timestamp: Date.now() };
  }
  const forms = [];
  const formElements = document.querySelectorAll("form");
  const allInputs = document.querySelectorAll("input, textarea, select");
  const inputsInForms = /* @__PURE__ */ new Set();
  formElements.forEach((formEl) => {
    const formInputs = [];
    allInputs.forEach((input) => {
      if (formEl.contains(input)) {
        formInputs.push(input);
        inputsInForms.add(input);
      }
    });
    const fields = buildFieldStates(formInputs);
    const submitButton = formEl.querySelector(
      'button[type="submit"], input[type="submit"]'
    );
    forms.push({
      id: formEl.id || `form-${forms.length}`,
      name: formEl.getAttribute("name") || void 0,
      purpose: inferPurposeFromFields(fields),
      fields,
      isValid: fields.every((f) => f.valid),
      submitButton: submitButton?.id || void 0,
      isDirty: fields.some((f) => f.isDirty)
    });
  });
  const orphanInputs = [];
  allInputs.forEach((input) => {
    if (!inputsInForms.has(input)) {
      orphanInputs.push(input);
    }
  });
  if (orphanInputs.length > 0) {
    const fields = buildFieldStates(orphanInputs);
    forms.push({
      id: "implicit-form",
      purpose: inferPurposeFromFields(fields),
      fields,
      isValid: fields.every((f) => f.valid),
      isDirty: fields.some((f) => f.isDirty)
    });
  }
  return {
    forms,
    timestamp: Date.now()
  };
}
function diffFormSnapshots(before, after) {
  const beforeFormIds = new Set(before.forms.map((f) => f.id));
  const afterFormIds = new Set(after.forms.map((f) => f.id));
  const formsAdded = after.forms.filter((f) => !beforeFormIds.has(f.id)).map((f) => f.id);
  const formsRemoved = before.forms.filter((f) => !afterFormIds.has(f.id)).map((f) => f.id);
  const beforeFields = buildFieldMap(before.forms);
  const afterFields = buildFieldMap(after.forms);
  const beforeFieldIds = new Set(beforeFields.keys());
  const afterFieldIds = new Set(afterFields.keys());
  const addedFields = [];
  afterFieldIds.forEach((id) => {
    if (!beforeFieldIds.has(id)) {
      addedFields.push(id);
    }
  });
  const removedFields = [];
  beforeFieldIds.forEach((id) => {
    if (!afterFieldIds.has(id)) {
      removedFields.push(id);
    }
  });
  const changedFields = [];
  beforeFieldIds.forEach((id) => {
    if (!afterFieldIds.has(id)) return;
    const beforeField = beforeFields.get(id);
    const afterField = afterFields.get(id);
    const diff = diffFields(beforeField, afterField);
    if (diff) {
      changedFields.push(diff);
    }
  });
  const timeDeltaMs = after.timestamp - before.timestamp;
  const hasChanges = changedFields.length > 0 || addedFields.length > 0 || removedFields.length > 0 || formsAdded.length > 0 || formsRemoved.length > 0;
  const summary = summarizeFormDiff({
    changedFields,
    addedFields,
    removedFields,
    formsAdded,
    formsRemoved,
    hasChanges
  });
  return {
    changedFields,
    addedFields,
    removedFields,
    formsAdded,
    formsRemoved,
    summary,
    timeDeltaMs,
    hasChanges
  };
}
function summarizeFormDiff(diff) {
  if (!diff.hasChanges) {
    return "No changes detected";
  }
  const parts = [];
  if (diff.formsAdded.length > 0) {
    parts.push(`Forms added: ${diff.formsAdded.join(", ")}`);
  }
  if (diff.formsRemoved.length > 0) {
    parts.push(`Forms removed: ${diff.formsRemoved.join(", ")}`);
  }
  for (const field of diff.changedFields) {
    const fieldLabel = field.fieldName || field.fieldId;
    const changeParts = [];
    if (field.changes.value) {
      const before = field.changes.value.before || "(empty)";
      const after = field.changes.value.after || "(empty)";
      changeParts.push(`value: "${before}" -> "${after}"`);
    }
    if (field.changes.checked) {
      changeParts.push(
        `checked: ${field.changes.checked.before} -> ${field.changes.checked.after}`
      );
    }
    if (field.changes.selectedOptions) {
      const before = field.changes.selectedOptions.before.join(", ") || "(none)";
      const after = field.changes.selectedOptions.after.join(", ") || "(none)";
      changeParts.push(`selected: [${before}] -> [${after}]`);
    }
    if (field.changes.validationError) {
      const before = field.changes.validationError.before || "(none)";
      const after = field.changes.validationError.after || "(none)";
      changeParts.push(`error: "${before}" -> "${after}"`);
    }
    if (field.changes.isValid) {
      changeParts.push(`valid: ${field.changes.isValid.before} -> ${field.changes.isValid.after}`);
    }
    if (field.changes.isDirty) {
      changeParts.push(`dirty: ${field.changes.isDirty.before} -> ${field.changes.isDirty.after}`);
    }
    if (changeParts.length > 0) {
      parts.push(`${fieldLabel}: ${changeParts.join(", ")}`);
    }
  }
  if (diff.addedFields.length > 0) {
    parts.push(`Fields added: ${diff.addedFields.join(", ")}`);
  }
  if (diff.removedFields.length > 0) {
    parts.push(`Fields removed: ${diff.removedFields.join(", ")}`);
  }
  return parts.join("; ");
}
function buildFieldMap(forms) {
  const map = /* @__PURE__ */ new Map();
  for (const form of forms) {
    for (const field of form.fields) {
      map.set(field.id, field);
    }
  }
  return map;
}
function diffFields(before, after) {
  const changes = {};
  if (before.value !== after.value) {
    changes.value = { before: before.value, after: after.value };
  }
  if (before.checked !== after.checked && (before.checked !== void 0 || after.checked !== void 0)) {
    changes.checked = {
      before: before.checked ?? false,
      after: after.checked ?? false
    };
  }
  if (!arraysEqual(before.selectedOptions, after.selectedOptions)) {
    changes.selectedOptions = {
      before: before.selectedOptions ?? [],
      after: after.selectedOptions ?? []
    };
  }
  if (before.error !== after.error) {
    changes.validationError = {
      before: before.error,
      after: after.error
    };
  }
  if (before.isDirty !== after.isDirty) {
    changes.isDirty = {
      before: before.isDirty ?? false,
      after: after.isDirty ?? false
    };
  }
  if (before.valid !== after.valid) {
    changes.isValid = {
      before: before.valid,
      after: after.valid
    };
  }
  if (Object.keys(changes).length === 0) {
    return null;
  }
  return {
    fieldId: after.id,
    fieldName: after.label || before.label,
    fieldType: after.type,
    changes
  };
}
function arraysEqual(a, b) {
  if (a === b) return true;
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
function buildFieldStates(inputs) {
  return inputs.map((el) => {
    const isInput = el instanceof HTMLInputElement;
    const isTextarea = el instanceof HTMLTextAreaElement;
    const isSelect = el instanceof HTMLSelectElement;
    let value = "";
    let checked;
    let selectedOptions;
    let inputType = "text";
    if (isInput) {
      inputType = el.type || "text";
      if (inputType === "checkbox" || inputType === "radio") {
        checked = el.checked;
        value = el.value;
      } else {
        value = el.value;
      }
    } else if (isTextarea) {
      inputType = "textarea";
      value = el.value;
    } else if (isSelect) {
      inputType = "select";
      value = el.value;
      selectedOptions = Array.from(el.selectedOptions).map((o) => o.value);
    }
    const validity = el.validity;
    const valid = validity ? validity.valid : true;
    const validationMessage = el.validationMessage || void 0;
    const label = el.getAttribute("aria-label") || getLabelTextForElement(el) || el.getAttribute("placeholder") || el.id || el.getAttribute("name") || "";
    const defaultValue = el.getAttribute("value") ?? "";
    const isDirty = value !== defaultValue;
    return {
      id: el.id || el.getAttribute("name") || `field-${Math.random().toString(36).slice(2, 8)}`,
      label,
      type: inputType,
      value,
      valid,
      error: validationMessage,
      required: el.hasAttribute("required"),
      touched: (value?.length ?? 0) > 0,
      placeholder: el.getAttribute("placeholder") || void 0,
      isDirty,
      checked,
      selectedOptions
    };
  });
}
function getLabelTextForElement(element) {
  if (typeof document === "undefined") return void 0;
  const id = element.id;
  if (id) {
    const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (label?.textContent?.trim()) return label.textContent.trim();
  }
  const parentLabel = element.closest("label");
  if (parentLabel) {
    const clone = parentLabel.cloneNode(true);
    const inputs = clone.querySelectorAll("input, textarea, select");
    inputs.forEach((inp) => inp.remove());
    const text = clone.textContent?.trim();
    if (text) return text;
  }
  return void 0;
}
function inferPurposeFromFields(fields) {
  const labels = fields.map((f) => f.label.toLowerCase()).join(" ");
  if (labels.includes("email") && labels.includes("password")) {
    if (labels.includes("confirm") || labels.includes("name") || labels.includes("register")) {
      return "Registration";
    }
    return "Login";
  }
  if (labels.includes("search")) return "Search";
  if (labels.includes("address") || labels.includes("city")) return "Address";
  if (labels.includes("card") || labels.includes("payment")) return "Payment";
  if (labels.includes("contact") || labels.includes("message")) return "Contact";
  return "Form";
}

// src/ai/media-queries.ts
var GENERIC_ALT_PATTERNS = [
  /^image$/i,
  /^photo$/i,
  /^img$/i,
  /^picture$/i,
  /^icon$/i,
  /^logo$/i,
  /^banner$/i,
  /^untitled$/i,
  /^placeholder$/i,
  /^thumbnail$/i,
  /^screen\s*shot$/i,
  /^\d+$/
];
function createMediaFindRequest(overrides = {}) {
  return {
    mediaOnly: true,
    skipSettle: true,
    ...overrides
  };
}
function createBrokenImagesFindRequest() {
  return createMediaFindRequest({ brokenOnly: true });
}
function createMissingAltFindRequest() {
  return createMediaFindRequest({ missingAltOnly: true });
}
function createOversizedImagesFindRequest(threshold = 2) {
  return createMediaFindRequest({ oversizeThreshold: threshold });
}
function buildAccessibilityAudit(response) {
  const result = {
    missingAlt: [],
    genericAlt: [],
    decorativeWithoutEmptyAlt: [],
    totalAudited: response.elements.length
  };
  for (const el of response.elements) {
    const meta = el.mediaMetadata;
    if (!meta) continue;
    if (meta.mediaType !== "image" && meta.mediaType !== "picture" && meta.mediaType !== "svg") {
      continue;
    }
    const altText = meta.altText;
    if (altText === void 0 || altText === null) {
      result.missingAlt.push({ id: el.id, src: meta.src, tagName: el.tagName });
    } else if (altText && GENERIC_ALT_PATTERNS.some((p) => p.test(altText.trim()))) {
      result.genericAlt.push({ id: el.id, src: meta.src, altText });
    }
    if (meta.isDecorative && altText && altText.trim() !== "") {
      result.decorativeWithoutEmptyAlt.push({ id: el.id, src: meta.src, altText });
    }
  }
  return result;
}
function buildPerformanceAudit(response, oversizeThreshold = 2, largeTransferThreshold = 500 * 1024) {
  const result = {
    oversized: [],
    largeTransferSize: [],
    notLazyLoaded: [],
    totalAudited: response.elements.length
  };
  for (const el of response.elements) {
    const meta = el.mediaMetadata;
    if (!meta) continue;
    if (meta.oversizeRatio && meta.oversizeRatio > oversizeThreshold) {
      result.oversized.push({
        id: el.id,
        src: meta.src,
        oversizeRatio: meta.oversizeRatio,
        naturalWidth: meta.naturalWidth || 0,
        naturalHeight: meta.naturalHeight || 0,
        renderedWidth: meta.renderedWidth,
        renderedHeight: meta.renderedHeight
      });
    }
    if (meta.transferSize && meta.transferSize > largeTransferThreshold) {
      result.largeTransferSize.push({
        id: el.id,
        src: meta.src,
        transferSize: meta.transferSize
      });
    }
    if (!meta.lazyLoading && meta.mediaType === "image" && el.state.inViewport === false) {
      result.notLazyLoaded.push({
        id: el.id,
        src: meta.src,
        inViewport: false
      });
    }
  }
  return result;
}

// src/ai/media-snapshot.ts
function captureMediaSnapshot(element, elementId, maxSize = 512) {
  try {
    const tag = element.tagName.toLowerCase();
    let canvas;
    let width;
    let height;
    if (tag === "canvas") {
      const sourceCanvas = element;
      width = sourceCanvas.width;
      height = sourceCanvas.height;
      const scale = Math.min(1, maxSize / Math.max(width, height));
      const scaledW = Math.round(width * scale);
      const scaledH = Math.round(height * scale);
      canvas = document.createElement("canvas");
      canvas.width = scaledW;
      canvas.height = scaledH;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(sourceCanvas, 0, 0, scaledW, scaledH);
      width = scaledW;
      height = scaledH;
    } else if (tag === "img") {
      const img = element;
      if (!img.complete || img.naturalWidth === 0) return null;
      width = img.naturalWidth;
      height = img.naturalHeight;
      const scale = Math.min(1, maxSize / Math.max(width, height));
      const scaledW = Math.round(width * scale);
      const scaledH = Math.round(height * scale);
      canvas = document.createElement("canvas");
      canvas.width = scaledW;
      canvas.height = scaledH;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, scaledW, scaledH);
      width = scaledW;
      height = scaledH;
    } else if (tag === "video") {
      const video = element;
      if (video.readyState < 2) return null;
      width = video.videoWidth;
      height = video.videoHeight;
      const scale = Math.min(1, maxSize / Math.max(width, height));
      const scaledW = Math.round(width * scale);
      const scaledH = Math.round(height * scale);
      canvas = document.createElement("canvas");
      canvas.width = scaledW;
      canvas.height = scaledH;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, scaledW, scaledH);
      width = scaledW;
      height = scaledH;
    } else if (tag === "svg") {
      return captureSvgSnapshot(element, elementId, maxSize);
    } else {
      return null;
    }
    const dataUrl = canvas.toDataURL("image/png");
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
    return {
      data: base64,
      width,
      height,
      mediaType: "image/png",
      elementId,
      timestamp: Date.now()
    };
  } catch {
    return null;
  }
}
function captureSvgSnapshot(svg, elementId, maxSize) {
  try {
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svg);
    const rect = svg.getBoundingClientRect();
    let width = rect.width || 100;
    let height = rect.height || 100;
    const scale = Math.min(1, maxSize / Math.max(width, height));
    width = Math.round(width * scale);
    height = Math.round(height * scale);
    return {
      data: btoa(unescape(encodeURIComponent(svgString))),
      width,
      height,
      mediaType: "image/svg+xml",
      elementId,
      timestamp: Date.now()
    };
  } catch {
    return null;
  }
}
async function compareMediaSnapshots(a, b) {
  if (a.mediaType === "image/svg+xml" || b.mediaType === "image/svg+xml") {
    return { identical: false, diffPercentage: -1, error: "SVG comparison not supported" };
  }
  try {
    const imgA = await loadBase64Image(a.data);
    const imgB = await loadBase64Image(b.data);
    const width = Math.max(imgA.width, imgB.width);
    const height = Math.max(imgA.height, imgB.height);
    const canvasA = document.createElement("canvas");
    canvasA.width = width;
    canvasA.height = height;
    const ctxA = canvasA.getContext("2d");
    if (!ctxA) return { identical: false, diffPercentage: -1, error: "Failed to get 2d context" };
    ctxA.drawImage(imgA, 0, 0);
    const dataA = ctxA.getImageData(0, 0, width, height);
    const canvasB = document.createElement("canvas");
    canvasB.width = width;
    canvasB.height = height;
    const ctxB = canvasB.getContext("2d");
    if (!ctxB) return { identical: false, diffPercentage: -1, error: "Failed to get 2d context" };
    ctxB.drawImage(imgB, 0, 0);
    const dataB = ctxB.getImageData(0, 0, width, height);
    const diffCanvas = document.createElement("canvas");
    diffCanvas.width = width;
    diffCanvas.height = height;
    const diffCtx = diffCanvas.getContext("2d");
    if (!diffCtx)
      return { identical: false, diffPercentage: -1, error: "Failed to get 2d context" };
    const diffData = diffCtx.createImageData(width, height);
    let diffCount = 0;
    let minX = width, minY = height, maxX = 0, maxY = 0;
    const totalPixels = width * height;
    const threshold = 10;
    for (let i = 0; i < dataA.data.length; i += 4) {
      const rDiff = Math.abs(dataA.data[i] - dataB.data[i]);
      const gDiff = Math.abs(dataA.data[i + 1] - dataB.data[i + 1]);
      const bDiff = Math.abs(dataA.data[i + 2] - dataB.data[i + 2]);
      if (rDiff > threshold || gDiff > threshold || bDiff > threshold) {
        diffCount++;
        const px = i / 4 % width;
        const py = Math.floor(i / 4 / width);
        minX = Math.min(minX, px);
        minY = Math.min(minY, py);
        maxX = Math.max(maxX, px);
        maxY = Math.max(maxY, py);
        diffData.data[i] = 255;
        diffData.data[i + 1] = 0;
        diffData.data[i + 2] = 0;
        diffData.data[i + 3] = 200;
      } else {
        diffData.data[i] = dataA.data[i];
        diffData.data[i + 1] = dataA.data[i + 1];
        diffData.data[i + 2] = dataA.data[i + 2];
        diffData.data[i + 3] = 80;
      }
    }
    diffCtx.putImageData(diffData, 0, 0);
    const diffPercentage = diffCount / totalPixels * 100;
    return {
      identical: diffCount === 0,
      diffPercentage: Math.round(diffPercentage * 100) / 100,
      diffRegion: diffCount > 0 ? {
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1
      } : void 0,
      diffImage: diffCount > 0 ? diffCanvas.toDataURL("image/png").replace(/^data:image\/png;base64,/, "") : void 0
    };
  } catch {
    return { identical: false, diffPercentage: 100 };
  }
}
function loadBase64Image(base64) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = `data:image/png;base64,${base64}`;
  });
}
async function captureElementScreenshot(element, elementId, options = {}) {
  const { maxSize = 1024, background = "white", padding = 0 } = options;
  try {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const captureW = Math.ceil(rect.width) + padding * 2;
    const captureH = Math.ceil(rect.height) + padding * 2;
    const scale = Math.min(1, maxSize / Math.max(captureW, captureH));
    const scaledW = Math.round(captureW * scale);
    const scaledH = Math.round(captureH * scale);
    const clone = element.cloneNode(true);
    inlineComputedStyles(element, clone);
    const serialized = new XMLSerializer().serializeToString(clone);
    const svgMarkup = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${captureW}" height="${captureH}">
        <foreignObject width="100%" height="100%">
          <div xmlns="http://www.w3.org/1999/xhtml" style="
            width: ${captureW}px;
            height: ${captureH}px;
            padding: ${padding}px;
            background: ${background};
            overflow: hidden;
          ">${serialized}</div>
        </foreignObject>
      </svg>
    `;
    const svgBlob = new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    try {
      const img = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = scaledW;
      canvas.height = scaledH;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, scaledW, scaledH);
      ctx.drawImage(img, 0, 0, scaledW, scaledH);
      const data = canvas.toDataURL("image/png").replace(/^data:image\/png;base64,/, "");
      return {
        data,
        width: scaledW,
        height: scaledH,
        mediaType: "image/png",
        elementId,
        timestamp: Date.now()
      };
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return null;
  }
}
function inlineComputedStyles(source, target) {
  const computed = window.getComputedStyle(source);
  for (let i = 0; i < computed.length; i++) {
    const prop = computed[i];
    target.style.setProperty(prop, computed.getPropertyValue(prop));
  }
  const sourceChildren = source.children;
  const targetChildren = target.children;
  for (let i = 0; i < sourceChildren.length && i < targetChildren.length; i++) {
    if (sourceChildren[i] instanceof HTMLElement && targetChildren[i] instanceof HTMLElement) {
      inlineComputedStyles(sourceChildren[i], targetChildren[i]);
    }
  }
}
async function compareVisualRegression(baseline, current, options = {}) {
  const {
    pixelThreshold = 10,
    failureThreshold = 0.1,
    failureThresholdType = "percent",
    blur = 0
  } = options;
  try {
    const imgA = await loadBase64Image(baseline.data);
    const imgB = await loadBase64Image(current.data);
    const width = Math.max(imgA.width, imgB.width);
    const height = Math.max(imgA.height, imgB.height);
    const totalPixels = width * height;
    const canvasA = document.createElement("canvas");
    canvasA.width = width;
    canvasA.height = height;
    const ctxA = canvasA.getContext("2d");
    if (!ctxA) {
      return {
        pass: false,
        diffPixelCount: 0,
        diffPercentage: 100,
        totalPixels: 0,
        dimensions: { width: 0, height: 0 }
      };
    }
    if (blur > 0) ctxA.filter = `blur(${blur}px)`;
    ctxA.drawImage(imgA, 0, 0);
    const dataA = ctxA.getImageData(0, 0, width, height);
    const canvasB = document.createElement("canvas");
    canvasB.width = width;
    canvasB.height = height;
    const ctxB = canvasB.getContext("2d");
    if (!ctxB) {
      return {
        pass: false,
        diffPixelCount: 0,
        diffPercentage: 100,
        totalPixels: 0,
        dimensions: { width: 0, height: 0 }
      };
    }
    if (blur > 0) ctxB.filter = `blur(${blur}px)`;
    ctxB.drawImage(imgB, 0, 0);
    const dataB = ctxB.getImageData(0, 0, width, height);
    const diffCanvas = document.createElement("canvas");
    diffCanvas.width = width;
    diffCanvas.height = height;
    const diffCtx = diffCanvas.getContext("2d");
    if (!diffCtx) {
      return {
        pass: false,
        diffPixelCount: 0,
        diffPercentage: 100,
        totalPixels: 0,
        dimensions: { width: 0, height: 0 }
      };
    }
    const diffData = diffCtx.createImageData(width, height);
    let diffCount = 0;
    let minX = width, minY = height, maxX = 0, maxY = 0;
    for (let i = 0; i < dataA.data.length; i += 4) {
      const rDiff = Math.abs(dataA.data[i] - dataB.data[i]);
      const gDiff = Math.abs(dataA.data[i + 1] - dataB.data[i + 1]);
      const bDiff = Math.abs(dataA.data[i + 2] - dataB.data[i + 2]);
      if (rDiff > pixelThreshold || gDiff > pixelThreshold || bDiff > pixelThreshold) {
        diffCount++;
        const px = i / 4 % width;
        const py = Math.floor(i / 4 / width);
        minX = Math.min(minX, px);
        minY = Math.min(minY, py);
        maxX = Math.max(maxX, px);
        maxY = Math.max(maxY, py);
        diffData.data[i] = 255;
        diffData.data[i + 1] = 0;
        diffData.data[i + 2] = 0;
        diffData.data[i + 3] = 200;
      } else {
        diffData.data[i] = dataA.data[i];
        diffData.data[i + 1] = dataA.data[i + 1];
        diffData.data[i + 2] = dataA.data[i + 2];
        diffData.data[i + 3] = 80;
      }
    }
    diffCtx.putImageData(diffData, 0, 0);
    const diffPercentage = diffCount / totalPixels * 100;
    let pass;
    if (failureThresholdType === "percent") {
      pass = diffPercentage <= failureThreshold;
    } else {
      pass = diffCount <= failureThreshold;
    }
    return {
      pass,
      diffPixelCount: diffCount,
      diffPercentage: Math.round(diffPercentage * 100) / 100,
      totalPixels,
      diffRegion: diffCount > 0 ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : void 0,
      diffImage: diffCount > 0 ? diffCanvas.toDataURL("image/png").replace(/^data:image\/png;base64,/, "") : void 0,
      dimensions: { width, height }
    };
  } catch {
    return {
      pass: false,
      diffPixelCount: 0,
      diffPercentage: 100,
      totalPixels: 0,
      dimensions: { width: 0, height: 0 }
    };
  }
}

// src/ai/media-analysis.ts
function getParentContext(element) {
  let current = element.parentElement;
  let depth = 0;
  while (current && depth < 5) {
    const tag = current.tagName.toLowerCase();
    const role = current.getAttribute("role");
    const ariaLabel = current.getAttribute("aria-label");
    const testId = current.getAttribute("data-testid");
    let label;
    if (ariaLabel) {
      label = ariaLabel;
    } else if (testId) {
      label = testId.replace(/[-_]/g, " ");
    } else {
      const heading = current.querySelector("h1, h2, h3, h4, h5, h6");
      if (heading && heading !== element) {
        label = heading.textContent?.trim();
      }
    }
    if (label) {
      const containerType = role || tag;
      return `inside a ${containerType} titled '${label.substring(0, 50)}'`;
    }
    if (["article", "section", "aside", "nav", "main", "header", "footer", "dialog", "form"].includes(
      tag
    )) {
      return `inside a ${tag}`;
    }
    current = current.parentElement;
    depth++;
  }
  return void 0;
}
function getSiblingLabels(element, maxLabels = 3) {
  const parent = element.parentElement;
  if (!parent) return [];
  const labels = [];
  const siblings = Array.from(parent.children);
  for (const sibling of siblings) {
    if (sibling === element) continue;
    if (labels.length >= maxLabels) break;
    const text = sibling.textContent?.trim();
    if (text && text.length > 0 && text.length <= 100) {
      labels.push(text.substring(0, 50));
    }
  }
  return labels;
}
function analyzeMediaElement(registeredElement, maxSize = 512) {
  const { element, id } = registeredElement;
  const meta = registeredElement.mediaMetadata;
  const snapshot = captureMediaSnapshot(element, id, maxSize);
  if (!snapshot) return null;
  const context = {
    elementId: id,
    altText: meta?.altText,
    src: meta?.src,
    role: element.getAttribute("role") || void 0,
    parentContext: getParentContext(element),
    siblingLabels: getSiblingLabels(element),
    loadingState: meta?.loadingState || "unknown",
    dimensions: {
      natural: [meta?.naturalWidth || 0, meta?.naturalHeight || 0],
      rendered: [meta?.renderedWidth || 0, meta?.renderedHeight || 0]
    }
  };
  return {
    image: {
      data: snapshot.data,
      mediaType: "image/png",
      width: snapshot.width,
      height: snapshot.height
    },
    context
  };
}
function analyzeMediaBatch(elements, maxSize = 512) {
  const results = [];
  for (const el of elements) {
    const result = analyzeMediaElement(el, maxSize);
    if (result) results.push(result);
  }
  return results;
}
function analyzeMediaPage(allMediaElements, maxElements = 20, maxSize = 512, includeContext = true) {
  const visible = allMediaElements.filter((el) => {
    try {
      const state = el.getState();
      return state.visible;
    } catch {
      return false;
    }
  }).slice(0, maxElements);
  const results = [];
  for (const el of visible) {
    const result = analyzeMediaElement(el, maxSize);
    if (result) {
      if (!includeContext) {
        result.context = {
          elementId: result.context.elementId,
          loadingState: result.context.loadingState,
          dimensions: result.context.dimensions
        };
      }
      results.push(result);
    }
  }
  return results;
}

// src/ai/background-observer.ts
var DEFAULT_CONFIG2 = {
  minCaptureIntervalMs: 5e3,
  maxCaptureIntervalMs: 6e4,
  maxConsecutiveErrors: 10
};
var BackgroundObserver = class {
  constructor(deps, config = {}) {
    this.intervalId = null;
    this.lastSnapshot = null;
    this.lastContentHash = null;
    this.lastCaptureTime = 0;
    this.running = false;
    this.consecutiveErrors = 0;
    this.deps = deps;
    this.config = { ...DEFAULT_CONFIG2, ...config };
  }
  /** Start background observation. */
  start() {
    if (this.running) return;
    this.running = true;
    this.lastCaptureTime = Date.now();
    void this.tick();
    this.intervalId = setInterval(() => {
      void this.tick();
    }, this.config.minCaptureIntervalMs);
  }
  /** Stop background observation. */
  stop() {
    this.running = false;
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
  /** Whether the observer is currently running. */
  get isRunning() {
    return this.running;
  }
  async tick() {
    if (!this.running) return;
    try {
      const controlSnapshot = this.deps.createControlSnapshot();
      const snapshot = this.deps.snapshotManager.createSnapshot(controlSnapshot);
      const now = Date.now();
      const timeSinceLastCapture = now - this.lastCaptureTime;
      const forceCapture = timeSinceLastCapture >= this.config.maxCaptureIntervalMs;
      let isSignificant = false;
      if (this.lastSnapshot) {
        const diff = computeDiff(this.lastSnapshot, snapshot);
        isSignificant = hasSignificantChanges(diff);
      } else {
        isSignificant = true;
      }
      if (!isSignificant && !forceCapture) {
        return;
      }
      const textContent = this.serializeSnapshotText(snapshot);
      const contentHash = await this.computeHash(textContent);
      if (contentHash === this.lastContentHash && !forceCapture) {
        return;
      }
      const payload = {
        textContent,
        contentHash,
        sourceType: "ui_bridge",
        captureMode: "white_box",
        appName: snapshot.page.title || "Unknown",
        windowTitle: snapshot.page.title || "",
        url: snapshot.page.url || "",
        elementCount: snapshot.elements.length,
        metadataJson: JSON.stringify({
          pageType: snapshot.page.pageType,
          formCount: snapshot.forms?.length || 0,
          modalCount: snapshot.activeModals?.length || 0,
          elementCounts: snapshot.elementCounts,
          snapshotId: snapshot.snapshotId
        })
      };
      await this.deps.onCapture(payload);
      this.lastSnapshot = snapshot;
      this.lastContentHash = contentHash;
      this.lastCaptureTime = now;
      this.consecutiveErrors = 0;
    } catch (err) {
      this.consecutiveErrors++;
      console.warn(`[BackgroundObserver] Capture failed (${this.consecutiveErrors}):`, err);
      if (this.consecutiveErrors >= this.config.maxConsecutiveErrors) {
        console.error("[BackgroundObserver] Too many consecutive errors, stopping.");
        this.stop();
      }
    }
  }
  /**
   * Serialize a semantic snapshot's visible text for full-text search indexing.
   * Concatenates element descriptions, text content, form labels, and modal content.
   */
  serializeSnapshotText(snapshot) {
    const parts = [];
    if (snapshot.page?.title) parts.push(snapshot.page.title);
    if (snapshot.page?.url) parts.push(snapshot.page.url);
    for (const el of snapshot.elements) {
      if (el.description) parts.push(el.description);
      if (el.state?.textContent) parts.push(el.state.textContent);
      if (el.state?.value) parts.push(el.state.value);
    }
    for (const form of snapshot.forms || []) {
      for (const field of form.fields || []) {
        if (field.label) parts.push(field.label);
        if (field.value) parts.push(String(field.value));
      }
    }
    for (const modal of snapshot.activeModals || []) {
      if (modal.title) parts.push(modal.title);
    }
    return parts.join(" ");
  }
  /**
   * Compute SHA-256 hash of normalized text.
   * Uses crypto.subtle when available (secure contexts), falls back to a
   * simple string hash for HTTP dev environments. The fallback is not
   * cryptographically secure but sufficient for deduplication.
   */
  async computeHash(text) {
    const normalized = text.trim().toLowerCase();
    if (typeof crypto !== "undefined" && crypto.subtle) {
      const encoder = new TextEncoder();
      const data = encoder.encode(normalized);
      const hashBuffer = await crypto.subtle.digest("SHA-256", data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    let hash = 2166136261;
    for (let i = 0; i < normalized.length; i++) {
      hash ^= normalized.charCodeAt(i);
      hash = hash * 16777619 >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  }
};

// src/ai/wait-for.ts
async function waitFor(predicate, timeoutMs, options = {}) {
  const { baseUrl = "", fetchImpl = fetch, signal } = options;
  const url = `${baseUrl.replace(/\/+$/, "")}/ui-bridge/ai/wait-for`;
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ predicate, timeoutMs }),
    signal
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `ai/wait-for: HTTP ${response.status} ${response.statusText}${text ? ` \u2014 ${text}` : ""}`
    );
  }
  const envelope = await response.json();
  if (!envelope.success || !envelope.data) {
    throw new Error(`ai/wait-for: ${envelope.error ?? "request failed"}`);
  }
  return envelope.data;
}

// src/ai/wait-for-element.ts
var WAIT_FOR_ELEMENT_STATES = [
  "present",
  "visible",
  "enabled",
  "disabled",
  "value-not-empty",
  "value-empty",
  "checked",
  "unchecked",
  "absent"
];
function evaluateElementPredicate(snapshot, predicate) {
  const { registered, state } = snapshot;
  switch (predicate) {
    case "absent": {
      if (!registered) return true;
      if (state && state.visible === false) return true;
      return false;
    }
    case "present": {
      if (!registered) return false;
      return Boolean(state?.rect);
    }
    case "visible": {
      if (!registered || !state) return false;
      if (state.visible !== true) return false;
      const w = state.rect?.width ?? 0;
      const h = state.rect?.height ?? 0;
      return w > 0 && h > 0;
    }
    case "enabled": {
      if (!registered || !state) return false;
      return state.enabled !== false;
    }
    case "disabled": {
      if (!registered || !state) return false;
      return state.enabled === false;
    }
    case "value-not-empty": {
      if (!registered || !state) return false;
      if (typeof state.value === "string" && state.value.length > 0) return true;
      if (state.checked === true) return true;
      return false;
    }
    case "value-empty": {
      if (!registered || !state) return false;
      if (typeof state.value === "string" && state.value.length > 0) return false;
      return true;
    }
    case "checked": {
      if (!registered || !state) return false;
      return state.checked === true;
    }
    case "unchecked": {
      if (!registered || !state) return false;
      return state.checked !== true;
    }
    default: {
      return false;
    }
  }
}
function validateWaitForElementRequest(body) {
  const hasId = typeof body.elementId === "string" && body.elementId.length > 0;
  const hasSelector = typeof body.selector === "string" && body.selector.length > 0;
  if (!hasId && !hasSelector) {
    return "wait-for-element: 'elementId' or 'selector' is required";
  }
  if (typeof body.state !== "string") {
    return "wait-for-element: 'state' is required";
  }
  if (!WAIT_FOR_ELEMENT_STATES.includes(body.state)) {
    return `wait-for-element: invalid state '${body.state}', expected one of ${WAIT_FOR_ELEMENT_STATES.join("|")}`;
  }
  if (body.timeoutMs !== void 0) {
    if (typeof body.timeoutMs !== "number" || !Number.isFinite(body.timeoutMs)) {
      return "wait-for-element: 'timeoutMs' must be a number";
    }
    if (body.timeoutMs < 0 || body.timeoutMs > 3e4) {
      return "wait-for-element: 'timeoutMs' must be between 0 and 30000";
    }
  }
  if (body.pollMs !== void 0) {
    if (typeof body.pollMs !== "number" || !Number.isFinite(body.pollMs)) {
      return "wait-for-element: 'pollMs' must be a number";
    }
    if (body.pollMs < 10) {
      return "wait-for-element: 'pollMs' must be >= 10";
    }
  }
  return null;
}
function pollWaitForElement(options) {
  const {
    takeSnapshot,
    predicate,
    timeoutMs,
    pollMs,
    now = () => Date.now(),
    schedule = (cb, ms) => {
      setTimeout(cb, ms);
    }
  } = options;
  return new Promise((resolve) => {
    const started = now();
    let lastObserved = null;
    let done = false;
    const tick = () => {
      if (done) return;
      const snapshot = takeSnapshot();
      if (snapshot.registered || snapshot.state) {
        lastObserved = snapshot;
      }
      if (evaluateElementPredicate(snapshot, predicate)) {
        done = true;
        resolve({
          found: true,
          durationMs: now() - started,
          observed: snapshot
        });
        return;
      }
      const elapsed = now() - started;
      if (elapsed >= timeoutMs) {
        done = true;
        resolve({
          found: false,
          durationMs: elapsed,
          observed: lastObserved
        });
        return;
      }
      schedule(tick, pollMs);
    };
    tick();
  });
}
async function waitForElement(request, options = {}) {
  const { baseUrl = "", fetchImpl = fetch, signal } = options;
  const url = `${baseUrl.replace(/\/+$/, "")}/ui-bridge/ai/wait-for-element`;
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
    signal
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `ai/wait-for-element: HTTP ${response.status} ${response.statusText}${text ? ` \u2014 ${text}` : ""}`
    );
  }
  const envelope = await response.json();
  if (!envelope.success || !envelope.data) {
    throw new Error(`ai/wait-for-element: ${envelope.error ?? "request failed"}`);
  }
  return envelope.data;
}
function snapshotFromRegisteredElement(el) {
  if (!el) return { registered: false, state: null };
  let state;
  try {
    state = el.getState() ?? null;
  } catch {
    state = null;
  }
  return { registered: true, state };
}
function serializeSnapshot(el, snapshot, fallbackId) {
  return {
    id: el?.id ?? fallbackId ?? "",
    type: el?.type,
    label: el?.label,
    registered: snapshot.registered,
    fromRegistry: snapshot.registered,
    state: snapshot.state
  };
}

// src/ai/network-probe.ts
async function networkProbe(request, options = {}) {
  const { baseUrl = "", fetchImpl = fetch, signal } = options;
  const url = `${baseUrl.replace(/\/+$/, "")}/ui-bridge/ai/network-probe`;
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
    signal
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `ai/network-probe: HTTP ${response.status} ${response.statusText}${text ? ` \u2014 ${text}` : ""}`
    );
  }
  const envelope = await response.json();
  if (!envelope.success || !envelope.data) {
    throw new Error(`ai/network-probe: ${envelope.error ?? "request failed"}`);
  }
  return envelope.data;
}

exports.AssertionExecutor = AssertionExecutor;
exports.BackgroundObserver = BackgroundObserver;
exports.BookmarkStore = BookmarkStore;
exports.ChangeTracker = ChangeTracker;
exports.DEFAULT_ACTION_PARITY_CONFIG = DEFAULT_ACTION_PARITY_CONFIG;
exports.DEFAULT_ALIAS_CONFIG = DEFAULT_ALIAS_CONFIG;
exports.DEFAULT_ASSERTION_CONFIG = DEFAULT_ASSERTION_CONFIG;
exports.DEFAULT_COMPARISON_REPORT_CONFIG = DEFAULT_COMPARISON_REPORT_CONFIG;
exports.DEFAULT_COMPONENT_COMPARISON_CONFIG = DEFAULT_COMPONENT_COMPARISON_CONFIG;
exports.DEFAULT_CONTENT_COMPARISON_CONFIG = DEFAULT_CONTENT_COMPARISON_CONFIG;
exports.DEFAULT_CROSS_APP_DIFF_CONFIG = DEFAULT_CROSS_APP_DIFF_CONFIG;
exports.DEFAULT_DATA_EXTRACTION_CONFIG = DEFAULT_DATA_EXTRACTION_CONFIG;
exports.DEFAULT_DIFF_CONFIG = DEFAULT_DIFF_CONFIG;
exports.DEFAULT_EXECUTOR_CONFIG = DEFAULT_EXECUTOR_CONFIG;
exports.DEFAULT_FORMAT_ANALYSIS_CONFIG = DEFAULT_FORMAT_ANALYSIS_CONFIG;
exports.DEFAULT_FUZZY_CONFIG = DEFAULT_FUZZY_CONFIG;
exports.DEFAULT_LAYOUT_COMPARISON_CONFIG = DEFAULT_LAYOUT_COMPARISON_CONFIG;
exports.DEFAULT_NAVIGATION_MAP_CONFIG = DEFAULT_NAVIGATION_MAP_CONFIG;
exports.DEFAULT_REGION_SEGMENTATION_CONFIG = DEFAULT_REGION_SEGMENTATION_CONFIG;
exports.DEFAULT_SEARCH_CONFIG = DEFAULT_SEARCH_CONFIG;
exports.DEFAULT_SNAPSHOT_CONFIG = DEFAULT_SNAPSHOT_CONFIG;
exports.DEFAULT_TABLE_EXTRACTION_CONFIG = DEFAULT_TABLE_EXTRACTION_CONFIG;
exports.DEFAULT_VIEWPORTS = DEFAULT_VIEWPORTS;
exports.ErrorCodes = ErrorCodes;
exports.NLActionExecutor = NLActionExecutor;
exports.SearchEngine = SearchEngine;
exports.SemanticDiffManager = SemanticDiffManager;
exports.SemanticSnapshotManager = SemanticSnapshotManager;
exports.WAIT_FOR_ELEMENT_STATES = WAIT_FOR_ELEMENT_STATES;
exports.__resetGlobalBookmarkStoreForTest = __resetGlobalBookmarkStoreForTest;
exports.analyzeActionParity = analyzeActionParity;
exports.analyzeFormat = analyzeFormat;
exports.analyzeMediaBatch = analyzeMediaBatch;
exports.analyzeMediaElement = analyzeMediaElement;
exports.analyzeMediaPage = analyzeMediaPage;
exports.analyzePageFormats = analyzePageFormats;
exports.analyzeStructuredChanges = analyzeStructuredChanges;
exports.areSynonyms = areSynonyms;
exports.buildAccessibilityAudit = buildAccessibilityAudit;
exports.buildNavigationMap = buildNavigationMap;
exports.buildPerformanceAudit = buildPerformanceAudit;
exports.captureElementScreenshot = captureElementScreenshot;
exports.captureFormSnapshot = captureFormSnapshot;
exports.captureMediaSnapshot = captureMediaSnapshot;
exports.captureResponsiveSnapshots = captureResponsiveSnapshots;
exports.captureStateVariations = captureStateVariations;
exports.checkContrastCompliance = checkContrastCompliance;
exports.classifyDataType = classifyDataType;
exports.classifyRegionType = classifyRegionType;
exports.classifyStatusDirection = classifyStatusDirection;
exports.compareComponents = compareComponents;
exports.compareContent = compareContent;
exports.compareFormats = compareFormats;
exports.compareLayouts = compareLayouts;
exports.compareMediaSnapshots = compareMediaSnapshots;
exports.compareVisualRegression = compareVisualRegression;
exports.computeContrastRatio = computeContrastRatio;
exports.computeCrossAppDiff = computeCrossAppDiff;
exports.computeDiff = computeDiff;
exports.computeProminence = computeProminence;
exports.createAssertionExecutor = createAssertionExecutor;
exports.createBrokenImagesFindRequest = createBrokenImagesFindRequest;
exports.createChangeTracker = createChangeTracker;
exports.createDiffManager = createDiffManager;
exports.createErrorContext = createErrorContext;
exports.createMediaFindRequest = createMediaFindRequest;
exports.createMissingAltFindRequest = createMissingAltFindRequest;
exports.createNLActionExecutor = createNLActionExecutor;
exports.createOversizedImagesFindRequest = createOversizedImagesFindRequest;
exports.createSearchEngine = createSearchEngine;
exports.createSimpleError = createSimpleError;
exports.createSnapshotManager = createSnapshotManager;
exports.decomposeTarget = decomposeTarget;
exports.describeAction = describeAction;
exports.describeDiff = describeDiff;
exports.detectFormatPattern = detectFormatPattern;
exports.detectGridStructure = detectGridStructure;
exports.detectList = detectList;
exports.detectTable = detectTable;
exports.diffFormSnapshots = diffFormSnapshots;
exports.discoverForms = discoverForms;
exports.evaluateElementPredicate = evaluateElementPredicate;
exports.extractModifiers = extractModifiers;
exports.extractPageData = extractPageData;
exports.extractStructuredData = extractStructuredData;
exports.find = find;
exports.findAllMatches = findAllMatches;
exports.findBestMatch = findBestMatch;
exports.formatErrorContext = formatErrorContext;
exports.fuzzyContains = fuzzyContains;
exports.fuzzyMatch = fuzzyMatch;
exports.generateAliases = generateAliases;
exports.generateComparisonReport = generateComparisonReport;
exports.generateDescription = generateDescription;
exports.generateDiffSummary = generateDiffSummary;
exports.generateElementDescription = generateElementDescription;
exports.generateNgrams = generateNgrams;
exports.generatePageSummary = generatePageSummary;
exports.generatePurpose = generatePurpose;
exports.generateSnapshotSummary = generateSnapshotSummary;
exports.generateSuggestedActions = generateSuggestedActions;
exports.getBestRecoverySuggestion = getBestRecoverySuggestion;
exports.getCSSCustomProperties = getCSSCustomProperties;
exports.getElementDesignData = getElementDesignData;
exports.getExtendedComputedStyles = getExtendedComputedStyles;
exports.getGlobalBookmarkStore = getGlobalBookmarkStore;
exports.getSynonyms = getSynonyms;
exports.hasSignificantChanges = hasSignificantChanges;
exports.inferPageType = inferPageType;
exports.isNavigationElement = isNavigationElement;
exports.isRecoverableError = isRecoverableError;
exports.jaroSimilarity = jaroSimilarity;
exports.jaroWinklerSimilarity = jaroWinklerSimilarity;
exports.levenshteinDistance = levenshteinDistance;
exports.levenshteinSimilarity = levenshteinSimilarity;
exports.matchElements = matchElements;
exports.networkProbe = networkProbe;
exports.ngramSimilarity = ngramSimilarity;
exports.normalizeString = normalizeString;
exports.normalizeValue = normalizeValue;
exports.parseNLAssertion = parseNLAssertion;
exports.parseNLInstruction = parseNLInstruction;
exports.parseNLInstructions = parseNLInstructions;
exports.parseNumericValue = parseNumericValue;
exports.pollWaitForElement = pollWaitForElement;
exports.scanValidationErrors = scanValidationErrors;
exports.segmentPageRegions = segmentPageRegions;
exports.serializeSnapshot = serializeSnapshot;
exports.snapshotFromRegisteredElement = snapshotFromRegisteredElement;
exports.splitCompoundInstruction = splitCompoundInstruction;
exports.summarizeFormDiff = summarizeFormDiff;
exports.tokenSimilarity = tokenSimilarity;
exports.tokenize = tokenize;
exports.validateParsedAction = validateParsedAction;
exports.validateWaitForElementRequest = validateWaitForElementRequest;
exports.waitFor = waitFor;
exports.waitForElement = waitForElement;
exports.wordSimilarity = wordSimilarity;
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map