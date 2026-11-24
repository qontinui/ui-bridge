/**
 * The density core's public surface.
 *
 * Every exported name contains `density` or `Density`, so that none collides in
 * a consumer's namespace (a test enforces it). Every file of this directory is
 * pure — no DOM, no Node builtin, no build-time constant — and imports only its
 * siblings and `../observation/observation`, because the directory is copied
 * verbatim into `@qontinui/ui-bridge-headless`.
 *
 * Plan: 2026-11-23-ui-bridge-measures-information-density-as-reach-per-role-and-plans-the-change
 */

export {
  DENSITY_CAPTURE_SCHEMA,
  DENSITY_PRODUCER_ID,
  DENSITY_TARGETS_SCHEMA,
  parseDensityCapture,
  parseDensityTargets,
  type DensityAsk,
  type DensityAskKind,
  type DensityCapture,
  type DensityCaptureBases,
  type DensityCaptureViewport,
  type DensityCell,
  type DensityContentCap,
  type DensityCoverage,
  type DensityFoldBasis,
  type DensityItem,
  type DensityItemKind,
  type DensityLandmark,
  type DensityMatcher,
  type DensityParseResult,
  type DensityPinBasis,
  type DensityProbeResult,
  type DensityProblem,
  type DensityProducer,
  type DensityRect,
  type DensityRole,
  type DensityRoleProbe,
  type DensityScrollBasis,
  type DensityScrollerEvidence,
  type DensityTargets,
  type DensityTextMatchRecord,
  type DensityUnmeasured,
  type DensityVisibility,
} from './schema';
export {
  DensityHashError,
  canonicalDensityJson,
  densityAsksHash,
  densityTargetsHash,
  densityTextHash,
  hashDensityCanonical,
  sha256DensityHex,
} from './hash';
export {
  DENSITY_SHAPE_RULES,
  densityShapeOf,
  type DensityShape,
  type DensityShapeRule,
} from './shape';
export {
  collectDensityTextMatchers,
  densityMatcherKey,
  densityTextSatisfies,
  evaluateDensityTextMatchers,
  resolveDensityMatcher,
  resolveDensityMatchers,
  type DensityMatchResult,
  type DensityUnresolvedReason,
} from './match';
export {
  captureDensityFromSnapshot,
  type DensityCaptureObservation,
  type DensityCaptureOptions,
} from './capture-from-snapshot';
export {
  DENSITY_BLOCK_TAGS,
  densityBlocks,
  densityChildren,
  densityHeadingLevel,
  densityLeaves,
  densityPinnedIds,
  densityPins,
  densitySameColumn,
  densityUnattributedChars,
  isDensityHeading,
  isDensityMedia,
  resolveDensityStructure,
  type DensityBlock,
  type DensityBlockBy,
  type DensityBlocks,
  type DensityLeaves,
  type DensityPins,
  type DensityStructureHint,
  type DensityUnresolvedBlock,
} from './structure';
export {
  DENSITY_BLOCK_LIST_CAP,
  DENSITY_KIND_BASES,
  classifyDensityItems,
  summarizeDensityStructure,
  type DensityBlockSummary,
  type DensityClassification,
  type DensityItemClass,
  type DensityKindBy,
  type DensityKindCounts,
  type DensityStructureSummary,
  type DensityUnresolvedClassify,
} from './classify';
export {
  DENSITY_CHAR_WIDTH_EM,
  DENSITY_REPEAT_LIST_CAP,
  DENSITY_REPEAT_MIN_ROWS,
  DENSITY_REPEAT_TOLERANCE_PX,
  DENSITY_REPEAT_SCOPE_LEVELS,
  densityInnermostRepeats,
  densityNearestRepeats,
  densityRepeatScopes,
  densityRepeatTargets,
  densityRepeats,
  densitySubtree,
  densityTakesSpace,
  isDensityFilterControl,
  isDensityFinderControl,
  isDensityNavControl,
  summarizeDensityRepeats,
  type DensityRepeat,
  type DensityRepeatBy,
  type DensityRepeatFinder,
  type DensityRepeatInputs,
  type DensityRepeatRowBand,
  type DensityRepeatScope,
  type DensityRepeatScopeBy,
  type DensityRepeatSummary,
  type DensityRepeatsReport,
  type DensityUnknownQuantity,
} from './repeats';
export {
  DENSITY_AFFORDANCE_KINDS,
  DENSITY_AFFORDANCE_LIST_CAP,
  DENSITY_AFFORDANCE_RULES,
  densityAffordances,
  summarizeDensityAffordances,
  type DensityAffordance,
  type DensityAffordanceInputs,
  type DensityAffordanceKind,
  type DensityAffordanceRule,
  type DensityAffordanceState,
  type DensityAffordancesReport,
  type DensityHides,
} from './affordances';
