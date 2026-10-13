/**
 * The capture matrix: one page, captured at every combination of breakpoint ×
 * colour scheme × device pixel ratio, each combination a fresh browser context,
 * with every frame-and-snapshot pair stored beside its provenance.
 *
 * Plan 2026-10-13-image-generation-and-visual-judgment, Phase 9 item 4. The axes
 * come from flags today; once that plan's Phase 14 lands, an image slot spec's
 * `contexts {breakpoints, themes, dpr}` is the other source of the same three
 * lists, and it feeds {@link expandMatrix} unchanged.
 *
 * This module is pure (axis expansion, cell ids, the manifest shape). Driving a
 * browser per cell is the CLI's job (`inject-cli.ts`, `runMatrix`).
 */

import { relative } from 'node:path';
import type { FrameColorScheme, FrameError, FrameRecord } from './frame-capture.js';

/** A CSS-pixel viewport. */
export interface MatrixViewport {
  width: number;
  height: number;
}

/**
 * One combination. A `null` axis value means "not set by the caller": the
 * browser default applies (Playwright's 1280×720 viewport, DPR 1, no colour
 * scheme override) and the frame's own provenance records what that was.
 */
export interface MatrixCell {
  viewport: MatrixViewport | null;
  dpr: number | null;
  colorScheme: FrameColorScheme | null;
}

/** The three axes. An empty axis contributes one `null` value (the default). */
export interface MatrixAxes {
  viewports: MatrixViewport[];
  dprs: number[];
  colorSchemes: FrameColorScheme[];
}

/**
 * Every combination of the axes, viewport-major, in the order each axis was
 * given — so a run is reproducible and its cells read in a predictable order.
 */
export function expandMatrix(axes: MatrixAxes): MatrixCell[] {
  const viewports: (MatrixViewport | null)[] = axes.viewports.length > 0 ? axes.viewports : [null];
  const dprs: (number | null)[] = axes.dprs.length > 0 ? axes.dprs : [null];
  const schemes: (FrameColorScheme | null)[] =
    axes.colorSchemes.length > 0 ? axes.colorSchemes : [null];
  const cells: MatrixCell[] = [];
  for (const viewport of viewports) {
    for (const dpr of dprs) {
      for (const colorScheme of schemes) {
        cells.push({ viewport, dpr, colorScheme });
      }
    }
  }
  return cells;
}

/**
 * A filesystem-safe, human-readable id for a cell — also its directory name.
 * e.g. `390x844_dpr2_dark`; an unset axis reads `viewport-default`,
 * `dpr-default` or `scheme-default`, so a default is never mistaken for a
 * measured value.
 */
export function cellId(cell: MatrixCell): string {
  const vp = cell.viewport ? `${cell.viewport.width}x${cell.viewport.height}` : 'viewport-default';
  const dpr = cell.dpr !== null ? `dpr${cell.dpr}` : 'dpr-default';
  const scheme = cell.colorScheme ?? 'scheme-default';
  return `${vp}_${dpr}_${scheme}`;
}

/** One stored frame-and-snapshot pair. Paths are relative to the manifest's directory. */
export interface MatrixPair {
  /** The plan action's 1-based position (the `n` in `frame-<n>.png`). */
  position: number;
  /** The control snapshot file. */
  snapshot: string;
  /** The frame's provenance, its `path` made relative; `null` when no frame was produced. */
  frame: FrameRecord | null;
  frameError?: FrameError;
}

/** What happened to one cell. */
export type MatrixCellStatus =
  /** Every action ran and every requested frame was produced. */
  | 'captured'
  /** The page loaded, but an action failed or a frame could not be produced. */
  | 'incomplete'
  /** The cell never reached a drivable page (launch, emulation or ready failed). */
  | 'failed';

export interface MatrixCellReport {
  id: string;
  /** What the caller asked for. The frames' own provenance says what was rendered. */
  requested: MatrixCell;
  status: MatrixCellStatus;
  /** Why the cell failed outright (`status: 'failed'`). */
  error?: { code: string; message: string };
  /** Every action's output line, exactly as exec mode prints it (relative path). */
  results: string | null;
  pairs: MatrixPair[];
}

/** `<dir>/matrix.json`. */
export interface MatrixManifest {
  kind: 'ui-bridge-capture-matrix';
  /** Bumped on any incompatible change to this shape. */
  schemaVersion: 1;
  url: string;
  producer: { name: 'ui-bridge-inject'; package: string; version: string | null };
  startedAt: string;
  finishedAt: string;
  /** The axes as given; an empty list means that axis was left at the browser default. */
  axes: MatrixAxes;
  /** The per-cell plan, run in every cell. */
  plan: { position: number; action: string; payload: unknown }[];
  cells: MatrixCellReport[];
}

/** A path relative to the manifest directory, with forward slashes on every OS. */
export function manifestPath(manifestDir: string, absPath: string): string {
  return relative(manifestDir, absPath).split('\\').join('/');
}
