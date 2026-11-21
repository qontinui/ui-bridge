/**
 * Type-level parity: native's mirror of the shared audit core is pinned to the
 * SDK's own types — the response, the heuristic input and the coverage
 * declaration exactly; the adapter member by member (every member the core
 * requires is declared, and each native member is assignable to the core's);
 * and the SDK's `auditDesign` as assignable to the native module's, which is
 * what the handlers' presence-gate cast relies on. Native `src/` imports nothing
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
} from '../design-audit-native';

type Element = { id: string };

/** The SDK's `ElementDesignData` (the specs entry exports it only through the validator). */
type SdkElementDesignData = Parameters<typeof specs.runStyleAudit>[0][number];

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

// The SDK's auditDesign is what the presence gate casts to DesignAuditCoreModule.
export const sdkAuditDesign: DesignAuditCoreModule['auditDesign'] =
  null as unknown as typeof specs.auditDesign;
