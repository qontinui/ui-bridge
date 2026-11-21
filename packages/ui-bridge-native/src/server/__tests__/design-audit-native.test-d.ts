/**
 * Type-level parity: native's mirror of the shared audit core is pinned to the
 * SDK's own types — the response, the heuristic input, the coverage
 * declaration and the style guide exactly; the adapter member by member: the
 * same keys in both directions, every method's parameters exactly, every
 * return exactly (records' assignable, since a native record omits
 * stateVariations), and the whole adapter assignable to the core's; and the SDK's
 * `auditDesign` as assignable to `DesignAuditCoreModule['auditDesign']`, which
 * is what the handlers' presence-gate cast relies on. That module member is a
 * property, so the assignment is checked strictly (`strictFunctionTypes`):
 * narrowing any SDK parameter — `request`, `loadedGuide`, the adapter — fails
 * it. Native `src/` imports nothing
 * from the optional `@qontinui/ui-bridge` peer, so the published handler types
 * carry a local copy (`../design-audit-native.ts`); this file fails
 * `npm run typecheck` the moment the two drift. Vitest does not run it.
 * Plan: 2026-11-21-native-design-audit-answers-like-web-design-audit-of (D4).
 */

import { expectTypeOf } from 'vitest';
import type * as specs from '@qontinui/ui-bridge/specs';
import type {
  DesignAuditCoreModule,
  NativeAuditRecord,
  NativeDesignAuditAdapter,
  NativeDesignAuditResponse,
  NativeHeuristicInput,
  NativeStyleGuideConfig,
} from '../design-audit-native';

type Element = { id: string };

/** The SDK's `ElementDesignData` (the specs entry exports it only through the validator). */
type SdkElementDesignData = Parameters<typeof specs.runStyleAudit>[0][number];

expectTypeOf<NativeStyleGuideConfig>().toEqualTypeOf<specs.StyleGuideConfig>();

expectTypeOf<NativeDesignAuditResponse>().toEqualTypeOf<specs.DesignAuditResponse>();
expectTypeOf<NativeHeuristicInput>().toEqualTypeOf<specs.HeuristicInput>();
expectTypeOf<
  NativeDesignAuditAdapter<{ id: string }>['heuristicCoverage']
>().toEqualTypeOf<specs.HeuristicCoverageDeclaration>();

// A native record is a web ElementDesignData (no native-only state names).
expectTypeOf<NativeAuditRecord>().toExtend<SdkElementDesignData>();

// Every member the core's adapter requires is declared by the native mirror,
// and the mirror adds none the core does not know.
expectTypeOf<
  Exclude<keyof specs.DesignAuditAdapter<Element>, keyof NativeDesignAuditAdapter<Element>>
>().toEqualTypeOf<never>();
expectTypeOf<
  Exclude<keyof NativeDesignAuditAdapter<Element>, keyof specs.DesignAuditAdapter<Element>>
>().toEqualTypeOf<never>();
expectTypeOf<NativeDesignAuditAdapter<Element>>().toExtend<specs.DesignAuditAdapter<Element>>();

// Adapter members are method signatures, which TypeScript compares
// bivariantly, so each member's parameters are pinned EXACTLY (with distinct
// T and R, so a T/R swap shows) and its return as well: equal where the type is
// mirrored, and for records assignable to the SDK's (a native record omits the
// stateVariations the validator never reads).
type Readable = Element & { readable: true };
type NativeAdapter = NativeDesignAuditAdapter<Element, Readable>;
type SdkAdapter = specs.DesignAuditAdapter<Element, Readable>;

expectTypeOf<Parameters<NativeAdapter['isReadable']>>().toEqualTypeOf<
  Parameters<SdkAdapter['isReadable']>
>();
expectTypeOf<ReturnType<NativeAdapter['isReadable']>>().toEqualTypeOf<
  ReturnType<SdkAdapter['isReadable']>
>();
expectTypeOf<NativeAdapter['isReadable']>().toEqualTypeOf<SdkAdapter['isReadable']>();

expectTypeOf<Parameters<NativeAdapter['records']>>().toEqualTypeOf<
  Parameters<SdkAdapter['records']>
>();
expectTypeOf<ReturnType<NativeAdapter['records']>>().toExtend<ReturnType<SdkAdapter['records']>>();

expectTypeOf<Parameters<NativeAdapter['heuristicInput']>>().toEqualTypeOf<
  Parameters<SdkAdapter['heuristicInput']>
>();
expectTypeOf<ReturnType<NativeAdapter['heuristicInput']>>().toEqualTypeOf<
  ReturnType<SdkAdapter['heuristicInput']>
>();

expectTypeOf<Parameters<NativeAdapter['defaultRootFontSizePx']>>().toEqualTypeOf<
  Parameters<SdkAdapter['defaultRootFontSizePx']>
>();
expectTypeOf<ReturnType<NativeAdapter['defaultRootFontSizePx']>>().toEqualTypeOf<
  ReturnType<SdkAdapter['defaultRootFontSizePx']>
>();

expectTypeOf<NativeAdapter['heuristicCoverage']>().toEqualTypeOf<SdkAdapter['heuristicCoverage']>();

// The SDK's auditDesign is what the presence gate casts to DesignAuditCoreModule.
export const sdkAuditDesign: DesignAuditCoreModule['auditDesign'] =
  null as unknown as typeof specs.auditDesign;
