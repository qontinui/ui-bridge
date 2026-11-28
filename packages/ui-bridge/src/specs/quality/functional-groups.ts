/**
 * Functional groups — the forms, searches, tables, toolbars, dialogs, navs and
 * sectioning regions a page is built from, read from `structure.group` (the
 * nearest functional ancestor `/design/evaluate` collected, registered or not),
 * with the element classes the information-density categories share: fields,
 * buttons, interactive controls, and row banding.
 */

import type { ElementDesignData, QualityGroupKind } from '../../core/types';
import { answersToNamedType } from '../../core/element-kind';
import type { Rect } from './geometry';

export interface FunctionalGroup {
  key: string;
  kind: QualityGroupKind;
  label?: string;
  rect: Rect;
  members: ElementDesignData[];
  fields: ElementDesignData[];
  buttons: ElementDesignData[];
}

const FIELD_TAGS = new Set(['input', 'select', 'textarea']);
const FIELD_ROLES = new Set([
  'textbox',
  'searchbox',
  'combobox',
  'listbox',
  'checkbox',
  'radio',
  'switch',
  'slider',
  'spinbutton',
]);
const NON_FIELD_INPUT_TYPES = new Set(['submit', 'button', 'reset', 'image', 'hidden']);
const TEXT_ENTRY_INPUT_TYPES = new Set(['', 'text', 'email', 'tel', 'url', 'number', 'password', 'date', 'datetime-local', 'month', 'week', 'time']);

/**
 * An interactive element, by its registered type (the classification
 * `touchTargetCompliance` and the consistency metrics use).
 */
export function isInteractive(el: ElementDesignData): boolean {
  const t = el.type.toLowerCase();
  return (
    t === 'button' ||
    // An ARIA textbox and a combobox/listbox, as their native twins; a range
    // <input> is the `slider` kind.
    answersToNamedType(t, 'input') ||
    answersToNamedType(t, 'select') ||
    t === 'slider' ||
    t === 'textarea' ||
    t === 'link' ||
    t === 'a' ||
    t === 'checkbox' ||
    t === 'radio' ||
    t === 'switch' ||
    t === 'pressable' ||
    t === 'touchable'
  );
}

function tagOf(el: ElementDesignData): string {
  return el.structure?.tagName ?? '';
}

function controlType(el: ElementDesignData): string {
  return (el.structure?.controlType ?? '').toLowerCase();
}

/** A form field: an input that is not a button, a select, a textarea, or an ARIA field role. */
export function isField(el: ElementDesignData): boolean {
  const tag = tagOf(el);
  if (tag === 'input') return !NON_FIELD_INPUT_TYPES.has(controlType(el));
  if (FIELD_TAGS.has(tag)) return true;
  if (FIELD_ROLES.has(el.structure?.role ?? '')) return true;
  if (tag) return false;
  const t = el.type.toLowerCase();
  return answersToNamedType(t, 'input') || answersToNamedType(t, 'select') || t === 'textarea';
}

/** A field that takes typed data (a text-like input or a textarea), not a choice or a search. */
export function isTextEntry(el: ElementDesignData): boolean {
  const tag = tagOf(el);
  if (tag === 'textarea') return true;
  if (tag === 'input') return TEXT_ENTRY_INPUT_TYPES.has(controlType(el));
  return el.structure?.role === 'textbox';
}

export function isButton(el: ElementDesignData): boolean {
  const tag = tagOf(el);
  if (tag === 'button') return true;
  if (tag === 'input') {
    const t = controlType(el);
    return NON_FIELD_INPUT_TYPES.has(t) && t !== 'hidden';
  }
  return el.structure?.role === 'button' || (!tag && el.type.toLowerCase() === 'button');
}

/** A submit control: a `<button>` with no type or `type=submit`, or an `<input type=submit|image>`. */
export function isSubmit(el: ElementDesignData): boolean {
  const t = controlType(el);
  if (tagOf(el) === 'button') return t === '' || t === 'submit';
  return tagOf(el) === 'input' && (t === 'submit' || t === 'image');
}

/** Group the rendered elements by the functional group each sits in. */
export function collectGroups(rendered: readonly ElementDesignData[]): Map<string, FunctionalGroup> {
  const groups = new Map<string, FunctionalGroup>();
  for (const el of rendered) {
    const g = el.structure?.group;
    if (!g) continue;
    let group = groups.get(g.key);
    if (!group) {
      group = { key: g.key, kind: g.kind, label: g.label, rect: g.rect, members: [], fields: [], buttons: [] };
      groups.set(g.key, group);
    }
    group.members.push(el);
    if (isField(el)) group.fields.push(el);
    else if (isButton(el)) group.buttons.push(el);
  }
  return groups;
}

/**
 * Band elements into rows: two elements share a row when their vertical
 * ranges overlap by more than half the shorter one. Rows are ordered top to
 * bottom, members left to right.
 */
export function bandRows(elements: readonly ElementDesignData[]): ElementDesignData[][] {
  const rows: ElementDesignData[][] = [];
  const sorted = [...elements].sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
  for (const el of sorted) {
    const row = rows.find((r) =>
      r.some((m) => {
        const overlap =
          Math.min(m.rect.y + m.rect.height, el.rect.y + el.rect.height) -
          Math.max(m.rect.y, el.rect.y);
        return overlap > 0.5 * Math.min(m.rect.height, el.rect.height);
      })
    );
    if (row) row.push(el);
    else rows.push([el]);
  }
  for (const row of rows) row.sort((a, b) => a.rect.x - b.rect.x);
  return rows;
}

export function describeGroup(g: { kind: QualityGroupKind; label?: string; key: string }): string {
  return g.label ? `${g.kind} "${g.label}"` : `${g.kind} ${g.key}`;
}

export function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}
