/**
 * Synthetic control snapshots for the density core's tests, typed against the
 * SDK's own `ControlSnapshot`. This file does not end in `.test.ts`, so
 * `tsc --noEmit` checks it: a change to the snapshot type breaks the build here
 * rather than leaving the fixtures describing a shape the SDK no longer emits.
 *
 * Every id and text is synthetic (plan D5).
 */

import type { ControlSnapshot, SnapshotViewportContext } from '../../../control/types';
import type { ElementState } from '../../../core/types';
import type { Scrubbed } from '../../../core/redaction';
import type { ElementRelationship } from '../../../relationships/types';

/** A snapshot row, plus the fields the registry serializer emits beyond `ControlSnapshot`'s declared row. */
export type DensityTestSnapshotElement = ControlSnapshot['elements'][number] & {
  uiBridgeId?: string;
  origin?: 'hook' | 'auto';
};

/** A snapshot, plus the identity fields `BridgeSnapshot` adds. */
export type DensityTestSnapshot = ControlSnapshot & {
  snapshotId?: string;
  snapshotTakenAtMs?: number;
};

export interface DensityTestElementSpec {
  id: string;
  tag?: string;
  role?: string;
  category?: 'interactive' | 'content' | 'media';
  /** Viewport-space `[x, y, width, height]`; `null` drops `state.rect`. */
  rect?: [number, number, number, number] | null;
  text?: string;
  visible?: boolean | null;
  visibilityReason?: ElementState['visibilityReason'];
  /** `false` drops `state.computedStyles`. */
  styles?: false | Partial<NonNullable<ElementState['computedStyles']>>;
  scrollWidth?: number;
  clientWidth?: number;
  nameSource?: ElementState['nameSource'];
  ariaExpanded?: boolean;
  href?: string;
  dataset?: Record<string, string>;
  uiBridgeId?: string;
  origin?: 'hook' | 'auto';
  redacted?: boolean;
  scrollInfo?: NonNullable<ElementState['scrollInfo']>;
  xpath?: string;
}

const BASE_STYLES: NonNullable<ElementState['computedStyles']> = {
  display: 'block',
  visibility: 'visible',
  opacity: '1',
  pointerEvents: 'auto',
  cursor: 'auto',
  color: 'rgb(0, 0, 0)',
  backgroundColor: 'rgba(0, 0, 0, 0)',
  colorScheme: 'normal',
  fontSize: '14px',
  fontWeight: '400',
  lineHeight: '20px',
  overflow: 'visible',
  textOverflow: 'clip',
  whiteSpace: 'normal',
  position: 'static',
  zIndex: 'auto',
  padding: '0px',
  margin: '0px',
  borderColor: 'rgb(0, 0, 0)',
  borderWidth: '0px',
  borderRadius: '0px',
};

function scrub(text: string): Scrubbed<string> {
  return text as Scrubbed<string>;
}

/** One snapshot row from a compact spec. */
export function densityTestElement(spec: DensityTestElementSpec): DensityTestSnapshotElement {
  const [x, y, width, height] = spec.rect ?? [0, 0, 100, 20];
  const state: ElementState = {
    visible: true,
    enabled: true,
    disabled: false,
    ariaDisabled: false,
    focused: false,
    rect: { x, y, width, height, top: y, left: x, right: x + width, bottom: y + height },
    scrollWidth: spec.scrollWidth ?? width,
    clientWidth: spec.clientWidth ?? width,
  };
  if (spec.visible === null) {
    delete (state as Partial<ElementState>).visible;
  } else if (spec.visible !== undefined) {
    state.visible = spec.visible;
  }
  if (spec.visibilityReason !== undefined) state.visibilityReason = spec.visibilityReason;
  if (spec.rect === null) delete (state as Partial<ElementState>).rect;
  if (spec.styles !== false) state.computedStyles = { ...BASE_STYLES, ...(spec.styles ?? {}) };
  if (spec.text !== undefined) state.textContent = scrub(spec.redacted ? '[REDACTED]' : spec.text);
  if (spec.redacted) state.redaction = { content: true };
  if (spec.nameSource !== undefined) state.nameSource = spec.nameSource;
  if (spec.ariaExpanded !== undefined) state.ariaExpanded = spec.ariaExpanded;
  if (spec.href !== undefined) state.href = spec.href;
  if (spec.dataset !== undefined) state.dataset = spec.dataset;
  if (spec.scrollInfo !== undefined) state.scrollInfo = spec.scrollInfo;
  if (spec.role !== undefined) state.role = spec.role;

  const row: DensityTestSnapshotElement = {
    id: spec.id,
    type: spec.category === 'interactive' ? 'button' : 'custom',
    actions: [],
    state,
    registeredAt: 1_700_000_000_000,
    mounted: true,
    category: spec.category ?? 'content',
    tagName: spec.tag ?? 'div',
    identifier: { xpath: spec.xpath ?? `//*[@id="${spec.id}"]`, selector: `#${spec.id}` },
  };
  if (spec.role !== undefined) row.role = spec.role;
  if (spec.uiBridgeId !== undefined) row.uiBridgeId = spec.uiBridgeId;
  if (spec.origin !== undefined) row.origin = spec.origin;
  return row;
}

export interface DensityTestSnapshotSpec {
  elements: DensityTestElementSpec[];
  /** `null` drops the viewport block. */
  viewport?: Partial<SnapshotViewportContext> | null;
  /** How many components are registered (default 1). */
  components?: number;
  relationships?: Array<Pick<ElementRelationship, 'source' | 'target' | 'type'>>;
  contentDropped?: number;
  takenAtMs?: number;
}

/** A bare snapshot, as the wrapper's capture matrix writes `snapshot-<n>.json`. */
export function densityTestSnapshot(spec: DensityTestSnapshotSpec): DensityTestSnapshot {
  const takenAt = spec.takenAtMs ?? Date.UTC(2026, 10, 23, 9, 0, 0);
  const snapshot: DensityTestSnapshot = {
    timestamp: takenAt,
    snapshotTakenAtMs: takenAt,
    snapshotId: 'snap-synthetic-1',
    elements: spec.elements.map(densityTestElement),
    components: Array.from({ length: spec.components ?? 1 }, (_, i) => ({
      id: `component-${i}`,
      name: `Component ${i}`,
      actions: [],
      registeredAt: takenAt,
      mounted: true,
    })),
    workflows: [],
    activeRuns: [],
    route: '/synthetic',
  };
  if (spec.viewport !== null) {
    snapshot.viewport = {
      viewportWidth: 1280,
      viewportHeight: 800,
      scrollX: 0,
      scrollY: 0,
      documentWidth: 1280,
      documentHeight: 2400,
      canScrollDown: true,
      canScrollRight: false,
      container: 'viewport',
      ...(spec.viewport ?? {}),
    };
  }
  if (spec.relationships) {
    snapshot.relationships = {
      relationships: spec.relationships.map((r) => ({ ...r, origin: 'declared' as const })),
      count: spec.relationships.length,
      byOrigin: { declared: spec.relationships.length, aria: 0, html: 0 },
    };
  }
  if (spec.contentDropped !== undefined) {
    // `registration.contentDropped` is the field qontinui/ui-bridge#301 would add;
    // the adapter reads it when present.
    snapshot.registration = {
      totalRegistered: spec.elements.length,
      everHadRegistrations: true,
      byRoute: {},
      contentDropped: spec.contentDropped,
    } as NonNullable<ControlSnapshot['registration']> & { contentDropped: number };
  }
  return snapshot;
}

/** The relay's answer around a snapshot. */
export function densityTestEnvelope(
  snapshot: DensityTestSnapshot,
  meta?: { stale?: boolean; cacheAgeMs?: number }
): {
  success: true;
  data: DensityTestSnapshot;
  timestamp: number;
  _meta?: { stale?: boolean; cacheAgeMs?: number };
} {
  return {
    success: true,
    data: snapshot,
    timestamp: snapshot.timestamp,
    ...(meta ? { _meta: meta } : {}),
  };
}

/** The producer every test passes (D-E). */
export const DENSITY_TEST_PRODUCER = {
  id: 'sdk/density',
  version: '0.0.0-test',
  package: '@qontinui/ui-bridge',
} as const;
