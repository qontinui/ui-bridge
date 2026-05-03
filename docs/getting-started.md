# Getting Started — UI Bridge SDK Primitives

This tutorial walks through the seven things you actually do with the UI Bridge SDK once it is wired into a project: annotate, build, query, author, regress, diagnose, surface. Every step links to the ADR that locked the decision behind it.

> Audience: AI consumers and humans bringing up a new app on the UI Bridge. Concise, link-heavy, structured.

## 1. What you build

Given a React component with `<State>` / `<TransitionTo>` annotations:

```tsx
function LoginPage() {
  return (
    <State id="login-form" elements={["email-input", "password-input", "submit-btn"]}>
      <form>
        <input id="email-input" />
        <input id="password-input" type="password" />
        <button id="submit-btn">Log in</button>
      </form>
      <TransitionTo
        id="open-dashboard"
        fromStates={["login-form"]}
        activateStates={["dashboard"]}
        effect="write"
      >
        <></>
      </TransitionTo>
    </State>
  );
}
```

You will:

- Have the build plugin extract this annotation set into a deterministic IR document.
- Have the runner Spec API serve a bundled-page projection of that IR over HTTP.
- Run a generated `RegressionSuite` against the live page from the runner-side executor.
- Get a `SelfDiagnosis` when an assertion fails, written to a `MemorySink`.

There is no `*.spec.uibridge.json` to author by hand. The IR is the only authoring surface; the projection is auto-generated.

Decision: [ADR-001](../../qontinui-dev-notes/ui-bridge-redesign/section-1-foundations/ADR-001-foundations.md) (IR foundations + `<State>` / `<TransitionTo>` primitives).

## 2. Annotate

`<State>` and `<TransitionTo>` are JSX wrappers exported from `@qontinui/ui-bridge`. They compile to `useUIState` / `useUITransition` calls at runtime — the wrappers exist only so the IR extractor has a stable AST shape to walk.

Imports:

```tsx
import { State, TransitionTo } from "@qontinui/ui-bridge";
```

Source:

- `ui-bridge/packages/ui-bridge/src/react/State.tsx`
- `ui-bridge/packages/ui-bridge/src/react/TransitionTo.tsx`

Required props:

| Component | Required | Notable optional |
|-----------|----------|------------------|
| `<State>` | `id`, one of `elements: string[]` or `requiredElements: ElementCriteria[]` | `name`, `metadata`, `provenance` |
| `<TransitionTo>` | `id`, `activateStates: string[]` | `fromStates`, `exitStates`, `effect: "read"\|"write"\|"destructive"`, `metadata`, `provenance` |

`elements: string[]` is authoring sugar — at IR-emission time the build plugin lifts `["a", "b"]` to `[{ id: "a" }, { id: "b" }]`. `ElementCriteria` is the canonical shape because it survives ID drift (it describes *what to look for*, not *which specific registered element*).

Decision: [ADR-001 §D7](../../qontinui-dev-notes/ui-bridge-redesign/section-1-foundations/ADR-001-foundations.md) (state shape canonicalization).

## 3. Build

The build plugin runs at dev/build time and emits IR.

### Vite / Tauri

```typescript
// vite.config.ts
import { uiBridgeIRPlugin } from "@qontinui/ui-bridge-auto/ir-builder";

export default {
  plugins: [
    uiBridgeIRPlugin({
      root: __dirname,
      pagesPattern: "src/pages/**/*.tsx",
      outDir: "specs/pages",
    }),
  ],
};
```

Plugin source: `ui-bridge-auto/src/ir-builder/vite-plugin.ts` — runs at `buildStart` and `handleHotUpdate`. The framework-agnostic core (`build-project-ir.ts`) is shared with the standalone CLI.

### Next.js / non-Vite

```bash
npx ui-bridge-build-ir \
  --root . \
  --pages "app/**/*.tsx" \
  --out-dir specs/pages
```

The standalone CLI is the only `bin` shipped by `ui-bridge-auto` after Section 12 deleted the legacy `static-builder` and `migrate-cli` paths.

### What lands on disk

```
<root>/specs/pages/<id>/
├── state-machine.derived.json   # IR — the authoring surface
└── spec.uibridge.json            # projection — runtime shape
```

The projection is regenerated automatically; do not author it by hand and do not commit a hand-written one. Section 12 deleted the 121 legacy fixture files that pre-dated this layout.

Decision: [ADR-001 §D3 + D8](../../qontinui-dev-notes/ui-bridge-redesign/section-1-foundations/ADR-001-foundations.md) (ts-morph extractor + build-step CLI). [ADR-004](../../qontinui-dev-notes/ui-bridge-redesign/section-4-adapters/ADR-004-metro-tauri.md) covers Metro and Tauri adapters.

## 4. Query

The runner mounts the Spec API at port 9876. Endpoints are pure pass-throughs of the on-disk layout under `specs/pages/<id>/`.

```bash
# Catalog
curl http://localhost:9876/spec/list
# → { ok: true, specs: [{ specId, appName, config }, ...] }

# One projection
curl http://localhost:9876/spec/page/login-form
# → bundled-page projection

# Empty case carries an explicit reason
curl http://localhost:9876/spec/list  # → { ok: true, specs: [], reason: "no-pages-registered" }
```

Spec API source: `qontinui-runner/src-tauri/src/spec_api/{mod,handlers,storage}.rs`.

### React / TypeScript consumers

```typescript
import {
  useDiscoveredSpec,
  useDiscoveredSpecs,
  loadDiscoveredSpec,
  loadDiscoveredSpecs,
} from "@/lib/ui-bridge/use-discovered-specs";

// Component path
const { specs, loading, error, refresh } = useDiscoveredSpecs();
const one = useDiscoveredSpec("login-form");

// Non-component path
const all = await loadDiscoveredSpecs();
const exact = await loadDiscoveredSpec("login-form");
```

Both paths share a module-singleton cache. The hook subscribes to `/spec/subscribe` (Server-Sent Events) on first call; on every `spec.changed` broadcast it invalidates the cache and notifies subscribers — components re-render with new data automatically.

`DiscoveredSpec` is a wrapper: `{ specId, config, appName? }`. Unwrap `.config` before passing to `usePageSpecs`.

**Slug ≠ spec id gotcha.** Two web routes carry a spec id that doesn't match their URL segment — `/runs/active` → `active-runs`; `/settings/ai` → `ai-settings`. Read the existing `usePageSpecs({ "<id>": ... })` key, do not infer from filename.

Decision: [ADR-013](../../qontinui-dev-notes/ui-bridge-redesign/section-13-spec-runtime-loading/ADR-013-spec-runtime-loading.md) (`GET /spec/list` + runtime fetch). [ADR-013.5](../../qontinui-dev-notes/ui-bridge-redesign/section-13-5-spec-runtime-loading-completion/ADR-013-5-runtime-loading-completion.md) (production-touchpoint completion).

## 5. Author programmatically

`POST /spec/author` is the single write path. The runner persists the IR document, regenerates the projection, and broadcasts `spec.changed` over SSE. Every `useDiscoveredSpecs()` consumer in both the runner and qontinui-web re-renders with the new data — no rebuild, no restart, no regen step.

```typescript
import type { IrDocument } from "@qontinui/shared-types/ui-bridge-ir";

const ir: IrDocument = {
  id: "my-page",
  version: "0.1.0",
  states: [
    {
      id: "my-state",
      requiredElements: [{ id: "submit-btn" }],
    },
  ],
  transitions: [
    {
      id: "my-transition",
      fromStates: ["my-state"],
      activateStates: ["next-state"],
      effect: "read",
    },
  ],
};

await fetch("http://localhost:9876/spec/author", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(ir),
});
```

The handler is at `qontinui-runner/src-tauri/src/spec_api/handlers.rs:559`. SSE invalidation is at `:624`.

The IR adapter (`qontinui-schemas/ts/src/ui-bridge-ir/adapter.ts`) projects the IR onto the legacy bundled-page shape that runtime consumers expect.

Decision: [ADR-001 §D6 + D7](../../qontinui-dev-notes/ui-bridge-redesign/section-1-foundations/ADR-001-foundations.md) (schema-folder boundary + state shape canonicalization).

## 6. Run regression

`generateRegressionSuite(ir)` in `@qontinui/ui-bridge-auto/regression` produces a deterministic `RegressionSuite` from an IR document. Hand the suite to the runner-side executor; it walks each `RegressionAssertion` against a live UI Bridge registry and produces a `RegressionRunResult`.

```typescript
import { generateRegressionSuite, serializeSuite } from "@qontinui/ui-bridge-auto/regression";
import { runRegressionSuite } from "@/lib/regression-executor";

const ir = await loadIr("login-form");
const suite = generateRegressionSuite(ir);
const result = await runRegressionSuite(suite, {
  registry: bridgeRegistry,
  baselineStore: tauriBaselineStore,
  // optional overlay providers (token-check / cross-check)
  // tokenRegistry, ocrProvider
});
```

The executor:

- `executeQuery` for action-target assertions (`@qontinui/ui-bridge-auto/runtime`).
- `findFirst` per `requiredElement` for state-active assertions.
- `ScreenshotAssertionManager` for visual gates (`@qontinui/ui-bridge-auto/visual`).
- Three built-in overlay handlers (visibility, token-check, cross-check) for overlay assertions.

Source: `qontinui-runner/src/lib/regression-executor.ts`. Persistence sink: `qontinui-runner/src/lib/regression-memory-sink.ts` (PG-backed). Coverage panel: `qontinui-runner/src/pages/regression/CoveragePanel.tsx`. CLI: `qontinui-runner/scripts/coverage-diff.mjs`.

Decision: [ADR-009](../../qontinui-dev-notes/ui-bridge-redesign/section-9-auto-regression/ADR-009-auto-regression-generator.md) (deterministic generator + serializer + coverage). [ADR-011 §1, §2](../../qontinui-dev-notes/ui-bridge-redesign/section-11-other-consumers/ADR-011-other-consumers.md) (coverage tooling + denormalized exercise log).

## 7. Diagnose

When a regression run produces failures, `diagnose(runResult, driftContext)` from `@qontinui/ui-bridge-auto/diagnosis` builds a `SelfDiagnosis` — the actionable report the AI consumer surfaces.

```typescript
import { diagnose, serializeDiagnosis, type MemorySink } from "@qontinui/ui-bridge-auto/diagnosis";
import { createPgMemorySink } from "@/lib/regression-memory-sink";

const sink: MemorySink = createPgMemorySink(/* tauri invoke binding */);

const diagnosis = diagnose(runResult, {
  commits: filteredCommits,        // file-overlap filtered git history
  fragility: fragilityScore,        // optional Section 7 signal
  recordings: recentSessions,       // optional Section 5 traces
});

sink.record({ runId: runResult.runId, diagnosis });
// sink.lastWrite is a Promise<string> | null — await it to confirm persistence
await sink.lastWrite;
```

`DriftContext` is built by walking commits since the suite's `generatedAt` and filtering to commits whose changed-files set intersects the file paths referenced by the suite's IR provenance — file-overlap is what the engine's evidence-weighting uses internally. No count cap. Source: `qontinui-runner/src/lib/regression-commit-filter.ts`.

Diagnoses surface in two places:

- The runner's regression panel (`RegressionRunPage.tsx`).
- The unified drift route at `qontinui-web/frontend/src/app/(app)/runs/[id]/drift/[entryId]/page.tsx`, dispatched by `DriftEntry.kind` to either `SpecDriftDetail.tsx` or `VisualDriftDetail.tsx`.

Decision: [ADR-010](../../qontinui-dev-notes/ui-bridge-redesign/section-10-self-diagnosis/ADR-010-self-diagnosis-and-memory.md) (self-diagnosis + memory sink). [ADR-011 §4, §5](../../qontinui-dev-notes/ui-bridge-redesign/section-11-other-consumers/ADR-011-other-consumers.md) (DriftContext + unified drift route).

## Where to go next

| Topic | Reference |
|-------|-----------|
| Full SDK + IR API reference | `knowledge-base/qontinui-specific/ui-bridge.md` |
| AWAS comparison + integration | `ui-bridge/docs/awas-comparison.md` |
| Decision trail (all ADRs) | `qontinui-dev-notes/ui-bridge-redesign/section-N-*/ADR-NNN-*.md` |
| Subpath import discipline | `ui-bridge-auto/CLAUDE.md` |
| Spec API endpoint catalog | `qontinui-runner/CLAUDE.md` |
| Runtime loading on the web | `qontinui-web/CLAUDE.md` |

The redesign closes Section 12 with this tutorial as the AI-consumer entry point. Treat it as a contract: every primitive named here is a stable, ADR-backed surface.
