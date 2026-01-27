/**
 * Natural Language Action Parser
 *
 * Parses natural language instructions into structured action requests.
 * Handles patterns like "click the Submit button" or "type 'hello' in the search box".
 */

import type { ParsedAction, AssertionType } from './types';

/**
 * Action pattern definition
 */
interface ActionPattern {
  /** Regex pattern to match */
  regex: RegExp;
  /** Action type */
  action: ParsedAction['action'];
  /** Capture group index for target */
  targetGroup: number;
  /** Capture group index for value (optional) */
  valueGroup?: number;
  /** Extract modifiers from match */
  modifierExtractor?: (match: RegExpMatchArray) => ParsedAction['modifiers'];
  /** Confidence level for this pattern */
  confidence: number;
}

/**
 * Action patterns for natural language parsing
 */
const ACTION_PATTERNS: ActionPattern[] = [
  // Click patterns
  {
    regex: /^click\s+(?:on\s+)?(?:the\s+)?(.+?)(?:\s+button)?$/i,
    action: 'click',
    targetGroup: 1,
    confidence: 0.95,
  },
  {
    regex: /^press\s+(?:the\s+)?(.+?)(?:\s+button)?$/i,
    action: 'click',
    targetGroup: 1,
    confidence: 0.9,
  },
  {
    regex: /^tap\s+(?:on\s+)?(?:the\s+)?(.+)$/i,
    action: 'click',
    targetGroup: 1,
    confidence: 0.85,
  },
  {
    regex: /^activate\s+(?:the\s+)?(.+)$/i,
    action: 'click',
    targetGroup: 1,
    confidence: 0.8,
  },

  // Double click patterns
  {
    regex: /^double[\s-]?click\s+(?:on\s+)?(?:the\s+)?(.+)$/i,
    action: 'doubleClick',
    targetGroup: 1,
    confidence: 0.95,
  },

  // Right click patterns
  {
    regex: /^right[\s-]?click\s+(?:on\s+)?(?:the\s+)?(.+)$/i,
    action: 'rightClick',
    targetGroup: 1,
    confidence: 0.95,
  },
  {
    regex: /^context\s+click\s+(?:on\s+)?(?:the\s+)?(.+)$/i,
    action: 'rightClick',
    targetGroup: 1,
    confidence: 0.9,
  },

  // Type patterns - "type X in Y"
  {
    regex: /^type\s+["'](.+?)["']\s+(?:in(?:to)?|on)\s+(?:the\s+)?(.+)$/i,
    action: 'type',
    targetGroup: 2,
    valueGroup: 1,
    confidence: 0.95,
  },
  {
    regex: /^type\s+(.+?)\s+(?:in(?:to)?|on)\s+(?:the\s+)?(.+)$/i,
    action: 'type',
    targetGroup: 2,
    valueGroup: 1,
    confidence: 0.85,
  },

  // Type patterns - "enter X in Y"
  {
    regex: /^enter\s+["'](.+?)["']\s+(?:in(?:to)?|on)\s+(?:the\s+)?(.+)$/i,
    action: 'type',
    targetGroup: 2,
    valueGroup: 1,
    confidence: 0.95,
  },
  {
    regex: /^enter\s+(.+?)\s+(?:in(?:to)?|on)\s+(?:the\s+)?(.+)$/i,
    action: 'type',
    targetGroup: 2,
    valueGroup: 1,
    confidence: 0.85,
  },

  // Type patterns - "input X into Y"
  {
    regex: /^input\s+["'](.+?)["']\s+(?:in(?:to)?)\s+(?:the\s+)?(.+)$/i,
    action: 'type',
    targetGroup: 2,
    valueGroup: 1,
    confidence: 0.9,
  },

  // Type patterns - "fill Y with X"
  {
    regex: /^fill\s+(?:in\s+)?(?:the\s+)?(.+?)\s+with\s+["'](.+?)["']$/i,
    action: 'type',
    targetGroup: 1,
    valueGroup: 2,
    confidence: 0.95,
  },
  {
    regex: /^fill\s+(?:in\s+)?(?:the\s+)?(.+?)\s+with\s+(.+)$/i,
    action: 'type',
    targetGroup: 1,
    valueGroup: 2,
    confidence: 0.85,
  },

  // Type patterns - "set Y to X"
  {
    regex: /^set\s+(?:the\s+)?(.+?)\s+to\s+["'](.+?)["']$/i,
    action: 'type',
    targetGroup: 1,
    valueGroup: 2,
    confidence: 0.9,
  },

  // Select patterns
  {
    regex: /^select\s+["'](.+?)["']\s+(?:from|in)\s+(?:the\s+)?(.+)$/i,
    action: 'select',
    targetGroup: 2,
    valueGroup: 1,
    confidence: 0.95,
  },
  {
    regex: /^choose\s+["'](.+?)["']\s+(?:from|in)\s+(?:the\s+)?(.+)$/i,
    action: 'select',
    targetGroup: 2,
    valueGroup: 1,
    confidence: 0.9,
  },
  {
    regex: /^pick\s+["'](.+?)["']\s+(?:from|in)\s+(?:the\s+)?(.+)$/i,
    action: 'select',
    targetGroup: 2,
    valueGroup: 1,
    confidence: 0.85,
  },

  // Check patterns
  {
    regex: /^check\s+(?:the\s+)?(.+?)(?:\s+checkbox)?$/i,
    action: 'check',
    targetGroup: 1,
    confidence: 0.9,
  },
  {
    regex: /^enable\s+(?:the\s+)?(.+)$/i,
    action: 'check',
    targetGroup: 1,
    confidence: 0.8,
  },
  {
    regex: /^tick\s+(?:the\s+)?(.+)$/i,
    action: 'check',
    targetGroup: 1,
    confidence: 0.85,
  },

  // Uncheck patterns
  {
    regex: /^uncheck\s+(?:the\s+)?(.+?)(?:\s+checkbox)?$/i,
    action: 'uncheck',
    targetGroup: 1,
    confidence: 0.9,
  },
  {
    regex: /^disable\s+(?:the\s+)?(.+)$/i,
    action: 'uncheck',
    targetGroup: 1,
    confidence: 0.8,
  },
  {
    regex: /^untick\s+(?:the\s+)?(.+)$/i,
    action: 'uncheck',
    targetGroup: 1,
    confidence: 0.85,
  },

  // Clear patterns
  {
    regex: /^clear\s+(?:the\s+)?(.+)$/i,
    action: 'clear',
    targetGroup: 1,
    confidence: 0.9,
  },
  {
    regex: /^erase\s+(?:the\s+)?(.+)$/i,
    action: 'clear',
    targetGroup: 1,
    confidence: 0.85,
  },
  {
    regex: /^empty\s+(?:the\s+)?(.+)$/i,
    action: 'clear',
    targetGroup: 1,
    confidence: 0.8,
  },

  // Hover patterns
  {
    regex: /^hover\s+(?:over\s+)?(?:the\s+)?(.+)$/i,
    action: 'hover',
    targetGroup: 1,
    confidence: 0.9,
  },
  {
    regex: /^mouse\s+over\s+(?:the\s+)?(.+)$/i,
    action: 'hover',
    targetGroup: 1,
    confidence: 0.85,
  },

  // Focus patterns
  {
    regex: /^focus\s+(?:on\s+)?(?:the\s+)?(.+)$/i,
    action: 'focus',
    targetGroup: 1,
    confidence: 0.9,
  },

  // Scroll patterns
  {
    regex: /^scroll\s+(up|down|left|right)$/i,
    action: 'scroll',
    targetGroup: 1,
    confidence: 0.9,
  },
  {
    regex: /^scroll\s+(?:the\s+)?(.+?)\s+(up|down|left|right)$/i,
    action: 'scroll',
    targetGroup: 1,
    confidence: 0.85,
  },
  {
    regex: /^scroll\s+to\s+(?:the\s+)?(.+)$/i,
    action: 'scroll',
    targetGroup: 1,
    confidence: 0.85,
  },

  // Wait patterns
  {
    regex: /^wait\s+(?:for\s+)?(?:the\s+)?(.+?)(?:\s+to\s+(?:be\s+)?(.+))?$/i,
    action: 'wait',
    targetGroup: 1,
    confidence: 0.85,
  },
  {
    regex: /^wait\s+until\s+(?:the\s+)?(.+?)(?:\s+(?:is|becomes)\s+(.+))?$/i,
    action: 'wait',
    targetGroup: 1,
    confidence: 0.85,
  },

  // Assert patterns
  {
    regex: /^(?:assert|verify|check)\s+(?:that\s+)?(?:the\s+)?(.+?)\s+(?:is\s+)?(visible|hidden|enabled|disabled|checked|unchecked|focused)$/i,
    action: 'assert',
    targetGroup: 1,
    confidence: 0.9,
  },
  {
    regex: /^(?:assert|verify|check)\s+(?:that\s+)?(?:the\s+)?(.+?)\s+(?:contains|has)\s+["'](.+?)["']$/i,
    action: 'assert',
    targetGroup: 1,
    valueGroup: 2,
    confidence: 0.9,
  },
  {
    regex: /^(?:the\s+)?(.+?)\s+should\s+(?:be\s+)?(visible|hidden|enabled|disabled|checked|unchecked|focused)$/i,
    action: 'assert',
    targetGroup: 1,
    confidence: 0.85,
  },
];

/**
 * Assertion type mappings
 */
const ASSERTION_TYPE_MAP: Record<string, AssertionType> = {
  visible: 'visible',
  hidden: 'hidden',
  enabled: 'enabled',
  disabled: 'disabled',
  checked: 'checked',
  unchecked: 'unchecked',
  focused: 'focused',
  contains: 'containsText',
  has: 'hasText',
};

/**
 * Parse a natural language instruction into a structured action
 */
export function parseNLInstruction(instruction: string): ParsedAction | null {
  const trimmed = instruction.trim();
  if (!trimmed) return null;

  // Try each pattern
  for (const pattern of ACTION_PATTERNS) {
    const match = trimmed.match(pattern.regex);
    if (match) {
      const parsed: ParsedAction = {
        action: pattern.action,
        targetDescription: cleanTargetDescription(match[pattern.targetGroup] || ''),
        rawInstruction: instruction,
        parseConfidence: pattern.confidence,
      };

      // Extract value if present
      if (pattern.valueGroup && match[pattern.valueGroup]) {
        parsed.value = match[pattern.valueGroup];
      }

      // Extract modifiers if extractor provided
      if (pattern.modifierExtractor) {
        parsed.modifiers = pattern.modifierExtractor(match);
      }

      // Handle scroll direction
      if (pattern.action === 'scroll') {
        const directionMatch = trimmed.match(/(up|down|left|right)/i);
        if (directionMatch) {
          parsed.scrollDirection = directionMatch[1].toLowerCase() as ParsedAction['scrollDirection'];
        }
      }

      // Handle assertion type
      if (pattern.action === 'assert') {
        const assertMatch = trimmed.match(/(visible|hidden|enabled|disabled|checked|unchecked|focused|contains|has)/i);
        if (assertMatch) {
          parsed.assertionType = ASSERTION_TYPE_MAP[assertMatch[1].toLowerCase()];
        }
      }

      // Handle wait condition
      if (pattern.action === 'wait') {
        const waitCondition = match[2];
        if (waitCondition) {
          parsed.waitCondition = waitCondition;
        }
      }

      return parsed;
    }
  }

  // Try to infer action from common words as fallback
  return inferAction(trimmed);
}

/**
 * Clean up target description
 */
function cleanTargetDescription(target: string): string {
  return target
    .trim()
    // Remove leading articles
    .replace(/^(the|a|an)\s+/i, '')
    // Remove trailing type indicators
    .replace(/\s+(button|field|input|link|dropdown|checkbox|radio)$/i, '')
    .trim();
}

/**
 * Infer action from instruction as fallback
 */
function inferAction(instruction: string): ParsedAction | null {
  const lower = instruction.toLowerCase();

  // Simple click inference
  if (lower.includes('click') || lower.includes('press') || lower.includes('tap')) {
    const target = instruction
      .replace(/click|press|tap|on|the/gi, '')
      .trim();
    if (target) {
      return {
        action: 'click',
        targetDescription: cleanTargetDescription(target),
        rawInstruction: instruction,
        parseConfidence: 0.6,
      };
    }
  }

  // Simple type inference
  if (lower.includes('type') || lower.includes('enter') || lower.includes('input')) {
    // Try to extract quoted value
    const quotedMatch = instruction.match(/["'](.+?)["']/);
    if (quotedMatch) {
      const target = instruction
        .replace(/type|enter|input|into|in|the|["'].*?["']/gi, '')
        .trim();
      return {
        action: 'type',
        targetDescription: cleanTargetDescription(target),
        value: quotedMatch[1],
        rawInstruction: instruction,
        parseConfidence: 0.5,
      };
    }
  }

  // Could not parse
  return null;
}

/**
 * Parse multiple instructions
 */
export function parseNLInstructions(instructions: string[]): ParsedAction[] {
  const parsed: ParsedAction[] = [];

  for (const instruction of instructions) {
    const result = parseNLInstruction(instruction);
    if (result) {
      parsed.push(result);
    }
  }

  return parsed;
}

/**
 * Split a complex instruction into simple ones
 * e.g., "click Login and type 'admin' in username" -> ["click Login", "type 'admin' in username"]
 */
export function splitCompoundInstruction(instruction: string): string[] {
  // Split on common conjunctions
  const parts = instruction.split(/\s+(?:and|then|,\s*then|,\s*and|,)\s+/i);

  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/**
 * Extract modifiers from instruction
 */
export function extractModifiers(instruction: string): ParsedAction['modifiers'] {
  const modifiers: ParsedAction['modifiers'] = [];
  const lower = instruction.toLowerCase();

  if (lower.includes('shift') || lower.includes('with shift')) {
    modifiers.push('shift');
  }
  if (lower.includes('ctrl') || lower.includes('control') || lower.includes('with ctrl')) {
    modifiers.push('ctrl');
  }
  if (lower.includes('alt') || lower.includes('with alt') || lower.includes('option')) {
    modifiers.push('alt');
  }
  if (lower.includes('meta') || lower.includes('command') || lower.includes('cmd') || lower.includes('windows')) {
    modifiers.push('meta');
  }

  return modifiers.length > 0 ? modifiers : undefined;
}

/**
 * Validate a parsed action
 */
export function validateParsedAction(action: ParsedAction): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!action.targetDescription && action.action !== 'scroll') {
    errors.push('No target element specified');
  }

  if ((action.action === 'type' || action.action === 'select') && !action.value) {
    errors.push(`No value specified for ${action.action} action`);
  }

  if (action.parseConfidence < 0.5) {
    errors.push('Low confidence parsing - instruction may be ambiguous');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Generate a human-readable description of a parsed action
 */
export function describeAction(action: ParsedAction): string {
  switch (action.action) {
    case 'click':
      return `Click on "${action.targetDescription}"`;
    case 'doubleClick':
      return `Double-click on "${action.targetDescription}"`;
    case 'rightClick':
      return `Right-click on "${action.targetDescription}"`;
    case 'type':
      return `Type "${action.value}" into "${action.targetDescription}"`;
    case 'select':
      return `Select "${action.value}" from "${action.targetDescription}"`;
    case 'check':
      return `Check "${action.targetDescription}"`;
    case 'uncheck':
      return `Uncheck "${action.targetDescription}"`;
    case 'clear':
      return `Clear "${action.targetDescription}"`;
    case 'hover':
      return `Hover over "${action.targetDescription}"`;
    case 'focus':
      return `Focus on "${action.targetDescription}"`;
    case 'scroll':
      if (action.scrollDirection) {
        return `Scroll ${action.scrollDirection}`;
      }
      return `Scroll to "${action.targetDescription}"`;
    case 'wait':
      return `Wait for "${action.targetDescription}"${action.waitCondition ? ` to be ${action.waitCondition}` : ''}`;
    case 'assert':
      return `Assert "${action.targetDescription}" is ${action.assertionType || 'valid'}`;
    default:
      return `${action.action} on "${action.targetDescription}"`;
  }
}
