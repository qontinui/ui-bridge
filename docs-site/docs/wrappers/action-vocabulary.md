---
sidebar_position: 2
---

# Action Vocabulary

The qontinui runner and the wrapper SDK communicate via **action names** — short camelCase identifiers like `getControlSnapshot`, `executeElementAction`, `find`. The runner sends an action name with a payload; your wrapper's `HandlerRegistry` dispatches to the handler keyed by that string. A typo on either side fails silently with `NO_HANDLER` at runtime.

This page is the canonical reference for the vocabulary. If you're new to wrappers, read [Authoring a Wrapper](./authoring.md) first.

## Where the vocabulary is defined

Two files are the source of truth — one per side of the protocol:

| Side        | File                                                        | Role                                                                                                                                                       |
| ----------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wrapper SDK | `ui-bridge/packages/ui-bridge/src/server/relay-handlers.ts` | Defines every action handler available to apps. Each `relayCommand('<name>', payload)` / `queueCommand<T>('<name>', payload)` site is a registered action. |
| Runner      | `qontinui-runner/src-tauri/src/mcp/sdk_client.rs`           | Dispatches actions over WebSocket via `dispatch_app_request(state, "<name>", ...)`. Each call is a runner-side use of the action.                          |

The cross-language [validator](#validating-action-names) below diffs the two sets and fails CI if the runner dispatches an action the wrapper SDK has no handler for.

## Action groups

Names are grouped by domain. Each entry is the canonical action; see `relay-handlers.ts` for the exact handler signature and return shape.

### Snapshot & elements

`getControlSnapshot`, `getElement`, `getElementImages`, `getElementHistory`, `getElementReactState`, `getElementState`, `getElementTree`, `getElementStyles`, `getElementStateStyles`, `executeElementAction`, `executeBatchAction`, `controlBatch`, `find`, `highlightElement`, `captureSnapshot`

### Components

`getComponentState`, `executeComponentAction`

### Forms

`getForms`, `fillForm`, `snapshotForms`, `diffForms`

### Page lifecycle

`pageRefresh`, `pageNavigate`, `pageGoBack`, `pageGoForward`, `pageScroll`, `pageEvaluate`

### Idle / wait

`getIdleStatus`, `getIdleSignalStatus`, `waitForIdle`, `waitForSignalIdle`, `waitForTargets`, `waitForElement`, `waitForElementByCondition`, `waitForElementRegistered`, `waitForRouteChange`

### Network

`getNetworkRequests`, `getNetworkRequestsInFlight`, `getNetworkRequest`, `waitForNetworkRequest`, `getNetworkChains`

### Console & errors

`getConsoleErrors`, `clearConsoleErrors`, `getBrowserEvents`, `getTimeline`, `getHealthReport`, `startErrorSession`, `endErrorSession`, `getErrorSessions`, `captureErrorBaseline`, `compareErrorBaseline`, `getErrorSnapshots`, `getErrorReport`

### State machine

`getStates`, `getActiveStates`, `getState`, `activateState`, `deactivateState`, `getStateGroups`, `activateStateGroup`, `deactivateStateGroup`, `getTransitions`, `canExecuteTransition`, `executeTransition`, `findPath`, `navigateTo`

### Workflows

`runWorkflow`, `getWorkflowStatus`

### Undo / redo & history

`getUndoState`, `executeUndo`, `executeRedo`, `getActionHistory`, `getRenderLog`, `clearRenderLog`

### Performance

`getPerformanceEntries`, `clearPerformanceEntries`

### AI features

`aiSearch`, `aiFind`, `aiExecute`, `aiAssert`, `aiAssertBatch`, `aiSemanticSearch`, `getPageSummary`, `getSemanticDiff`, `analyzePageData`, `analyzePageRegions`, `analyzeStructuredData`, `crossAppCompare`, `executeWithDiff`, `waitForChange`, `categorizeLastDiff`, `getScopedDiff`, `summarizeDiff`, `analyzeStructuredChanges`

### Change buffer

`enableChangeBuffer`, `disableChangeBuffer`, `drainChangeBuffer`, `getChangeBufferSize`

### Bookmarks

`saveBookmark`, `getBookmark`, `deleteBookmark`, `listBookmarks`, `diffFromBookmark`

### Intents

`listIntents`, `executeIntent`, `findIntent`, `registerIntent`, `executeIntentFromQuery`, `attemptRecovery`, `deleteIntent`

### Annotations

`getAnnotations`, `getAnnotation`, `setAnnotation`, `deleteAnnotation`, `importAnnotations`, `exportAnnotations`, `getAnnotationCoverage`

### Clipboard

`getClipboard`, `setClipboard`

> Earlier versions of `relay-handlers.ts` exposed `clipboardRead()` / `clipboardWrite()` aliases; both now forward to the canonical names and are marked `@deprecated`.

### Design

`getDesignSnapshot`, `getResponsiveSnapshots`, `setViewportConstraints`, `runDesignAudit`, `loadStyleGuide`, `getStyleGuide`, `clearStyleGuide`, `evaluateQuality`, `getQualityContexts`

### Baselines

`saveBaseline`, `diffBaseline`

### Media

`findMedia`, `mediaAuditAccessibility`, `mediaAuditPerformance`, `captureMediaSnapshot`, `compareMediaSnapshots`, `analyzeMedia`, `analyzeMediaBatch`, `analyzeMediaPage`

### Convenience (page-level)

`clickByText`, `clickBySelector`, `typeInto`, `readValue`, `findByText`, `query`, `getDiagnostics`, `getRoutes`, `navigateByAdapter`

## Aliases that no longer exist

These names appeared in older docs / scaffolder templates. They forward to canonical names in current `relay-handlers.ts` (with `@deprecated` JSDoc), so existing callers keep working but the canonical name is what goes over the wire:

| Deprecated       | Canonical      | Removed since         |
| ---------------- | -------------- | --------------------- |
| `discover`       | `find`         | `21ef25e` (ui-bridge) |
| `clipboardRead`  | `getClipboard` | `21ef25e` (ui-bridge) |
| `clipboardWrite` | `setClipboard` | `21ef25e` (ui-bridge) |

## Looking up an HTTP route

Every action that the runner dispatches is reachable via at least one HTTP route. To find the route for action `<X>`:

```bash
grep -B 30 'dispatch_app_request(.*"<X>"' \
  D:/qontinui-root/qontinui-runner/src-tauri/src/mcp/sdk_client.rs \
  | grep -E '^/// (GET|POST|PUT|DELETE)'
```

Or open `sdk_client.rs` and find the handler — every handler has a `/// METHOD /path — description` doc comment above it.

## Wrapper-only actions (no runner caller)

Some actions exist on the wrapper-SDK side but the runner doesn't proxy them. They're intentional non-proxies, not gaps:

| Action             | Why no runner route                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------ |
| `pageEvaluate`     | Runner uses IPC (`ui_bridge_request_sync`) instead — see `handle_page_evaluate`                              |
| `query`            | Runner uses IPC — see `handle_query_selector`                                                                |
| `getStateSnapshot` | Runner synthesizes from `getControlSnapshot` — see `handle_state_snapshot`                                   |
| `getSpecs`         | Runner calls it via `sdk_request` directly from `handle_discover_and_cache`, not through the dispatch helper |

If you add a new action to `relay-handlers.ts` and want it reachable via HTTP, add a matching `dispatch_app_request` site in `sdk_client.rs` — see the [Adding a new action](#adding-a-new-action) section below.

## Validating action names

The runner ships a cross-language validator that diffs the two action sets:

```bash
cd qontinui-runner
npm run validate:ws-actions

# verbose mode lists wrapper-only orphans
npm run validate:ws-actions -- --verbose
```

Sample output:

```
runner sites=146, wrapper actions=150, missing=0, orphans=4
ok: every runner action has a matching wrapper handler
```

`missing=0` means every action the runner dispatches has a matching handler in `relay-handlers.ts`. If `missing > 0`, the validator exits non-zero and lists the offenders — a wrapper running this version of the runner would silently fail with `NO_HANDLER` for those routes.

The validator is wired into `npm run check` for the runner, so CI fails on action-name drift before the change ships.

## Adding a new action

End-to-end checklist for adding action `<X>`:

1. **Wrapper SDK side** (`ui-bridge/packages/ui-bridge/src/server/relay-handlers.ts`): add a handler method that calls `relayCommand('<X>', payload)` (or `relayWithFallback` if you have a server-side fallback).
2. **Browser-side wrapper** (or your wrapper's `transport.register('<X>', fn)`): register the handler that actually does the work.
3. **Runner** (`qontinui-runner/src-tauri/src/mcp/sdk_client.rs`):
   - Add a handler function `handle_<x>` that calls `dispatch_app_request(&state, "<X>", payload, METHOD, "/control/<path>", body)`.
   - Add `.route("/ui-bridge/sdk/control/<path>", post(handle_<x>))` (or `get`/`delete`) in the route registration block.
4. **Validate**: `npm run validate:ws-actions` — should still report `missing=0`, with `runner sites` increased by 1.
5. **Test**: extend the wrapper-live-example smoke or add a curl-based assertion.

The runner's [`dispatch_app_request`](https://github.com/qontinui/qontinui-runner/blob/main/src-tauri/src/mcp/sdk_client.rs) helper handles WS routing, HTTP fallback, and IPC fallback in one call — every retrofitted route follows the same pattern.

## Related

- [Authoring a Wrapper](./authoring.md) — when to pick which transport, register-frame contract, smoke test pattern.
- [`relay-handlers.ts`](https://github.com/qontinui/ui-bridge/blob/main/packages/ui-bridge/src/server/relay-handlers.ts) — wrapper SDK handler vocabulary.
- [`sdk_client.rs`](https://github.com/qontinui/qontinui-runner/blob/main/src-tauri/src/mcp/sdk_client.rs) — runner dispatch sites and HTTP routes.
- [`validate-ws-actions.mjs`](https://github.com/qontinui/qontinui-runner/blob/main/scripts/validate-ws-actions.mjs) — drift validator.
