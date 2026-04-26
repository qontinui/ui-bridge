// src/contracts/types.ts
var CONTRACT_CONFIG_VERSION = "1.0.0";
var CONTRACT_FILE_EXTENSION = ".contract.uibridge.json";

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

// src/ai/search-engine.ts
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
    const results = [];
    for (const searchable of searchableElements) {
      const result = this.scoreElement(searchable, criteria);
      if (result.confidence >= (criteria.fuzzyThreshold ?? this.config.fuzzyThreshold)) {
        results.push(result);
      }
    }
    results.sort((a, b) => b.confidence - a.confidence);
    const limitedResults = results.slice(0, this.config.maxResults);
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
        if (targetText.toLowerCase().includes(text.toLowerCase())) {
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
  maxResults: 5
};
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
  const durationMs = performance.now() - startTime;
  if (viableResults.length === 0) {
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
      durationMs
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

// src/specs/types.ts
var SPEC_CONFIG_VERSION = "1.0.0";
var VALID_ASSERTION_TYPES = [
  "visible",
  "hidden",
  "enabled",
  "disabled",
  "focused",
  "checked",
  "unchecked",
  "hasText",
  "containsText",
  "hasValue",
  "hasClass",
  "exists",
  "notExists",
  "count",
  "attribute",
  "cssProperty",
  "cssPropertyInSet",
  "cssPropertyRange",
  "tokenCompliance",
  "noOverlap",
  "minSpacing"
];
var VALID_SPEC_CATEGORIES = [
  "element-presence",
  "accessibility",
  "form-validation",
  "state-consistency",
  "modal-dialog",
  "navigation",
  "cross-page-consistency",
  "semantic",
  "design",
  "custom",
  "layout"
];
var VALID_SPEC_SEVERITIES = [
  "critical",
  "warning",
  "info"
];
var VALID_SPEC_SOURCES = [
  "auto",
  "manual",
  "ai-generated"
];

// src/ctr/types.ts
var CTR_CONFIG_VERSION = "1.0.0";
var CONFIDENCE_BOOST = 0.05;
var CONFIDENCE_PENALTY = 0.1;
var MIN_CONFIDENCE_THRESHOLD = 0.2;

// src/ctr/self-healing.ts
function promoteSelector(entry, selector) {
  const idx = entry.selectors.indexOf(selector);
  if (idx === -1) return null;
  const oldConfidence = selector.confidence;
  selector.confidence = Math.min(1, selector.confidence + CONFIDENCE_BOOST);
  if (idx > 0) {
    const prev = entry.selectors[idx - 1];
    if (selector.confidence > prev.confidence) {
      const tmpPriority = prev.priority;
      prev.priority = selector.priority;
      selector.priority = tmpPriority;
      entry.selectors.sort((a, b) => a.priority - b.priority);
    }
  }
  if (selector.confidence !== oldConfidence) {
    return {
      type: "ctr:selector-promoted",
      logicalName: entry.logicalName,
      selector,
      timestamp: Date.now()
    };
  }
  return null;
}
function demoteSelector(entry, selector) {
  const idx = entry.selectors.indexOf(selector);
  if (idx === -1) return null;
  const oldConfidence = selector.confidence;
  selector.confidence = Math.max(0, selector.confidence - CONFIDENCE_PENALTY);
  if (selector.confidence !== oldConfidence) {
    return {
      type: "ctr:selector-demoted",
      logicalName: entry.logicalName,
      selector,
      timestamp: Date.now()
    };
  }
  return null;
}
function getViableSelectors(entry) {
  return entry.selectors.filter((s) => s.confidence >= MIN_CONFIDENCE_THRESHOLD).sort((a, b) => a.priority - b.priority);
}

// src/ctr/registry.ts
var CentralTargetRegistry = class {
  constructor() {
    this.entries = /* @__PURE__ */ new Map();
    this.listeners = /* @__PURE__ */ new Set();
    // Cache successful resolutions for the session to avoid repeated DOM queries
    this.resolutionCache = /* @__PURE__ */ new Map();
    this.cacheTtlMs = 5e3;
  }
  // 5s cache
  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------
  register(entry) {
    this.entries.set(entry.logicalName, entry);
    this.emit({
      type: "ctr:entry-registered",
      logicalName: entry.logicalName,
      timestamp: Date.now()
    });
  }
  unregister(logicalName) {
    const existed = this.entries.delete(logicalName);
    if (existed) {
      this.resolutionCache.delete(logicalName);
      this.emit({ type: "ctr:entry-unregistered", logicalName, timestamp: Date.now() });
    }
    return existed;
  }
  get(logicalName) {
    return this.entries.get(logicalName);
  }
  has(logicalName) {
    return this.entries.has(logicalName);
  }
  getAll() {
    return Array.from(this.entries.values());
  }
  clear() {
    this.entries.clear();
    this.resolutionCache.clear();
    this.emit({ type: "ctr:cleared", timestamp: Date.now() });
  }
  get size() {
    return this.entries.size;
  }
  // ---------------------------------------------------------------------------
  // Selector Management
  // ---------------------------------------------------------------------------
  /**
   * Add a selector to an existing entry.
   */
  addSelector(logicalName, selector) {
    const entry = this.entries.get(logicalName);
    if (!entry) return false;
    entry.selectors.push(selector);
    entry.selectors.sort((a, b) => a.priority - b.priority);
    entry.version++;
    if (entry.metadata) {
      entry.metadata.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    }
    this.emit({ type: "ctr:entry-updated", logicalName, selector, timestamp: Date.now() });
    return true;
  }
  /**
   * Update a specific selector within an entry.
   */
  updateSelector(logicalName, selectorIndex, updates) {
    const entry = this.entries.get(logicalName);
    if (!entry || selectorIndex < 0 || selectorIndex >= entry.selectors.length) return false;
    const selector = entry.selectors[selectorIndex];
    if (updates.value !== void 0) selector.value = updates.value;
    if (updates.priority !== void 0) selector.priority = updates.priority;
    if (updates.confidence !== void 0) selector.confidence = updates.confidence;
    entry.selectors.sort((a, b) => a.priority - b.priority);
    entry.version++;
    this.resolutionCache.delete(logicalName);
    this.emit({ type: "ctr:entry-updated", logicalName, selector, timestamp: Date.now() });
    return true;
  }
  // ---------------------------------------------------------------------------
  // Resolution
  // ---------------------------------------------------------------------------
  /**
   * Resolve a logical name to a SearchCriteria that can be used by the assertion/search system.
   * Does NOT require a browser context — returns criteria, not an element.
   */
  resolveToSearchCriteria(logicalName) {
    const entry = this.entries.get(logicalName);
    if (!entry) return null;
    const cached = this.resolutionCache.get(logicalName);
    if (cached && Date.now() - cached.timestamp < this.cacheTtlMs) {
      return selectorToSearchCriteria(cached.selector);
    }
    const selectors = getViableSelectors(entry);
    if (selectors.length === 0) return null;
    return selectorToSearchCriteria(selectors[0]);
  }
  /**
   * Resolve a logical name to a DOM element with self-healing.
   * Requires browser context (document must be available).
   */
  resolveInDOM(logicalName) {
    const startTime = performance.now();
    const entry = this.entries.get(logicalName);
    if (!entry) {
      return {
        logicalName,
        resolved: false,
        attemptedSelectors: [],
        durationMs: performance.now() - startTime
      };
    }
    const selectors = getViableSelectors(entry);
    const attempted = [];
    for (const selector of selectors) {
      attempted.push(selector);
      const element = resolveSelectorInDOM(selector);
      if (element) {
        const event = promoteSelector(entry, selector);
        if (event) this.emit(event);
        for (const failed of attempted.slice(0, -1)) {
          const demoteEvent = demoteSelector(entry, failed);
          if (demoteEvent) this.emit(demoteEvent);
        }
        entry.lastResolved = Date.now();
        this.resolutionCache.set(logicalName, { selector, timestamp: Date.now() });
        this.emit({
          type: "ctr:resolution-succeeded",
          logicalName,
          selector,
          timestamp: Date.now()
        });
        return {
          logicalName,
          resolved: true,
          matchedSelector: selector,
          element,
          criteria: selectorToSearchCriteria(selector),
          attemptedSelectors: attempted,
          durationMs: performance.now() - startTime
        };
      }
    }
    entry.lastFailed = Date.now();
    this.resolutionCache.delete(logicalName);
    this.emit({
      type: "ctr:resolution-failed",
      logicalName,
      timestamp: Date.now()
    });
    return {
      logicalName,
      resolved: false,
      attemptedSelectors: attempted,
      durationMs: performance.now() - startTime
    };
  }
  // ---------------------------------------------------------------------------
  // Config Import/Export
  // ---------------------------------------------------------------------------
  loadConfig(config) {
    for (const entry of config.entries) {
      this.entries.set(entry.logicalName, entry);
    }
    this.resolutionCache.clear();
    this.emit({ type: "ctr:config-loaded", timestamp: Date.now() });
  }
  exportConfig() {
    return {
      version: CTR_CONFIG_VERSION,
      entries: Array.from(this.entries.values())
    };
  }
  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------
  on(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  off(listener) {
    this.listeners.delete(listener);
  }
  emit(event) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
      }
    }
  }
  // ---------------------------------------------------------------------------
  // Cache Control
  // ---------------------------------------------------------------------------
  setCacheTtl(ms) {
    this.cacheTtlMs = ms;
  }
  invalidateCache(logicalName) {
    if (logicalName) {
      this.resolutionCache.delete(logicalName);
    } else {
      this.resolutionCache.clear();
    }
  }
  // ---------------------------------------------------------------------------
  // Cross-Run Confidence Seeding
  // ---------------------------------------------------------------------------
  /**
   * Seed selector confidence scores from cross-run reliability data.
   *
   * When the runner provides historical element reliability data (via
   * GET /ui-bridge/graph/element-reliability), this method adjusts the
   * initial confidence of matching CTR entries based on observed success rates.
   *
   * Elements marked as flaky get their confidence reduced; reliable elements
   * get a boost. This prevents the CTR from starting with high confidence on
   * selectors that historically fail.
   */
  seedFromHistory(reliabilityData) {
    let seeded = 0;
    for (const data of reliabilityData) {
      for (const [, entry] of this.entries) {
        for (const selector of entry.selectors) {
          const selectorValue = typeof selector.value === "string" ? selector.value : void 0;
          if (!selectorValue) continue;
          if (selectorValue === data.element_id || entry.logicalName === data.element_id) {
            const blended = data.recommended_confidence * 0.7 + selector.confidence * 0.3;
            selector.confidence = Math.max(0.1, Math.min(1, blended));
            seeded++;
          }
        }
      }
    }
    return seeded;
  }
};
function selectorToSearchCriteria(selector) {
  switch (selector.strategy) {
    case "data-testid":
      return { idPattern: selector.value, fuzzy: false };
    case "data-awas-element":
      return { idPattern: selector.value, fuzzy: false };
    case "id":
      return { idPattern: selector.value, fuzzy: false };
    case "css":
      return { selector: selector.value, fuzzy: false };
    case "xpath":
      return { xpath: selector.value, fuzzy: false };
    case "search":
      return selector.value;
  }
}
function resolveSelectorInDOM(selector) {
  if (typeof document === "undefined") return null;
  try {
    switch (selector.strategy) {
      case "data-testid":
        return document.querySelector(
          `[data-testid="${CSS.escape(selector.value)}"]`
        );
      case "data-awas-element":
        return document.querySelector(
          `[data-awas-element="${CSS.escape(selector.value)}"]`
        );
      case "id":
        return document.querySelector(`#${CSS.escape(selector.value)}`);
      case "css":
        return document.querySelector(selector.value);
      case "xpath": {
        const result = document.evaluate(
          selector.value,
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null
        );
        return result.singleNodeValue;
      }
      case "search":
        return null;
    }
  } catch {
    return null;
  }
}
var GLOBAL_KEY = "__uiBridgeCtr";
function getGlobalCtr() {
  const g = globalThis;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new CentralTargetRegistry();
  }
  return g[GLOBAL_KEY];
}

// src/artifacts/hash.ts
async function computeHash(data) {
  const canonical = canonicalJson(data);
  const bytes = new TextEncoder().encode(canonical);
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
    return bufferToHex(hashBuffer);
  }
  try {
    const nodeCrypto = await import('crypto');
    return nodeCrypto.createHash("sha256").update(bytes).digest("hex");
  } catch {
    return fnv1aFallback(canonical);
  }
}
function canonicalJson(value) {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      return Object.keys(val).sort().reduce((sorted, key) => {
        sorted[key] = val[key];
        return sorted;
      }, {});
    }
    return val;
  });
}
function bufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function fnv1aFallback(str) {
  let h1 = 2166136261;
  let h2 = 2166136261;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 16777619);
    h2 = Math.imul(h2 ^ ch >>> 8, 16777619);
  }
  const hex1 = (h1 >>> 0).toString(16).padStart(8, "0");
  const hex2 = (h2 >>> 0).toString(16).padStart(8, "0");
  return hex1 + hex2;
}

// src/artifacts/factory.ts
async function createArtifact(result, source, environment) {
  const now = /* @__PURE__ */ new Date();
  const env = {
    timestamp: now.getTime(),
    sdkVersion: "1.0.0",
    ...environment
  };
  const hashPayload = { result, source, environment: env };
  const artifactId = await computeHash(hashPayload);
  return {
    artifactId,
    source,
    result,
    environment: env,
    createdAt: now.toISOString(),
    immutable: true
  };
}
function captureEnvironment() {
  if (typeof window === "undefined") {
    return { timestamp: Date.now() };
  }
  return {
    userAgent: navigator.userAgent,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight
    },
    url: window.location.href,
    timestamp: Date.now()
  };
}

// src/specs/executor.ts
function resolveTarget(target) {
  switch (target.type) {
    case "elementId":
      return { idPattern: target.elementId, fuzzy: false };
    case "search":
      return target.criteria;
    case "ctr": {
      const ctr = getGlobalCtr();
      const criteria = ctr.resolveToSearchCriteria(target.logicalName);
      if (criteria) return criteria;
      return { idPattern: target.logicalName, fuzzy: true };
    }
  }
}
var SpecExecutor = class {
  constructor(config) {
    if (config && "artifactStore" in config) {
      const c = config;
      this.assertionExecutor = new AssertionExecutor(c.assertionConfig);
      this.artifactStore = c.artifactStore;
      this.specId = c.specId;
    } else {
      this.assertionExecutor = new AssertionExecutor(
        config
      );
    }
  }
  /**
   * Update the element registry (pass-through to AssertionExecutor).
   */
  updateElements(elements) {
    this.assertionExecutor.updateElements(elements);
  }
  /**
   * Convert a SpecAssertion to an AssertionRequest.
   */
  toAssertionRequest(assertion) {
    const request = {
      target: resolveTarget(assertion.target),
      type: assertion.assertionType,
      expected: assertion.expected,
      attributeName: assertion.attributeName,
      propertyName: assertion.propertyName,
      timeout: assertion.timeout,
      message: assertion.message
    };
    if (assertion.relatedTarget) {
      request.relatedTarget = resolveTarget(assertion.relatedTarget);
    }
    if (assertion.minGap !== void 0) {
      request.minGap = assertion.minGap;
    }
    return request;
  }
  /**
   * Evaluate a condition to determine if an assertion should be executed.
   * Returns true if the condition is met (assertion should run),
   * false if condition is not met (assertion should skip/pass).
   */
  async evaluateCondition(condition) {
    const target = resolveTarget(condition.target);
    const element = await this.assertionExecutor.findElement(target, false);
    switch (condition.type) {
      case "exists":
        return element !== null;
      case "notExists":
        return element === null;
      case "hasText": {
        if (!element) return false;
        const textContent = element.state?.textContent || element.accessibleName || element.label || element.description || "";
        return textContent.toLowerCase().includes(condition.text.toLowerCase());
      }
      default:
        return true;
    }
  }
  /**
   * Execute a single SpecAssertion.
   */
  async executeAssertion(assertion) {
    if (!assertion.enabled) {
      return {
        assertionId: assertion.id,
        severity: assertion.severity,
        category: assertion.category,
        skipped: true,
        result: null
      };
    }
    if (assertion.condition) {
      const conditionMet = await this.evaluateCondition(assertion.condition);
      if (!conditionMet) {
        return {
          assertionId: assertion.id,
          severity: assertion.severity,
          category: assertion.category,
          skipped: true,
          skipReason: "condition_not_met",
          result: null
        };
      }
    }
    const request = this.toAssertionRequest(assertion);
    const result = await this.assertionExecutor.assert(request);
    return {
      assertionId: assertion.id,
      severity: assertion.severity,
      category: assertion.category,
      skipped: false,
      result
    };
  }
  /**
   * Execute all assertions in a SpecGroup.
   */
  async executeGroup(group, options) {
    const startTime = Date.now();
    const assertionResults = [];
    let passedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    for (const assertion of group.assertions) {
      if (shouldSkip(assertion, options)) {
        assertionResults.push({
          assertionId: assertion.id,
          groupId: group.id,
          severity: assertion.severity,
          category: assertion.category,
          skipped: true,
          result: null
        });
        skippedCount++;
        continue;
      }
      const result = await this.executeAssertion(assertion);
      result.groupId = group.id;
      assertionResults.push(result);
      if (result.skipped) {
        skippedCount++;
      } else if (result.result?.passed) {
        passedCount++;
      } else {
        failedCount++;
        if (options?.stopOnFailure) break;
      }
    }
    const groupResult = {
      groupId: group.id,
      groupName: group.name,
      assertionResults,
      passedCount,
      failedCount,
      skippedCount,
      passed: failedCount === 0,
      durationMs: Date.now() - startTime,
      timestamp: Date.now()
    };
    await this.emitArtifact(groupResult);
    return groupResult;
  }
  /**
   * Execute a full SpecConfig.
   */
  async execute(config, options) {
    const startTime = Date.now();
    const groupResults = [];
    for (const group of config.groups) {
      if (options?.groupIds && !options.groupIds.includes(group.id)) continue;
      const groupResult = await this.executeGroup(group, options);
      groupResults.push(groupResult);
      if (options?.stopOnFailure && !groupResult.passed) break;
    }
    const ungroupedResults = [];
    if (config.assertions) {
      for (const assertion of config.assertions) {
        if (shouldSkip(assertion, options)) {
          ungroupedResults.push({
            assertionId: assertion.id,
            severity: assertion.severity,
            category: assertion.category,
            skipped: true,
            result: null
          });
          continue;
        }
        const result = await this.executeAssertion(assertion);
        ungroupedResults.push(result);
        if (options?.stopOnFailure && !result.skipped && !result.result?.passed) break;
      }
    }
    let passedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    for (const gr of groupResults) {
      passedCount += gr.passedCount;
      failedCount += gr.failedCount;
      skippedCount += gr.skippedCount;
    }
    for (const ur of ungroupedResults) {
      if (ur.skipped) skippedCount++;
      else if (ur.result?.passed) passedCount++;
      else failedCount++;
    }
    const executionResult = {
      specVersion: config.version ?? SPEC_CONFIG_VERSION,
      groupResults,
      ungroupedResults,
      totalAssertions: passedCount + failedCount + skippedCount,
      passedCount,
      failedCount,
      skippedCount,
      passed: failedCount === 0,
      durationMs: Date.now() - startTime,
      timestamp: Date.now()
    };
    await this.emitArtifact(executionResult);
    return executionResult;
  }
  // ---------------------------------------------------------------------------
  // Artifact Emission
  // ---------------------------------------------------------------------------
  /**
   * Emit a result to the artifact store if configured.
   * Failures are silently caught to avoid breaking the execution pipeline.
   */
  async emitArtifact(result) {
    if (!this.artifactStore) return;
    try {
      const artifact = await createArtifact(
        result,
        { specId: this.specId, triggeredBy: "manual" },
        captureEnvironment()
      );
      await this.artifactStore.save(artifact);
    } catch {
    }
  }
};
function shouldSkip(assertion, options) {
  if (!assertion.enabled) return true;
  if (options?.assertionIds && !options.assertionIds.includes(assertion.id)) return true;
  if (options?.categories && !options.categories.includes(assertion.category)) return true;
  if (options?.severities && !options.severities.includes(assertion.severity)) return true;
  if (options?.skipUnreviewed && !assertion.reviewed) return true;
  return false;
}

// src/specs/validator.ts
function isValidAssertionType(value) {
  return typeof value === "string" && VALID_ASSERTION_TYPES.includes(value);
}
function isValidSpecCategory(value) {
  return typeof value === "string" && VALID_SPEC_CATEGORIES.includes(value);
}
function isValidSpecSeverity(value) {
  return typeof value === "string" && VALID_SPEC_SEVERITIES.includes(value);
}
function isValidSpecSource(value) {
  return typeof value === "string" && VALID_SPEC_SOURCES.includes(value);
}
function validateSpecAssertion(data, path = "assertion") {
  const errors = [];
  if (!data || typeof data !== "object") {
    errors.push({ path, message: "must be an object" });
    return errors;
  }
  const obj = data;
  if (typeof obj.id !== "string" || obj.id.length === 0) {
    errors.push({ path: `${path}.id`, message: "must be a non-empty string" });
  }
  if (typeof obj.description !== "string") {
    errors.push({ path: `${path}.description`, message: "must be a string" });
  }
  if (!isValidSpecCategory(obj.category)) {
    errors.push({
      path: `${path}.category`,
      message: `must be one of: ${VALID_SPEC_CATEGORIES.join(", ")}`
    });
  }
  if (!isValidSpecSeverity(obj.severity)) {
    errors.push({
      path: `${path}.severity`,
      message: `must be one of: ${VALID_SPEC_SEVERITIES.join(", ")}`
    });
  }
  if (!obj.target || typeof obj.target !== "object") {
    errors.push({ path: `${path}.target`, message: "must be an object" });
  } else {
    const target = obj.target;
    if (target.type === "elementId") {
      if (typeof target.elementId !== "string" || target.elementId.length === 0) {
        errors.push({ path: `${path}.target.elementId`, message: "must be a non-empty string" });
      }
    } else if (target.type === "search") {
      if (!target.criteria || typeof target.criteria !== "object") {
        errors.push({ path: `${path}.target.criteria`, message: "must be an object" });
      }
    } else if (target.type === "ctr") {
      if (typeof target.logicalName !== "string" || target.logicalName.length === 0) {
        errors.push({ path: `${path}.target.logicalName`, message: "must be a non-empty string" });
      }
    } else {
      errors.push({
        path: `${path}.target.type`,
        message: 'must be "elementId", "search", or "ctr"'
      });
    }
  }
  if (!isValidAssertionType(obj.assertionType)) {
    errors.push({
      path: `${path}.assertionType`,
      message: `must be one of: ${VALID_ASSERTION_TYPES.join(", ")}`
    });
  }
  if (!isValidSpecSource(obj.source)) {
    errors.push({
      path: `${path}.source`,
      message: `must be one of: ${VALID_SPEC_SOURCES.join(", ")}`
    });
  }
  if (typeof obj.reviewed !== "boolean") {
    errors.push({ path: `${path}.reviewed`, message: "must be a boolean" });
  }
  if (typeof obj.enabled !== "boolean") {
    errors.push({ path: `${path}.enabled`, message: "must be a boolean" });
  }
  if (obj.timeout !== void 0 && (typeof obj.timeout !== "number" || obj.timeout < 0)) {
    errors.push({ path: `${path}.timeout`, message: "must be a non-negative number" });
  }
  return errors;
}
function validateSpecGroup(data, path = "group") {
  const errors = [];
  if (!data || typeof data !== "object") {
    errors.push({ path, message: "must be an object" });
    return errors;
  }
  const obj = data;
  if (typeof obj.id !== "string" || obj.id.length === 0) {
    errors.push({ path: `${path}.id`, message: "must be a non-empty string" });
  }
  if (typeof obj.name !== "string") {
    errors.push({ path: `${path}.name`, message: "must be a string" });
  }
  if (typeof obj.description !== "string") {
    errors.push({ path: `${path}.description`, message: "must be a string" });
  }
  if (!isValidSpecCategory(obj.category)) {
    errors.push({
      path: `${path}.category`,
      message: `must be one of: ${VALID_SPEC_CATEGORIES.join(", ")}`
    });
  }
  if (!isValidSpecSource(obj.source)) {
    errors.push({
      path: `${path}.source`,
      message: `must be one of: ${VALID_SPEC_SOURCES.join(", ")}`
    });
  }
  if (!Array.isArray(obj.assertions)) {
    errors.push({ path: `${path}.assertions`, message: "must be an array" });
  } else {
    for (let i = 0; i < obj.assertions.length; i++) {
      errors.push(...validateSpecAssertion(obj.assertions[i], `${path}.assertions[${i}]`));
    }
  }
  return errors;
}
function validateSpecConfig(data) {
  const errors = [];
  if (!data || typeof data !== "object") {
    return { valid: false, errors: [{ path: "", message: "must be an object" }] };
  }
  const obj = data;
  if (obj.version !== SPEC_CONFIG_VERSION) {
    errors.push({ path: "version", message: `must be "${SPEC_CONFIG_VERSION}"` });
  }
  if (obj.description !== void 0 && typeof obj.description !== "string") {
    errors.push({ path: "description", message: "must be a string if provided" });
  }
  if (!Array.isArray(obj.groups)) {
    errors.push({ path: "groups", message: "must be an array" });
  } else {
    for (let i = 0; i < obj.groups.length; i++) {
      errors.push(...validateSpecGroup(obj.groups[i], `groups[${i}]`));
    }
  }
  if (obj.assertions !== void 0) {
    if (!Array.isArray(obj.assertions)) {
      errors.push({ path: "assertions", message: "must be an array if provided" });
    } else {
      for (let i = 0; i < obj.assertions.length; i++) {
        errors.push(...validateSpecAssertion(obj.assertions[i], `assertions[${i}]`));
      }
    }
  }
  if (obj.metadata !== void 0 && (typeof obj.metadata !== "object" || obj.metadata === null)) {
    errors.push({ path: "metadata", message: "must be an object if provided" });
  }
  return { valid: errors.length === 0, errors };
}

// src/specs/store.ts
var SpecStore = class {
  constructor() {
    this.configs = /* @__PURE__ */ new Map();
    this.listeners = /* @__PURE__ */ new Set();
  }
  // ---------------------------------------------------------------------------
  // CRUD — Config Level
  // ---------------------------------------------------------------------------
  load(specId, config) {
    this.configs.set(specId, config);
    this.emit({ type: "spec:loaded", specId, timestamp: Date.now() });
  }
  unload(specId) {
    const existed = this.configs.delete(specId);
    if (existed) {
      this.emit({ type: "spec:unloaded", specId, timestamp: Date.now() });
    }
    return existed;
  }
  get(specId) {
    return this.configs.get(specId);
  }
  has(specId) {
    return this.configs.has(specId);
  }
  getIds() {
    return Array.from(this.configs.keys());
  }
  getAll() {
    return new Map(this.configs);
  }
  get count() {
    return this.configs.size;
  }
  clear() {
    this.configs.clear();
    this.emit({ type: "spec:cleared", timestamp: Date.now() });
  }
  // ---------------------------------------------------------------------------
  // CRUD — Group Level
  // ---------------------------------------------------------------------------
  addGroup(specId, group) {
    const config = this.configs.get(specId);
    if (!config) return false;
    config.groups.push(group);
    this.emit({ type: "spec:group-added", specId, groupId: group.id, timestamp: Date.now() });
    return true;
  }
  removeGroup(specId, groupId) {
    const config = this.configs.get(specId);
    if (!config) return false;
    const idx = config.groups.findIndex((g) => g.id === groupId);
    if (idx === -1) return false;
    config.groups.splice(idx, 1);
    this.emit({ type: "spec:group-removed", specId, groupId, timestamp: Date.now() });
    return true;
  }
  getGroup(specId, groupId) {
    const config = this.configs.get(specId);
    if (!config) return void 0;
    return config.groups.find((g) => g.id === groupId);
  }
  // ---------------------------------------------------------------------------
  // CRUD — Assertion Level
  // ---------------------------------------------------------------------------
  addAssertion(specId, groupId, assertion) {
    const config = this.configs.get(specId);
    if (!config) return false;
    if (groupId) {
      const group = config.groups.find((g) => g.id === groupId);
      if (!group) return false;
      group.assertions.push(assertion);
    } else {
      if (!config.assertions) config.assertions = [];
      config.assertions.push(assertion);
    }
    this.emit({
      type: "spec:assertion-added",
      specId,
      groupId: groupId ?? void 0,
      assertionId: assertion.id,
      timestamp: Date.now()
    });
    return true;
  }
  removeAssertion(specId, groupId, assertionId) {
    const config = this.configs.get(specId);
    if (!config) return false;
    let removed = false;
    if (groupId) {
      const group = config.groups.find((g) => g.id === groupId);
      if (group) {
        const idx = group.assertions.findIndex((a) => a.id === assertionId);
        if (idx !== -1) {
          group.assertions.splice(idx, 1);
          removed = true;
        }
      }
    } else if (config.assertions) {
      const idx = config.assertions.findIndex((a) => a.id === assertionId);
      if (idx !== -1) {
        config.assertions.splice(idx, 1);
        removed = true;
      }
    }
    if (removed) {
      this.emit({
        type: "spec:assertion-removed",
        specId,
        groupId: groupId ?? void 0,
        assertionId,
        timestamp: Date.now()
      });
    }
    return removed;
  }
  toggleAssertion(specId, groupId, assertionId) {
    const assertion = this.findAssertion(specId, groupId, assertionId);
    if (!assertion) return false;
    assertion.enabled = !assertion.enabled;
    this.emit({ type: "spec:updated", specId, timestamp: Date.now() });
    return true;
  }
  markReviewed(specId, groupId, assertionId) {
    const assertion = this.findAssertion(specId, groupId, assertionId);
    if (!assertion) return false;
    assertion.reviewed = !assertion.reviewed;
    this.emit({ type: "spec:updated", specId, timestamp: Date.now() });
    return true;
  }
  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------
  getAllAssertions() {
    const result = [];
    for (const config of this.configs.values()) {
      for (const group of config.groups) {
        result.push(...group.assertions);
      }
      if (config.assertions) {
        result.push(...config.assertions);
      }
    }
    return result;
  }
  filterAssertions(opts) {
    return this.getAllAssertions().filter((a) => {
      if (opts.categories && !opts.categories.includes(a.category)) return false;
      if (opts.severities && !opts.severities.includes(a.severity)) return false;
      if (opts.enabledOnly && !a.enabled) return false;
      if (opts.reviewedOnly && !a.reviewed) return false;
      return true;
    });
  }
  // ---------------------------------------------------------------------------
  // Coverage
  // ---------------------------------------------------------------------------
  getCoverage(allElementIds) {
    const specifiedIdSet = /* @__PURE__ */ new Set();
    for (const assertion of this.getAllAssertions()) {
      if (assertion.target.type === "elementId") {
        specifiedIdSet.add(assertion.target.elementId);
      }
    }
    const specifiedIds = [];
    const unspecifiedIds = [];
    for (const id of allElementIds) {
      if (specifiedIdSet.has(id)) {
        specifiedIds.push(id);
      } else {
        unspecifiedIds.push(id);
      }
    }
    const total = allElementIds.length;
    return {
      totalElements: total,
      specifiedElements: specifiedIds.length,
      coveragePercent: total > 0 ? specifiedIds.length / total * 100 : 0,
      specifiedIds,
      unspecifiedIds,
      timestamp: Date.now()
    };
  }
  // ---------------------------------------------------------------------------
  // Import / Export
  // ---------------------------------------------------------------------------
  importConfig(specId, config) {
    const result = validateSpecConfig(config);
    if (!result.valid) return false;
    this.configs.set(specId, config);
    this.emit({ type: "spec:loaded", specId, timestamp: Date.now() });
    return true;
  }
  exportConfig(specId) {
    const config = this.configs.get(specId);
    if (!config) return void 0;
    return {
      ...config,
      version: SPEC_CONFIG_VERSION,
      metadata: {
        ...config.metadata,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      }
    };
  }
  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------
  on(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  emit(event) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
      }
    }
  }
  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------
  findAssertion(specId, groupId, assertionId) {
    const config = this.configs.get(specId);
    if (!config) return void 0;
    if (groupId) {
      const group = config.groups.find((g) => g.id === groupId);
      if (!group) return void 0;
      return group.assertions.find((a) => a.id === assertionId);
    }
    return config.assertions?.find((a) => a.id === assertionId);
  }
};
var GLOBAL_KEY2 = "__uiBridgeSpecStore";
function getGlobalSpecStore() {
  const g = globalThis;
  if (!g[GLOBAL_KEY2]) {
    g[GLOBAL_KEY2] = new SpecStore();
  }
  return g[GLOBAL_KEY2];
}

// src/contracts/executor.ts
var ContractExecutor = class {
  constructor(config) {
    this.specExecutor = new SpecExecutor(config);
  }
  /**
   * Update the element registry (pass-through to SpecExecutor).
   */
  updateElements(elements) {
    this.specExecutor.updateElements(elements);
  }
  /**
   * Execute a full verification contract.
   */
  async execute(contract, options) {
    const startTime = Date.now();
    const warnings = [];
    const preconditionResults = [];
    let preconditionsPassed = true;
    let skipped = false;
    for (const condition of contract.preconditions) {
      const result = await this.evaluateCondition(condition);
      preconditionResults.push(result);
      if (!result.passed) {
        if (condition.onFailure === "skip") {
          skipped = true;
          break;
        } else if (condition.onFailure === "fail") {
          preconditionsPassed = false;
          break;
        } else if (condition.onFailure === "warn") {
          warnings.push(`Precondition warning: ${condition.description}`);
        }
      }
    }
    let verificationResults = null;
    let verificationPassed = false;
    if (!skipped && preconditionsPassed) {
      verificationResults = await this.runVerification(contract, options?.specOptions);
      verificationPassed = verificationResults.every(
        (r) => r.skipped || (r.result?.passed ?? false)
      );
    }
    let postconditionResults = null;
    let postconditionsPassed = true;
    if (!skipped && preconditionsPassed && verificationPassed) {
      postconditionResults = [];
      for (const condition of contract.postconditions) {
        const result = await this.evaluateCondition(condition);
        postconditionResults.push(result);
        if (!result.passed) {
          if (condition.onFailure === "fail") {
            postconditionsPassed = false;
            break;
          } else if (condition.onFailure === "warn") {
            warnings.push(`Postcondition warning: ${condition.description}`);
          }
        }
      }
    }
    const passed = !skipped && preconditionsPassed && verificationPassed && postconditionsPassed;
    return {
      contractId: contract.id,
      contractName: contract.name,
      preconditionResults,
      preconditionsPassed,
      skipped,
      verificationResults,
      verificationPassed,
      postconditionResults,
      postconditionsPassed,
      passed,
      warnings,
      durationMs: Date.now() - startTime,
      timestamp: Date.now()
    };
  }
  // ---------------------------------------------------------------------------
  // Condition Evaluation
  // ---------------------------------------------------------------------------
  async evaluateCondition(condition) {
    const startTime = Date.now();
    switch (condition.check.type) {
      case "assertion": {
        const result = await this.specExecutor.executeAssertion(condition.check.assertion);
        const passed = result.skipped || (result.result?.passed ?? false);
        return {
          conditionId: condition.id,
          description: condition.description,
          passed,
          assertionResult: result,
          onFailure: condition.onFailure,
          skippedContract: !passed && condition.onFailure === "skip",
          durationMs: Date.now() - startTime
        };
      }
      case "api": {
        const { endpoint, method, expectedStatus, headers, timeout } = condition.check;
        try {
          const controller = new AbortController();
          const timeoutId = timeout ? setTimeout(() => controller.abort(), timeout) : void 0;
          const parsedUrl = new URL(endpoint);
          if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
            throw new Error(`Unsafe protocol: ${parsedUrl.protocol}`);
          }
          const response = await fetch(endpoint, {
            method,
            headers,
            signal: controller.signal
          });
          if (timeoutId) clearTimeout(timeoutId);
          const passed = response.status === expectedStatus;
          return {
            conditionId: condition.id,
            description: condition.description,
            passed,
            apiResult: {
              status: response.status,
              ok: response.ok,
              durationMs: Date.now() - startTime
            },
            onFailure: condition.onFailure,
            skippedContract: !passed && condition.onFailure === "skip",
            durationMs: Date.now() - startTime
          };
        } catch {
          return {
            conditionId: condition.id,
            description: condition.description,
            passed: false,
            apiResult: { status: 0, ok: false, durationMs: Date.now() - startTime },
            onFailure: condition.onFailure,
            skippedContract: condition.onFailure === "skip",
            durationMs: Date.now() - startTime
          };
        }
      }
    }
  }
  // ---------------------------------------------------------------------------
  // Verification
  // ---------------------------------------------------------------------------
  async runVerification(contract, options) {
    const verification = contract.verification;
    switch (verification.type) {
      case "inline": {
        const results = [];
        for (const assertion of verification.assertions) {
          results.push(await this.specExecutor.executeAssertion(assertion));
        }
        return results;
      }
      case "specGroupRef": {
        const specStore = getGlobalSpecStore();
        const specConfig = specStore.get(verification.specId);
        if (!specConfig) {
          throw new Error(
            `Contract verification references spec "${verification.specId}" but it is not loaded in the SpecStore. Load it with specStore.load("${verification.specId}", config) first.`
          );
        }
        const group = specConfig.groups.find((g) => g.id === verification.groupId);
        if (!group) {
          throw new Error(
            `Contract verification references group "${verification.groupId}" in spec "${verification.specId}" but the group was not found. Available groups: ${specConfig.groups.map((g) => g.id).join(", ")}`
          );
        }
        const groupResult = await this.specExecutor.executeGroup(group, options);
        return groupResult.assertionResults;
      }
    }
  }
};

// src/contracts/validator.ts
function validateContractConfig(config) {
  const errors = [];
  if (!config || typeof config !== "object") {
    return { valid: false, errors: [{ path: "", message: "must be an object" }] };
  }
  const obj = config;
  if (obj.version !== CONTRACT_CONFIG_VERSION) {
    errors.push({
      path: "version",
      message: `must be "${CONTRACT_CONFIG_VERSION}"`
    });
  }
  if (!Array.isArray(obj.contracts)) {
    errors.push({ path: "contracts", message: "must be an array" });
  } else {
    for (let i = 0; i < obj.contracts.length; i++) {
      validateContract(obj.contracts[i], `contracts[${i}]`, errors);
    }
  }
  return { valid: errors.length === 0, errors };
}
function validateContract(contract, path, errors) {
  if (!contract || typeof contract !== "object") {
    errors.push({ path, message: "must be an object" });
    return;
  }
  const obj = contract;
  if (typeof obj.id !== "string" || obj.id.length === 0) {
    errors.push({ path: `${path}.id`, message: "must be a non-empty string" });
  }
  if (typeof obj.name !== "string" || obj.name.length === 0) {
    errors.push({ path: `${path}.name`, message: "must be a non-empty string" });
  }
  if (typeof obj.description !== "string") {
    errors.push({ path: `${path}.description`, message: "must be a string" });
  }
  if (!Array.isArray(obj.preconditions)) {
    errors.push({ path: `${path}.preconditions`, message: "must be an array" });
  } else {
    for (let i = 0; i < obj.preconditions.length; i++) {
      validateCondition(obj.preconditions[i], `${path}.preconditions[${i}]`, errors);
    }
  }
  if (!obj.verification || typeof obj.verification !== "object") {
    errors.push({ path: `${path}.verification`, message: "must be an object" });
  } else {
    const v = obj.verification;
    if (v.type === "specGroupRef") {
      if (typeof v.specId !== "string") {
        errors.push({ path: `${path}.verification.specId`, message: "must be a string" });
      }
      if (typeof v.groupId !== "string") {
        errors.push({ path: `${path}.verification.groupId`, message: "must be a string" });
      }
    } else if (v.type === "inline") {
      if (!Array.isArray(v.assertions)) {
        errors.push({ path: `${path}.verification.assertions`, message: "must be an array" });
      }
    } else {
      errors.push({
        path: `${path}.verification.type`,
        message: 'must be "specGroupRef" or "inline"'
      });
    }
  }
  if (!Array.isArray(obj.postconditions)) {
    errors.push({ path: `${path}.postconditions`, message: "must be an array" });
  } else {
    for (let i = 0; i < obj.postconditions.length; i++) {
      validateCondition(obj.postconditions[i], `${path}.postconditions[${i}]`, errors);
    }
  }
}
function validateCondition(condition, path, errors) {
  if (!condition || typeof condition !== "object") {
    errors.push({ path, message: "must be an object" });
    return;
  }
  const obj = condition;
  if (typeof obj.id !== "string" || obj.id.length === 0) {
    errors.push({ path: `${path}.id`, message: "must be a non-empty string" });
  }
  if (typeof obj.description !== "string") {
    errors.push({ path: `${path}.description`, message: "must be a string" });
  }
  if (!obj.check || typeof obj.check !== "object") {
    errors.push({ path: `${path}.check`, message: "must be an object" });
  } else {
    const check = obj.check;
    if (check.type === "assertion") {
      if (!check.assertion || typeof check.assertion !== "object") {
        errors.push({ path: `${path}.check.assertion`, message: "must be an object" });
      }
    } else if (check.type === "api") {
      if (typeof check.endpoint !== "string") {
        errors.push({ path: `${path}.check.endpoint`, message: "must be a string" });
      }
      if (!["GET", "POST", "PUT", "DELETE"].includes(check.method)) {
        errors.push({
          path: `${path}.check.method`,
          message: "must be GET, POST, PUT, or DELETE"
        });
      }
      if (typeof check.expectedStatus !== "number") {
        errors.push({ path: `${path}.check.expectedStatus`, message: "must be a number" });
      }
    } else {
      errors.push({ path: `${path}.check.type`, message: 'must be "assertion" or "api"' });
    }
  }
  if (!["skip", "fail", "warn"].includes(obj.onFailure)) {
    errors.push({ path: `${path}.onFailure`, message: 'must be "skip", "fail", or "warn"' });
  }
}

export { CONTRACT_CONFIG_VERSION, CONTRACT_FILE_EXTENSION, ContractExecutor, validateContractConfig };
//# sourceMappingURL=index.mjs.map
//# sourceMappingURL=index.mjs.map