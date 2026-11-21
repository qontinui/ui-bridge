/**
 * Type-level parity: native's mirror of the shared audit core's response is
 * exactly the SDK's own `DesignAuditResponse`. Native `src/` imports nothing
 * from the optional `@qontinui/ui-bridge` peer, so the published handler types
 * carry a local copy (`../design-audit-native.ts`); this file fails
 * `npm run typecheck` the moment the two drift. Vitest does not run it.
 * Plan: 2026-11-21-native-design-audit-answers-like-web-design-audit-of (D4).
 */

import { expectTypeOf } from 'vitest';
import type * as specs from '@qontinui/ui-bridge/specs';
import type {
  NativeDesignAuditAdapter,
  NativeDesignAuditResponse,
  NativeHeuristicInput,
} from '../design-audit-native';

expectTypeOf<NativeDesignAuditResponse>().toEqualTypeOf<specs.DesignAuditResponse>();
expectTypeOf<NativeHeuristicInput>().toEqualTypeOf<specs.HeuristicInput>();
expectTypeOf<
  NativeDesignAuditAdapter<{ id: string }>['heuristicCoverage']
>().toEqualTypeOf<specs.HeuristicCoverageDeclaration>();
