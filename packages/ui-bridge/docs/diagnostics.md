<!-- @generated from diagnostics/codes.json — do not edit. -->
<!-- Regenerate with `npm run diagnostics:generate`; CI drift-guards via `npm run diagnostics:check`. -->

# UI Bridge Diagnostic Catalog

Every machine-facing UI Bridge failure surface emits a stable `UB-` diagnostic code.
This catalog is the human-readable companion to the generated code enum
(`@qontinui/ui-bridge/diagnostics`), the `npx @qontinui/ui-bridge explain <CODE>`
CLI, and the `GET /diagnostics/:code` proxy endpoint — all four are generated
from the single source of truth `diagnostics/codes.json`.

There are **41** diagnostic codes.

## Index

### Element

- [`UB-AMBIGUOUS-MATCH`](#ub-ambiguous-match) — Multiple elements match with similar confidence; a single best match could not be chosen.
- [`UB-ELEM-BLOCKED`](#ub-elem-blocked) — The element is blocked by another element such as a modal, overlay, or popup.
- [`UB-ELEM-DISABLED`](#ub-elem-disabled) — The element is disabled and cannot be interacted with.
- [`UB-ELEM-NOT-ENABLED`](#ub-elem-not-enabled) — The element is present and visible but disabled, so it cannot be interacted with.
- [`UB-ELEM-NOT-FOUND`](#ub-elem-not-found) — No element matching the target description or selector could be found.
- [`UB-ELEM-NOT-INTERACTABLE`](#ub-elem-not-interactable) — The element is visible and enabled but cannot receive the interaction (e.g. covered, animating, or pointer-events:none).
- [`UB-ELEM-NOT-VISIBLE`](#ub-elem-not-visible) — The element exists in the DOM but is not currently visible.
- [`UB-LOW-CONFIDENCE`](#ub-low-confidence) — The best matching element has confidence below the acceptance threshold.
- [`UB-MULTIPLE-ELEMENTS`](#ub-multiple-elements) — Multiple elements match the description; the target is ambiguous.
- [`UB-STALE-ELEMENT`](#ub-stale-element) — The element reference is no longer attached to the DOM.

### Action

- [`UB-ACTION-FAILED`](#ub-action-failed) — The action could not be completed.
- [`UB-ACTION-REJECTED`](#ub-action-rejected) — The action was rejected before execution (e.g. by a guard, policy, or validation gate).
- [`UB-ACTION-TIMEOUT`](#ub-action-timeout) — The action timed out waiting for a condition to be met.
- [`UB-UNSUPPORTED-ACTION`](#ub-unsupported-action) — The requested action type is not supported for this element or surface.

### Assertion

- [`UB-ASSERT-CONTRAST`](#ub-assert-contrast) — A color-contrast (accessibility) assertion failed.
- [`UB-ASSERT-ELEMENT-MISSING`](#ub-assert-element-missing) — An assertion targeted an element that does not exist.
- [`UB-ASSERT-LAYOUT`](#ub-assert-layout) — A layout/geometry assertion failed (position, size, alignment, overlap).
- [`UB-ASSERT-TEXT-MISMATCH`](#ub-assert-text-mismatch) — An assertion about element text content failed (exact/contains/regex mismatch).
- [`UB-ASSERT-TIMEOUT`](#ub-assert-timeout) — An assertion timed out waiting for its condition.
- [`UB-ASSERT-VISIBILITY`](#ub-assert-visibility) — An assertion about element visibility failed.

### Network

- [`UB-NAVIGATION-ERROR`](#ub-navigation-error) — Navigation to the target page failed.
- [`UB-NET-ERROR`](#ub-net-error) — A network error occurred while performing the action or loading data.
- [`UB-PAGE-LOAD-ERROR`](#ub-page-load-error) — The page failed to load correctly.

### System

- [`UB-HEALTH-EMPTY-CONTENT-AREA`](#ub-health-empty-content-area) — Page health: the main content area is nearly empty while the sidebar/left region has content.
- [`UB-HEALTH-EMPTY-TEXT-SIGNAL`](#ub-health-empty-text-signal) — Page health: empty-state text was detected (e.g. "no results", "nothing here").
- [`UB-HEALTH-ERROR-TEXT-SIGNAL`](#ub-health-error-text-signal) — Page health: error-indicating text was detected on the page.
- [`UB-HEALTH-LOADING-CLASS-SIGNAL`](#ub-health-loading-class-signal) — Page health: a loading/skeleton/spinner CSS class was detected on a visible element.
- [`UB-HEALTH-LOADING-TEXT-SIGNAL`](#ub-health-loading-text-signal) — Page health: loading-indicating text was detected, suggesting the page is not settled.
- [`UB-HEALTH-LOW-ELEMENT-DIVERSITY`](#ub-health-low-element-diversity) — Page health: all visible elements are navigation-type, suggesting the content body is missing.
- [`UB-HEALTH-LOW-SPATIAL-COVERAGE`](#ub-health-low-spatial-coverage) — Page health: rendered elements occupy a critically/abnormally small fraction of the viewport.
- [`UB-HEALTH-MANY-DISABLED-INTERACTIVE`](#ub-health-many-disabled-interactive) — Page health: over half of interactive elements are disabled.
- [`UB-HEALTH-NO-CONTENT-ELEMENTS`](#ub-health-no-content-elements) — Page health: no elements were found in the content region.
- [`UB-HEALTH-OFF-SCREEN-ELEMENT`](#ub-health-off-screen-element) — Page health: a visible element is positioned entirely off-screen.
- [`UB-HEALTH-SPARSE-CONTENT`](#ub-health-sparse-content) — Page health: the content region has very few elements.
- [`UB-HEALTH-ZERO-SIZE-ELEMENT`](#ub-health-zero-size-element) — Page health: a visible element has zero width or height.
- [`UB-PARSE-ERROR`](#ub-parse-error) — Could not parse the natural language instruction.
- [`UB-STATE-NOT-REACHED`](#ub-state-not-reached) — The expected post-action state was not reached.
- [`UB-UNEXPECTED-STATE`](#ub-unexpected-state) — The element or page is in an unexpected state.
- [`UB-UNKNOWN-ERROR`](#ub-unknown-error) — An unknown or uncategorized error occurred.
- [`UB-VALIDATION-ERROR`](#ub-validation-error) — The parsed action failed validation.
- [`UB-VLM-STRUCTURED-PARSE-FAIL`](#ub-vlm-structured-parse-fail) — The VLM Describe response could not be parsed into the closed structured schema; the prose-only response was returned with structured=null.

---

## UB-ACTION-FAILED

**Category:** `action`

The action could not be completed.

### Common causes

- The element became non-interactable mid-action
- A transient runtime error interrupted the action
- The underlying handler threw

### Default recovery template

- **Check if the element is interactable** — confidence: 0.7, retryable: no, priority: 1
- **Wait and retry the action** — command: `wait 1 second then retry`, confidence: 0.6, retryable: yes, priority: 2

### See also

[`UB-ACTION-REJECTED`](#ub-action-rejected), [`UB-ACTION-TIMEOUT`](#ub-action-timeout), [`UB-UNSUPPORTED-ACTION`](#ub-unsupported-action)

## UB-ACTION-REJECTED

**Category:** `action`

The action was rejected before execution (e.g. by a guard, policy, or validation gate).

### Common causes

- A safety guard blocked the action
- The action is not permitted in the current state
- Preconditions for the action were not met

### Default recovery template

- **Check whether the action is permitted in the current state** — confidence: 0.6, retryable: no, priority: 1
- **Satisfy the action's preconditions and retry** — confidence: 0.5, retryable: yes, priority: 2

### See also

[`UB-ACTION-FAILED`](#ub-action-failed), [`UB-ACTION-TIMEOUT`](#ub-action-timeout), [`UB-UNSUPPORTED-ACTION`](#ub-unsupported-action)

## UB-ACTION-TIMEOUT

**Category:** `action`

The action timed out waiting for a condition to be met.

### Common causes

- The awaited condition can never be satisfied
- The configured timeout is too short for the operation
- The page stopped responding

### Default recovery template

- **Increase the timeout duration (the wait gave up after ${waitDurationMs}ms)** — confidence: 0.8, retryable: yes, priority: 1
- **Check if the condition '${waitCondition}' can ever be met** — confidence: 0.7, retryable: no, priority: 2
- **Verify the page is responding** — command: `check page status`, confidence: 0.6, retryable: yes, priority: 3

### See also

[`UB-ACTION-FAILED`](#ub-action-failed), [`UB-ACTION-REJECTED`](#ub-action-rejected), [`UB-UNSUPPORTED-ACTION`](#ub-unsupported-action)

## UB-AMBIGUOUS-MATCH

**Category:** `element`

Multiple elements match with similar confidence; a single best match could not be chosen.

### Common causes

- Two or more elements have near-identical text
- The search criteria are not discriminating enough
- Section context was not provided

### Default recovery template

- **Be more specific about which element you mean** — confidence: 0.9, retryable: no, priority: 1
- **Include the section or form name in the description** — confidence: 0.8, retryable: no, priority: 2
- **Use the element ID directly** — confidence: 0.7, retryable: no, priority: 3

### See also

[`UB-ELEM-BLOCKED`](#ub-elem-blocked), [`UB-ELEM-DISABLED`](#ub-elem-disabled), [`UB-ELEM-NOT-ENABLED`](#ub-elem-not-enabled), [`UB-ELEM-NOT-FOUND`](#ub-elem-not-found), [`UB-ELEM-NOT-INTERACTABLE`](#ub-elem-not-interactable), [`UB-ELEM-NOT-VISIBLE`](#ub-elem-not-visible), [`UB-LOW-CONFIDENCE`](#ub-low-confidence), [`UB-MULTIPLE-ELEMENTS`](#ub-multiple-elements), [`UB-STALE-ELEMENT`](#ub-stale-element)

## UB-ASSERT-CONTRAST

**Category:** `assertion`

A color-contrast (accessibility) assertion failed.

### Common causes

- Foreground/background contrast is below the required ratio
- A theme change reduced contrast
- The element is over a low-contrast background

### Default recovery template

- **Adjust the color tokens to meet the required contrast ratio** — confidence: 0.4, retryable: no, priority: 1

### See also

[`UB-ASSERT-ELEMENT-MISSING`](#ub-assert-element-missing), [`UB-ASSERT-LAYOUT`](#ub-assert-layout), [`UB-ASSERT-TEXT-MISMATCH`](#ub-assert-text-mismatch), [`UB-ASSERT-TIMEOUT`](#ub-assert-timeout), [`UB-ASSERT-VISIBILITY`](#ub-assert-visibility)

## UB-ASSERT-ELEMENT-MISSING

**Category:** `assertion`

An assertion targeted an element that does not exist.

### Common causes

- The target element was never registered or rendered
- The element was removed before the assertion ran
- The selector/id is wrong

### Default recovery template

- **Verify the element id/selector and that it is rendered before asserting** — command: `wait for element`, confidence: 0.5, retryable: yes, priority: 1

### See also

[`UB-ASSERT-CONTRAST`](#ub-assert-contrast), [`UB-ASSERT-LAYOUT`](#ub-assert-layout), [`UB-ASSERT-TEXT-MISMATCH`](#ub-assert-text-mismatch), [`UB-ASSERT-TIMEOUT`](#ub-assert-timeout), [`UB-ASSERT-VISIBILITY`](#ub-assert-visibility)

## UB-ASSERT-LAYOUT

**Category:** `assertion`

A layout/geometry assertion failed (position, size, alignment, overlap).

### Common causes

- The element's geometry differs from the expected layout
- A responsive breakpoint changed the layout
- The assertion ran before layout settled

### Default recovery template

- **Wait for layout to settle and re-assert** — confidence: 0.5, retryable: yes, priority: 1

### See also

[`UB-ASSERT-CONTRAST`](#ub-assert-contrast), [`UB-ASSERT-ELEMENT-MISSING`](#ub-assert-element-missing), [`UB-ASSERT-TEXT-MISMATCH`](#ub-assert-text-mismatch), [`UB-ASSERT-TIMEOUT`](#ub-assert-timeout), [`UB-ASSERT-VISIBILITY`](#ub-assert-visibility)

## UB-ASSERT-TEXT-MISMATCH

**Category:** `assertion`

An assertion about element text content failed (exact/contains/regex mismatch).

### Common causes

- The actual text differs from the expected text
- The text had not finished updating when asserted
- Whitespace or casing differences

### Default recovery template

- **Re-read the element text and compare; relax to a contains/regex match if appropriate** — confidence: 0.5, retryable: yes, priority: 1

### See also

[`UB-ASSERT-CONTRAST`](#ub-assert-contrast), [`UB-ASSERT-ELEMENT-MISSING`](#ub-assert-element-missing), [`UB-ASSERT-LAYOUT`](#ub-assert-layout), [`UB-ASSERT-TIMEOUT`](#ub-assert-timeout), [`UB-ASSERT-VISIBILITY`](#ub-assert-visibility)

## UB-ASSERT-TIMEOUT

**Category:** `assertion`

An assertion timed out waiting for its condition.

### Common causes

- The asserted condition never became true
- The timeout was shorter than the time the condition needs
- The page stopped updating

### Default recovery template

- **Increase the assertion timeout or verify the condition can be met** — confidence: 0.5, retryable: yes, priority: 1

### See also

[`UB-ASSERT-CONTRAST`](#ub-assert-contrast), [`UB-ASSERT-ELEMENT-MISSING`](#ub-assert-element-missing), [`UB-ASSERT-LAYOUT`](#ub-assert-layout), [`UB-ASSERT-TEXT-MISMATCH`](#ub-assert-text-mismatch), [`UB-ASSERT-VISIBILITY`](#ub-assert-visibility)

## UB-ASSERT-VISIBILITY

**Category:** `assertion`

An assertion about element visibility failed.

### Common causes

- The element was expected visible but is hidden (or vice versa)
- The element had not rendered when the assertion ran
- An overlay changed effective visibility

### Default recovery template

- **Wait for the element to reach the expected visibility and re-assert** — command: `wait for element`, confidence: 0.6, retryable: yes, priority: 1

### See also

[`UB-ASSERT-CONTRAST`](#ub-assert-contrast), [`UB-ASSERT-ELEMENT-MISSING`](#ub-assert-element-missing), [`UB-ASSERT-LAYOUT`](#ub-assert-layout), [`UB-ASSERT-TEXT-MISMATCH`](#ub-assert-text-mismatch), [`UB-ASSERT-TIMEOUT`](#ub-assert-timeout)

## UB-ELEM-BLOCKED

**Category:** `element`

The element is blocked by another element such as a modal, overlay, or popup.

### Common causes

- A modal dialog is open over the target
- A toast or notification overlay intercepts pointer events
- A full-screen loading layer is present

### Default recovery template

- **Close the modal or popup** — command: `click close button`, confidence: 0.9, retryable: yes, priority: 1
- **Dismiss the overlay** — confidence: 0.8, retryable: yes, priority: 2
- **Wait for the blocking element to disappear** — confidence: 0.6, retryable: yes, priority: 3

### See also

[`UB-AMBIGUOUS-MATCH`](#ub-ambiguous-match), [`UB-ELEM-DISABLED`](#ub-elem-disabled), [`UB-ELEM-NOT-ENABLED`](#ub-elem-not-enabled), [`UB-ELEM-NOT-FOUND`](#ub-elem-not-found), [`UB-ELEM-NOT-INTERACTABLE`](#ub-elem-not-interactable), [`UB-ELEM-NOT-VISIBLE`](#ub-elem-not-visible), [`UB-LOW-CONFIDENCE`](#ub-low-confidence), [`UB-MULTIPLE-ELEMENTS`](#ub-multiple-elements), [`UB-STALE-ELEMENT`](#ub-stale-element)

## UB-ELEM-DISABLED

**Category:** `element`

The element is disabled and cannot be interacted with.

### Common causes

- Required prerequisite fields are not yet filled
- A guard condition keeps the control disabled
- An async dependency has not resolved

### Default recovery template

- **Fill in required fields first** — confidence: 0.8, retryable: no, priority: 1
- **Complete prerequisite steps** — confidence: 0.7, retryable: no, priority: 2
- **Wait for '${elementId}' to become enabled** — command: `wait for element to be enabled`, confidence: 0.6, retryable: yes, priority: 3

### See also

[`UB-AMBIGUOUS-MATCH`](#ub-ambiguous-match), [`UB-ELEM-BLOCKED`](#ub-elem-blocked), [`UB-ELEM-NOT-ENABLED`](#ub-elem-not-enabled), [`UB-ELEM-NOT-FOUND`](#ub-elem-not-found), [`UB-ELEM-NOT-INTERACTABLE`](#ub-elem-not-interactable), [`UB-ELEM-NOT-VISIBLE`](#ub-elem-not-visible), [`UB-LOW-CONFIDENCE`](#ub-low-confidence), [`UB-MULTIPLE-ELEMENTS`](#ub-multiple-elements), [`UB-STALE-ELEMENT`](#ub-stale-element)

## UB-ELEM-NOT-ENABLED

**Category:** `element`

The element is present and visible but disabled, so it cannot be interacted with.

### Common causes

- Required form fields have not been filled
- A prerequisite step in a workflow is incomplete
- The element is intentionally disabled until an async operation completes

### Default recovery template

- **Fill in required fields first** — confidence: 0.8, retryable: no, priority: 1
- **Complete prerequisite steps in the form** — confidence: 0.7, retryable: no, priority: 2
- **Wait for the element to become enabled** — command: `wait for element to be enabled`, confidence: 0.6, retryable: yes, priority: 3

### See also

[`UB-AMBIGUOUS-MATCH`](#ub-ambiguous-match), [`UB-ELEM-BLOCKED`](#ub-elem-blocked), [`UB-ELEM-DISABLED`](#ub-elem-disabled), [`UB-ELEM-NOT-FOUND`](#ub-elem-not-found), [`UB-ELEM-NOT-INTERACTABLE`](#ub-elem-not-interactable), [`UB-ELEM-NOT-VISIBLE`](#ub-elem-not-visible), [`UB-LOW-CONFIDENCE`](#ub-low-confidence), [`UB-MULTIPLE-ELEMENTS`](#ub-multiple-elements), [`UB-STALE-ELEMENT`](#ub-stale-element)

## UB-ELEM-NOT-FOUND

**Category:** `element`

No element matching the target description or selector could be found.

### Common causes

- The page had not finished loading when the action ran
- The element is rendered only after a user interaction
- The description/selector does not match any element on the page
- The element is in a different route or tab than the active one

### Default recovery template

- **Wait for the page to fully load, then look for '${elementId}' again** — command: `wait for page to load`, confidence: 0.7, retryable: yes, priority: 1
- **Use a different description for the element '${elementId}'** — confidence: 0.8, retryable: no, priority: 2
- **Scroll the page to reveal '${elementId}'** — command: `scroll down`, confidence: 0.6, retryable: yes, priority: 3

### See also

[`UB-AMBIGUOUS-MATCH`](#ub-ambiguous-match), [`UB-ELEM-BLOCKED`](#ub-elem-blocked), [`UB-ELEM-DISABLED`](#ub-elem-disabled), [`UB-ELEM-NOT-ENABLED`](#ub-elem-not-enabled), [`UB-ELEM-NOT-INTERACTABLE`](#ub-elem-not-interactable), [`UB-ELEM-NOT-VISIBLE`](#ub-elem-not-visible), [`UB-LOW-CONFIDENCE`](#ub-low-confidence), [`UB-MULTIPLE-ELEMENTS`](#ub-multiple-elements), [`UB-STALE-ELEMENT`](#ub-stale-element)

## UB-ELEM-NOT-INTERACTABLE

**Category:** `element`

The element is visible and enabled but cannot receive the interaction (e.g. covered, animating, or pointer-events:none).

### Common causes

- A modal or popup is overlaying the element
- A CSS animation or transition is in progress
- The element is partially outside the viewport
- pointer-events:none is set on the element or an ancestor

### Default recovery template

- **Close any modal or popup blocking the element** — command: `click close button`, confidence: 0.9, retryable: yes, priority: 1
- **Scroll the element into the viewport** — command: `scroll to element`, confidence: 0.8, retryable: yes, priority: 2
- **Wait for animations to complete** — confidence: 0.7, retryable: yes, priority: 3

### See also

[`UB-AMBIGUOUS-MATCH`](#ub-ambiguous-match), [`UB-ELEM-BLOCKED`](#ub-elem-blocked), [`UB-ELEM-DISABLED`](#ub-elem-disabled), [`UB-ELEM-NOT-ENABLED`](#ub-elem-not-enabled), [`UB-ELEM-NOT-FOUND`](#ub-elem-not-found), [`UB-ELEM-NOT-VISIBLE`](#ub-elem-not-visible), [`UB-LOW-CONFIDENCE`](#ub-low-confidence), [`UB-MULTIPLE-ELEMENTS`](#ub-multiple-elements), [`UB-STALE-ELEMENT`](#ub-stale-element)

## UB-ELEM-NOT-VISIBLE

**Category:** `element`

The element exists in the DOM but is not currently visible.

### Common causes

- The element is scrolled out of the viewport
- A loading overlay or modal is covering it
- A parent has display:none or visibility:hidden
- The element has zero size or no layout box

### Default recovery template

- **Scroll to make '${elementId}' visible** — command: `scroll to element`, confidence: 0.9, retryable: yes, priority: 1
- **Close any blocking modals or popups** — command: `click close button`, confidence: 0.8, retryable: yes, priority: 2
- **Wait for any loading overlays to disappear** — command: `wait for loading`, confidence: 0.7, retryable: yes, priority: 3

### See also

[`UB-AMBIGUOUS-MATCH`](#ub-ambiguous-match), [`UB-ELEM-BLOCKED`](#ub-elem-blocked), [`UB-ELEM-DISABLED`](#ub-elem-disabled), [`UB-ELEM-NOT-ENABLED`](#ub-elem-not-enabled), [`UB-ELEM-NOT-FOUND`](#ub-elem-not-found), [`UB-ELEM-NOT-INTERACTABLE`](#ub-elem-not-interactable), [`UB-LOW-CONFIDENCE`](#ub-low-confidence), [`UB-MULTIPLE-ELEMENTS`](#ub-multiple-elements), [`UB-STALE-ELEMENT`](#ub-stale-element)

## UB-HEALTH-EMPTY-CONTENT-AREA

**Category:** `system`

Page health: the main content area is nearly empty while the sidebar/left region has content.

### Common causes

- The content panel failed to render
- A data fetch for the main view errored
- A routing issue left the content region blank

### Default recovery template

- **Reload the view and re-run the health check** — command: `refresh page`, confidence: 0.6, retryable: yes, priority: 1

### See also

[`UB-HEALTH-EMPTY-TEXT-SIGNAL`](#ub-health-empty-text-signal), [`UB-HEALTH-ERROR-TEXT-SIGNAL`](#ub-health-error-text-signal), [`UB-HEALTH-LOADING-CLASS-SIGNAL`](#ub-health-loading-class-signal), [`UB-HEALTH-LOADING-TEXT-SIGNAL`](#ub-health-loading-text-signal), [`UB-HEALTH-LOW-ELEMENT-DIVERSITY`](#ub-health-low-element-diversity), [`UB-HEALTH-LOW-SPATIAL-COVERAGE`](#ub-health-low-spatial-coverage), [`UB-HEALTH-MANY-DISABLED-INTERACTIVE`](#ub-health-many-disabled-interactive), [`UB-HEALTH-NO-CONTENT-ELEMENTS`](#ub-health-no-content-elements), [`UB-HEALTH-OFF-SCREEN-ELEMENT`](#ub-health-off-screen-element), [`UB-HEALTH-SPARSE-CONTENT`](#ub-health-sparse-content), [`UB-HEALTH-ZERO-SIZE-ELEMENT`](#ub-health-zero-size-element), [`UB-PARSE-ERROR`](#ub-parse-error), [`UB-STATE-NOT-REACHED`](#ub-state-not-reached), [`UB-UNEXPECTED-STATE`](#ub-unexpected-state), [`UB-UNKNOWN-ERROR`](#ub-unknown-error), [`UB-VALIDATION-ERROR`](#ub-validation-error), [`UB-VLM-STRUCTURED-PARSE-FAIL`](#ub-vlm-structured-parse-fail)

## UB-HEALTH-EMPTY-TEXT-SIGNAL

**Category:** `system`

Page health: empty-state text was detected (e.g. "no results", "nothing here").

### Common causes

- A data set returned no items
- A filter excluded all results
- The expected data failed to load

### Default recovery template

- **Verify the data source and filters; re-run the health check after data loads** — confidence: 0.4, retryable: no, priority: 1

### See also

[`UB-HEALTH-EMPTY-CONTENT-AREA`](#ub-health-empty-content-area), [`UB-HEALTH-ERROR-TEXT-SIGNAL`](#ub-health-error-text-signal), [`UB-HEALTH-LOADING-CLASS-SIGNAL`](#ub-health-loading-class-signal), [`UB-HEALTH-LOADING-TEXT-SIGNAL`](#ub-health-loading-text-signal), [`UB-HEALTH-LOW-ELEMENT-DIVERSITY`](#ub-health-low-element-diversity), [`UB-HEALTH-LOW-SPATIAL-COVERAGE`](#ub-health-low-spatial-coverage), [`UB-HEALTH-MANY-DISABLED-INTERACTIVE`](#ub-health-many-disabled-interactive), [`UB-HEALTH-NO-CONTENT-ELEMENTS`](#ub-health-no-content-elements), [`UB-HEALTH-OFF-SCREEN-ELEMENT`](#ub-health-off-screen-element), [`UB-HEALTH-SPARSE-CONTENT`](#ub-health-sparse-content), [`UB-HEALTH-ZERO-SIZE-ELEMENT`](#ub-health-zero-size-element), [`UB-PARSE-ERROR`](#ub-parse-error), [`UB-STATE-NOT-REACHED`](#ub-state-not-reached), [`UB-UNEXPECTED-STATE`](#ub-unexpected-state), [`UB-UNKNOWN-ERROR`](#ub-unknown-error), [`UB-VALIDATION-ERROR`](#ub-validation-error), [`UB-VLM-STRUCTURED-PARSE-FAIL`](#ub-vlm-structured-parse-fail)

## UB-HEALTH-ERROR-TEXT-SIGNAL

**Category:** `system`

Page health: error-indicating text was detected on the page.

### Common causes

- An application error was rendered to the user
- A failed request surfaced an error banner
- An exception boundary rendered a fallback

### Default recovery template

- **Inspect the error message and address the underlying failure before retrying** — confidence: 0.5, retryable: no, priority: 1

### See also

[`UB-HEALTH-EMPTY-CONTENT-AREA`](#ub-health-empty-content-area), [`UB-HEALTH-EMPTY-TEXT-SIGNAL`](#ub-health-empty-text-signal), [`UB-HEALTH-LOADING-CLASS-SIGNAL`](#ub-health-loading-class-signal), [`UB-HEALTH-LOADING-TEXT-SIGNAL`](#ub-health-loading-text-signal), [`UB-HEALTH-LOW-ELEMENT-DIVERSITY`](#ub-health-low-element-diversity), [`UB-HEALTH-LOW-SPATIAL-COVERAGE`](#ub-health-low-spatial-coverage), [`UB-HEALTH-MANY-DISABLED-INTERACTIVE`](#ub-health-many-disabled-interactive), [`UB-HEALTH-NO-CONTENT-ELEMENTS`](#ub-health-no-content-elements), [`UB-HEALTH-OFF-SCREEN-ELEMENT`](#ub-health-off-screen-element), [`UB-HEALTH-SPARSE-CONTENT`](#ub-health-sparse-content), [`UB-HEALTH-ZERO-SIZE-ELEMENT`](#ub-health-zero-size-element), [`UB-PARSE-ERROR`](#ub-parse-error), [`UB-STATE-NOT-REACHED`](#ub-state-not-reached), [`UB-UNEXPECTED-STATE`](#ub-unexpected-state), [`UB-UNKNOWN-ERROR`](#ub-unknown-error), [`UB-VALIDATION-ERROR`](#ub-validation-error), [`UB-VLM-STRUCTURED-PARSE-FAIL`](#ub-vlm-structured-parse-fail)

## UB-HEALTH-LOADING-CLASS-SIGNAL

**Category:** `system`

Page health: a loading/skeleton/spinner CSS class was detected on a visible element.

### Common causes

- A skeleton or spinner is still showing
- An async region has not resolved

### Default recovery template

- **Wait for the loading indicator to clear and re-run the health check** — command: `wait for loading`, confidence: 0.6, retryable: yes, priority: 1

### See also

[`UB-HEALTH-EMPTY-CONTENT-AREA`](#ub-health-empty-content-area), [`UB-HEALTH-EMPTY-TEXT-SIGNAL`](#ub-health-empty-text-signal), [`UB-HEALTH-ERROR-TEXT-SIGNAL`](#ub-health-error-text-signal), [`UB-HEALTH-LOADING-TEXT-SIGNAL`](#ub-health-loading-text-signal), [`UB-HEALTH-LOW-ELEMENT-DIVERSITY`](#ub-health-low-element-diversity), [`UB-HEALTH-LOW-SPATIAL-COVERAGE`](#ub-health-low-spatial-coverage), [`UB-HEALTH-MANY-DISABLED-INTERACTIVE`](#ub-health-many-disabled-interactive), [`UB-HEALTH-NO-CONTENT-ELEMENTS`](#ub-health-no-content-elements), [`UB-HEALTH-OFF-SCREEN-ELEMENT`](#ub-health-off-screen-element), [`UB-HEALTH-SPARSE-CONTENT`](#ub-health-sparse-content), [`UB-HEALTH-ZERO-SIZE-ELEMENT`](#ub-health-zero-size-element), [`UB-PARSE-ERROR`](#ub-parse-error), [`UB-STATE-NOT-REACHED`](#ub-state-not-reached), [`UB-UNEXPECTED-STATE`](#ub-unexpected-state), [`UB-UNKNOWN-ERROR`](#ub-unknown-error), [`UB-VALIDATION-ERROR`](#ub-validation-error), [`UB-VLM-STRUCTURED-PARSE-FAIL`](#ub-vlm-structured-parse-fail)

## UB-HEALTH-LOADING-TEXT-SIGNAL

**Category:** `system`

Page health: loading-indicating text was detected, suggesting the page is not settled.

### Common causes

- An async load is still in progress
- The page is stuck in a loading state

### Default recovery template

- **Wait for loading to complete and re-run the health check** — command: `wait for loading`, confidence: 0.6, retryable: yes, priority: 1

### See also

[`UB-HEALTH-EMPTY-CONTENT-AREA`](#ub-health-empty-content-area), [`UB-HEALTH-EMPTY-TEXT-SIGNAL`](#ub-health-empty-text-signal), [`UB-HEALTH-ERROR-TEXT-SIGNAL`](#ub-health-error-text-signal), [`UB-HEALTH-LOADING-CLASS-SIGNAL`](#ub-health-loading-class-signal), [`UB-HEALTH-LOW-ELEMENT-DIVERSITY`](#ub-health-low-element-diversity), [`UB-HEALTH-LOW-SPATIAL-COVERAGE`](#ub-health-low-spatial-coverage), [`UB-HEALTH-MANY-DISABLED-INTERACTIVE`](#ub-health-many-disabled-interactive), [`UB-HEALTH-NO-CONTENT-ELEMENTS`](#ub-health-no-content-elements), [`UB-HEALTH-OFF-SCREEN-ELEMENT`](#ub-health-off-screen-element), [`UB-HEALTH-SPARSE-CONTENT`](#ub-health-sparse-content), [`UB-HEALTH-ZERO-SIZE-ELEMENT`](#ub-health-zero-size-element), [`UB-PARSE-ERROR`](#ub-parse-error), [`UB-STATE-NOT-REACHED`](#ub-state-not-reached), [`UB-UNEXPECTED-STATE`](#ub-unexpected-state), [`UB-UNKNOWN-ERROR`](#ub-unknown-error), [`UB-VALIDATION-ERROR`](#ub-validation-error), [`UB-VLM-STRUCTURED-PARSE-FAIL`](#ub-vlm-structured-parse-fail)

## UB-HEALTH-LOW-ELEMENT-DIVERSITY

**Category:** `system`

Page health: all visible elements are navigation-type, suggesting the content body is missing.

### Common causes

- Only chrome/navigation rendered; the body did not
- Content failed to load behind the navigation shell

### Default recovery template

- **Reload the page and re-run the health check** — command: `refresh page`, confidence: 0.5, retryable: yes, priority: 1

### See also

[`UB-HEALTH-EMPTY-CONTENT-AREA`](#ub-health-empty-content-area), [`UB-HEALTH-EMPTY-TEXT-SIGNAL`](#ub-health-empty-text-signal), [`UB-HEALTH-ERROR-TEXT-SIGNAL`](#ub-health-error-text-signal), [`UB-HEALTH-LOADING-CLASS-SIGNAL`](#ub-health-loading-class-signal), [`UB-HEALTH-LOADING-TEXT-SIGNAL`](#ub-health-loading-text-signal), [`UB-HEALTH-LOW-SPATIAL-COVERAGE`](#ub-health-low-spatial-coverage), [`UB-HEALTH-MANY-DISABLED-INTERACTIVE`](#ub-health-many-disabled-interactive), [`UB-HEALTH-NO-CONTENT-ELEMENTS`](#ub-health-no-content-elements), [`UB-HEALTH-OFF-SCREEN-ELEMENT`](#ub-health-off-screen-element), [`UB-HEALTH-SPARSE-CONTENT`](#ub-health-sparse-content), [`UB-HEALTH-ZERO-SIZE-ELEMENT`](#ub-health-zero-size-element), [`UB-PARSE-ERROR`](#ub-parse-error), [`UB-STATE-NOT-REACHED`](#ub-state-not-reached), [`UB-UNEXPECTED-STATE`](#ub-unexpected-state), [`UB-UNKNOWN-ERROR`](#ub-unknown-error), [`UB-VALIDATION-ERROR`](#ub-validation-error), [`UB-VLM-STRUCTURED-PARSE-FAIL`](#ub-vlm-structured-parse-fail)

## UB-HEALTH-LOW-SPATIAL-COVERAGE

**Category:** `system`

Page health: rendered elements occupy a critically/abnormally small fraction of the viewport.

### Common causes

- The page is still loading content
- A render error left most of the page blank
- The main content failed to mount

### Default recovery template

- **Wait for the page to finish loading and re-run the health check** — command: `wait for page to load`, confidence: 0.6, retryable: yes, priority: 1

### See also

[`UB-HEALTH-EMPTY-CONTENT-AREA`](#ub-health-empty-content-area), [`UB-HEALTH-EMPTY-TEXT-SIGNAL`](#ub-health-empty-text-signal), [`UB-HEALTH-ERROR-TEXT-SIGNAL`](#ub-health-error-text-signal), [`UB-HEALTH-LOADING-CLASS-SIGNAL`](#ub-health-loading-class-signal), [`UB-HEALTH-LOADING-TEXT-SIGNAL`](#ub-health-loading-text-signal), [`UB-HEALTH-LOW-ELEMENT-DIVERSITY`](#ub-health-low-element-diversity), [`UB-HEALTH-MANY-DISABLED-INTERACTIVE`](#ub-health-many-disabled-interactive), [`UB-HEALTH-NO-CONTENT-ELEMENTS`](#ub-health-no-content-elements), [`UB-HEALTH-OFF-SCREEN-ELEMENT`](#ub-health-off-screen-element), [`UB-HEALTH-SPARSE-CONTENT`](#ub-health-sparse-content), [`UB-HEALTH-ZERO-SIZE-ELEMENT`](#ub-health-zero-size-element), [`UB-PARSE-ERROR`](#ub-parse-error), [`UB-STATE-NOT-REACHED`](#ub-state-not-reached), [`UB-UNEXPECTED-STATE`](#ub-unexpected-state), [`UB-UNKNOWN-ERROR`](#ub-unknown-error), [`UB-VALIDATION-ERROR`](#ub-validation-error), [`UB-VLM-STRUCTURED-PARSE-FAIL`](#ub-vlm-structured-parse-fail)

## UB-HEALTH-MANY-DISABLED-INTERACTIVE

**Category:** `system`

Page health: over half of interactive elements are disabled.

### Common causes

- The page is gated behind an unmet precondition
- A loading state disabled most controls
- The user lacks permission for most actions

### Default recovery template

- **Satisfy the precondition that enables the controls, then re-run the health check** — confidence: 0.4, retryable: no, priority: 1

### See also

[`UB-HEALTH-EMPTY-CONTENT-AREA`](#ub-health-empty-content-area), [`UB-HEALTH-EMPTY-TEXT-SIGNAL`](#ub-health-empty-text-signal), [`UB-HEALTH-ERROR-TEXT-SIGNAL`](#ub-health-error-text-signal), [`UB-HEALTH-LOADING-CLASS-SIGNAL`](#ub-health-loading-class-signal), [`UB-HEALTH-LOADING-TEXT-SIGNAL`](#ub-health-loading-text-signal), [`UB-HEALTH-LOW-ELEMENT-DIVERSITY`](#ub-health-low-element-diversity), [`UB-HEALTH-LOW-SPATIAL-COVERAGE`](#ub-health-low-spatial-coverage), [`UB-HEALTH-NO-CONTENT-ELEMENTS`](#ub-health-no-content-elements), [`UB-HEALTH-OFF-SCREEN-ELEMENT`](#ub-health-off-screen-element), [`UB-HEALTH-SPARSE-CONTENT`](#ub-health-sparse-content), [`UB-HEALTH-ZERO-SIZE-ELEMENT`](#ub-health-zero-size-element), [`UB-PARSE-ERROR`](#ub-parse-error), [`UB-STATE-NOT-REACHED`](#ub-state-not-reached), [`UB-UNEXPECTED-STATE`](#ub-unexpected-state), [`UB-UNKNOWN-ERROR`](#ub-unknown-error), [`UB-VALIDATION-ERROR`](#ub-validation-error), [`UB-VLM-STRUCTURED-PARSE-FAIL`](#ub-vlm-structured-parse-fail)

## UB-HEALTH-NO-CONTENT-ELEMENTS

**Category:** `system`

Page health: no elements were found in the content region.

### Common causes

- The content view did not mount
- An exception prevented content rendering
- The page is stuck before content load

### Default recovery template

- **Reload the page and re-run the health check** — command: `refresh page`, confidence: 0.6, retryable: yes, priority: 1

### See also

[`UB-HEALTH-EMPTY-CONTENT-AREA`](#ub-health-empty-content-area), [`UB-HEALTH-EMPTY-TEXT-SIGNAL`](#ub-health-empty-text-signal), [`UB-HEALTH-ERROR-TEXT-SIGNAL`](#ub-health-error-text-signal), [`UB-HEALTH-LOADING-CLASS-SIGNAL`](#ub-health-loading-class-signal), [`UB-HEALTH-LOADING-TEXT-SIGNAL`](#ub-health-loading-text-signal), [`UB-HEALTH-LOW-ELEMENT-DIVERSITY`](#ub-health-low-element-diversity), [`UB-HEALTH-LOW-SPATIAL-COVERAGE`](#ub-health-low-spatial-coverage), [`UB-HEALTH-MANY-DISABLED-INTERACTIVE`](#ub-health-many-disabled-interactive), [`UB-HEALTH-OFF-SCREEN-ELEMENT`](#ub-health-off-screen-element), [`UB-HEALTH-SPARSE-CONTENT`](#ub-health-sparse-content), [`UB-HEALTH-ZERO-SIZE-ELEMENT`](#ub-health-zero-size-element), [`UB-PARSE-ERROR`](#ub-parse-error), [`UB-STATE-NOT-REACHED`](#ub-state-not-reached), [`UB-UNEXPECTED-STATE`](#ub-unexpected-state), [`UB-UNKNOWN-ERROR`](#ub-unknown-error), [`UB-VALIDATION-ERROR`](#ub-validation-error), [`UB-VLM-STRUCTURED-PARSE-FAIL`](#ub-vlm-structured-parse-fail)

## UB-HEALTH-OFF-SCREEN-ELEMENT

**Category:** `system`

Page health: a visible element is positioned entirely off-screen.

### Common causes

- A negative-offset or transform pushed the element out of view
- A layout bug positioned the element outside the viewport

### Default recovery template

- **Inspect the element's positioning/CSS; this typically indicates a layout defect** — confidence: 0.3, retryable: no, priority: 1

### See also

[`UB-HEALTH-EMPTY-CONTENT-AREA`](#ub-health-empty-content-area), [`UB-HEALTH-EMPTY-TEXT-SIGNAL`](#ub-health-empty-text-signal), [`UB-HEALTH-ERROR-TEXT-SIGNAL`](#ub-health-error-text-signal), [`UB-HEALTH-LOADING-CLASS-SIGNAL`](#ub-health-loading-class-signal), [`UB-HEALTH-LOADING-TEXT-SIGNAL`](#ub-health-loading-text-signal), [`UB-HEALTH-LOW-ELEMENT-DIVERSITY`](#ub-health-low-element-diversity), [`UB-HEALTH-LOW-SPATIAL-COVERAGE`](#ub-health-low-spatial-coverage), [`UB-HEALTH-MANY-DISABLED-INTERACTIVE`](#ub-health-many-disabled-interactive), [`UB-HEALTH-NO-CONTENT-ELEMENTS`](#ub-health-no-content-elements), [`UB-HEALTH-SPARSE-CONTENT`](#ub-health-sparse-content), [`UB-HEALTH-ZERO-SIZE-ELEMENT`](#ub-health-zero-size-element), [`UB-PARSE-ERROR`](#ub-parse-error), [`UB-STATE-NOT-REACHED`](#ub-state-not-reached), [`UB-UNEXPECTED-STATE`](#ub-unexpected-state), [`UB-UNKNOWN-ERROR`](#ub-unknown-error), [`UB-VALIDATION-ERROR`](#ub-validation-error), [`UB-VLM-STRUCTURED-PARSE-FAIL`](#ub-vlm-structured-parse-fail)

## UB-HEALTH-SPARSE-CONTENT

**Category:** `system`

Page health: the content region has very few elements.

### Common causes

- Content is only partially rendered
- A list/grid returned few or no items
- The page is mid-load

### Default recovery template

- **Wait for content to finish loading and re-run the health check** — command: `wait for loading`, confidence: 0.5, retryable: yes, priority: 1

### See also

[`UB-HEALTH-EMPTY-CONTENT-AREA`](#ub-health-empty-content-area), [`UB-HEALTH-EMPTY-TEXT-SIGNAL`](#ub-health-empty-text-signal), [`UB-HEALTH-ERROR-TEXT-SIGNAL`](#ub-health-error-text-signal), [`UB-HEALTH-LOADING-CLASS-SIGNAL`](#ub-health-loading-class-signal), [`UB-HEALTH-LOADING-TEXT-SIGNAL`](#ub-health-loading-text-signal), [`UB-HEALTH-LOW-ELEMENT-DIVERSITY`](#ub-health-low-element-diversity), [`UB-HEALTH-LOW-SPATIAL-COVERAGE`](#ub-health-low-spatial-coverage), [`UB-HEALTH-MANY-DISABLED-INTERACTIVE`](#ub-health-many-disabled-interactive), [`UB-HEALTH-NO-CONTENT-ELEMENTS`](#ub-health-no-content-elements), [`UB-HEALTH-OFF-SCREEN-ELEMENT`](#ub-health-off-screen-element), [`UB-HEALTH-ZERO-SIZE-ELEMENT`](#ub-health-zero-size-element), [`UB-PARSE-ERROR`](#ub-parse-error), [`UB-STATE-NOT-REACHED`](#ub-state-not-reached), [`UB-UNEXPECTED-STATE`](#ub-unexpected-state), [`UB-UNKNOWN-ERROR`](#ub-unknown-error), [`UB-VALIDATION-ERROR`](#ub-validation-error), [`UB-VLM-STRUCTURED-PARSE-FAIL`](#ub-vlm-structured-parse-fail)

## UB-HEALTH-ZERO-SIZE-ELEMENT

**Category:** `system`

Page health: a visible element has zero width or height.

### Common causes

- A CSS layout bug collapsed the element
- Missing content gave the element no intrinsic size
- A fl/grid sizing rule produced a zero box

### Default recovery template

- **Inspect the element's layout/CSS; this typically indicates a rendering defect** — confidence: 0.3, retryable: no, priority: 1

### See also

[`UB-HEALTH-EMPTY-CONTENT-AREA`](#ub-health-empty-content-area), [`UB-HEALTH-EMPTY-TEXT-SIGNAL`](#ub-health-empty-text-signal), [`UB-HEALTH-ERROR-TEXT-SIGNAL`](#ub-health-error-text-signal), [`UB-HEALTH-LOADING-CLASS-SIGNAL`](#ub-health-loading-class-signal), [`UB-HEALTH-LOADING-TEXT-SIGNAL`](#ub-health-loading-text-signal), [`UB-HEALTH-LOW-ELEMENT-DIVERSITY`](#ub-health-low-element-diversity), [`UB-HEALTH-LOW-SPATIAL-COVERAGE`](#ub-health-low-spatial-coverage), [`UB-HEALTH-MANY-DISABLED-INTERACTIVE`](#ub-health-many-disabled-interactive), [`UB-HEALTH-NO-CONTENT-ELEMENTS`](#ub-health-no-content-elements), [`UB-HEALTH-OFF-SCREEN-ELEMENT`](#ub-health-off-screen-element), [`UB-HEALTH-SPARSE-CONTENT`](#ub-health-sparse-content), [`UB-PARSE-ERROR`](#ub-parse-error), [`UB-STATE-NOT-REACHED`](#ub-state-not-reached), [`UB-UNEXPECTED-STATE`](#ub-unexpected-state), [`UB-UNKNOWN-ERROR`](#ub-unknown-error), [`UB-VALIDATION-ERROR`](#ub-validation-error), [`UB-VLM-STRUCTURED-PARSE-FAIL`](#ub-vlm-structured-parse-fail)

## UB-LOW-CONFIDENCE

**Category:** `element`

The best matching element has confidence below the acceptance threshold.

### Common causes

- The description does not closely match any element's text
- The confidence threshold is set higher than the actual best match
- The element label differs from the human-expected wording

### Default recovery template

- **Use the exact text shown on the element** — confidence: 0.9, retryable: no, priority: 1
- **Try a different description that more closely matches the element** — confidence: 0.8, retryable: no, priority: 2
- **Lower the confidence threshold if the match is correct** — confidence: 0.7, retryable: yes, priority: 3

### See also

[`UB-AMBIGUOUS-MATCH`](#ub-ambiguous-match), [`UB-ELEM-BLOCKED`](#ub-elem-blocked), [`UB-ELEM-DISABLED`](#ub-elem-disabled), [`UB-ELEM-NOT-ENABLED`](#ub-elem-not-enabled), [`UB-ELEM-NOT-FOUND`](#ub-elem-not-found), [`UB-ELEM-NOT-INTERACTABLE`](#ub-elem-not-interactable), [`UB-ELEM-NOT-VISIBLE`](#ub-elem-not-visible), [`UB-MULTIPLE-ELEMENTS`](#ub-multiple-elements), [`UB-STALE-ELEMENT`](#ub-stale-element)

## UB-MULTIPLE-ELEMENTS

**Category:** `element`

Multiple elements match the description; the target is ambiguous.

### Common causes

- The description is too generic
- Repeated list/grid items share the same label
- Several controls have identical accessible names

### Default recovery template

- **Use a more specific description** — confidence: 0.9, retryable: no, priority: 1
- **Include the element position (first, second, etc.)** — confidence: 0.8, retryable: no, priority: 2
- **Use the element ID directly** — confidence: 0.7, retryable: no, priority: 3

### See also

[`UB-AMBIGUOUS-MATCH`](#ub-ambiguous-match), [`UB-ELEM-BLOCKED`](#ub-elem-blocked), [`UB-ELEM-DISABLED`](#ub-elem-disabled), [`UB-ELEM-NOT-ENABLED`](#ub-elem-not-enabled), [`UB-ELEM-NOT-FOUND`](#ub-elem-not-found), [`UB-ELEM-NOT-INTERACTABLE`](#ub-elem-not-interactable), [`UB-ELEM-NOT-VISIBLE`](#ub-elem-not-visible), [`UB-LOW-CONFIDENCE`](#ub-low-confidence), [`UB-STALE-ELEMENT`](#ub-stale-element)

## UB-NAVIGATION-ERROR

**Category:** `network`

Navigation to the target page failed.

### Common causes

- The target URL is incorrect or unreachable
- A navigation guard blocked the route
- The route does not exist

### Default recovery template

- **Try the navigation again** — confidence: 0.7, retryable: yes, priority: 1
- **Check if the URL is correct** — confidence: 0.6, retryable: no, priority: 2

### See also

[`UB-NET-ERROR`](#ub-net-error), [`UB-PAGE-LOAD-ERROR`](#ub-page-load-error)

## UB-NET-ERROR

**Category:** `network`

A network error occurred while performing the action or loading data.

### Common causes

- The backing request failed or timed out
- Connectivity was lost
- A CORS or proxy error blocked the request

### Default recovery template

- **Retry the action once connectivity is restored** — confidence: 0.6, retryable: yes, priority: 1
- **Check network connectivity** — confidence: 0.5, retryable: no, priority: 2

### See also

[`UB-NAVIGATION-ERROR`](#ub-navigation-error), [`UB-PAGE-LOAD-ERROR`](#ub-page-load-error)

## UB-PAGE-LOAD-ERROR

**Category:** `network`

The page failed to load correctly.

### Common causes

- A critical resource failed to load
- The server returned an error response
- Network connectivity was interrupted during load

### Default recovery template

- **Refresh the page** — command: `refresh page`, confidence: 0.8, retryable: yes, priority: 1
- **Check network connectivity** — confidence: 0.6, retryable: no, priority: 2

### See also

[`UB-NAVIGATION-ERROR`](#ub-navigation-error), [`UB-NET-ERROR`](#ub-net-error)

## UB-PARSE-ERROR

**Category:** `system`

Could not parse the natural language instruction.

### Common causes

- The instruction is too complex or ambiguous to parse
- The instruction does not reference a recognizable action
- The instruction format is unsupported

### Default recovery template

- **Use a simpler instruction format like "click Submit button"** — confidence: 0.8, retryable: no, priority: 1
- **Use specific element names visible on the page** — confidence: 0.7, retryable: no, priority: 2

### See also

[`UB-HEALTH-EMPTY-CONTENT-AREA`](#ub-health-empty-content-area), [`UB-HEALTH-EMPTY-TEXT-SIGNAL`](#ub-health-empty-text-signal), [`UB-HEALTH-ERROR-TEXT-SIGNAL`](#ub-health-error-text-signal), [`UB-HEALTH-LOADING-CLASS-SIGNAL`](#ub-health-loading-class-signal), [`UB-HEALTH-LOADING-TEXT-SIGNAL`](#ub-health-loading-text-signal), [`UB-HEALTH-LOW-ELEMENT-DIVERSITY`](#ub-health-low-element-diversity), [`UB-HEALTH-LOW-SPATIAL-COVERAGE`](#ub-health-low-spatial-coverage), [`UB-HEALTH-MANY-DISABLED-INTERACTIVE`](#ub-health-many-disabled-interactive), [`UB-HEALTH-NO-CONTENT-ELEMENTS`](#ub-health-no-content-elements), [`UB-HEALTH-OFF-SCREEN-ELEMENT`](#ub-health-off-screen-element), [`UB-HEALTH-SPARSE-CONTENT`](#ub-health-sparse-content), [`UB-HEALTH-ZERO-SIZE-ELEMENT`](#ub-health-zero-size-element), [`UB-STATE-NOT-REACHED`](#ub-state-not-reached), [`UB-UNEXPECTED-STATE`](#ub-unexpected-state), [`UB-UNKNOWN-ERROR`](#ub-unknown-error), [`UB-VALIDATION-ERROR`](#ub-validation-error), [`UB-VLM-STRUCTURED-PARSE-FAIL`](#ub-vlm-structured-parse-fail)

## UB-STALE-ELEMENT

**Category:** `element`

The element reference is no longer attached to the DOM.

### Common causes

- The component unmounted between discovery and action
- A re-render replaced the element node
- The element was detached by a parent update

### Default recovery template

- **Re-find '${elementId}'** — confidence: 0.9, retryable: yes, priority: 1
- **Wait for page to stabilize** — command: `wait 1 second`, confidence: 0.7, retryable: yes, priority: 2

### See also

[`UB-AMBIGUOUS-MATCH`](#ub-ambiguous-match), [`UB-ELEM-BLOCKED`](#ub-elem-blocked), [`UB-ELEM-DISABLED`](#ub-elem-disabled), [`UB-ELEM-NOT-ENABLED`](#ub-elem-not-enabled), [`UB-ELEM-NOT-FOUND`](#ub-elem-not-found), [`UB-ELEM-NOT-INTERACTABLE`](#ub-elem-not-interactable), [`UB-ELEM-NOT-VISIBLE`](#ub-elem-not-visible), [`UB-LOW-CONFIDENCE`](#ub-low-confidence), [`UB-MULTIPLE-ELEMENTS`](#ub-multiple-elements)

## UB-STATE-NOT-REACHED

**Category:** `system`

The expected post-action state was not reached.

### Common causes

- The action did not produce the expected state transition
- An async side-effect has not completed yet
- The expected state assertion is incorrect

### Default recovery template

- **Wait for state to stabilize and re-check** — command: `wait 2 seconds`, confidence: 0.6, retryable: yes, priority: 1
- **Verify the expected state condition is correct** — confidence: 0.5, retryable: no, priority: 2

### See also

[`UB-HEALTH-EMPTY-CONTENT-AREA`](#ub-health-empty-content-area), [`UB-HEALTH-EMPTY-TEXT-SIGNAL`](#ub-health-empty-text-signal), [`UB-HEALTH-ERROR-TEXT-SIGNAL`](#ub-health-error-text-signal), [`UB-HEALTH-LOADING-CLASS-SIGNAL`](#ub-health-loading-class-signal), [`UB-HEALTH-LOADING-TEXT-SIGNAL`](#ub-health-loading-text-signal), [`UB-HEALTH-LOW-ELEMENT-DIVERSITY`](#ub-health-low-element-diversity), [`UB-HEALTH-LOW-SPATIAL-COVERAGE`](#ub-health-low-spatial-coverage), [`UB-HEALTH-MANY-DISABLED-INTERACTIVE`](#ub-health-many-disabled-interactive), [`UB-HEALTH-NO-CONTENT-ELEMENTS`](#ub-health-no-content-elements), [`UB-HEALTH-OFF-SCREEN-ELEMENT`](#ub-health-off-screen-element), [`UB-HEALTH-SPARSE-CONTENT`](#ub-health-sparse-content), [`UB-HEALTH-ZERO-SIZE-ELEMENT`](#ub-health-zero-size-element), [`UB-PARSE-ERROR`](#ub-parse-error), [`UB-UNEXPECTED-STATE`](#ub-unexpected-state), [`UB-UNKNOWN-ERROR`](#ub-unknown-error), [`UB-VALIDATION-ERROR`](#ub-validation-error), [`UB-VLM-STRUCTURED-PARSE-FAIL`](#ub-vlm-structured-parse-fail)

## UB-UNEXPECTED-STATE

**Category:** `system`

The element or page is in an unexpected state.

### Common causes

- The page state drifted from what the workflow assumed
- A concurrent update changed the state
- Stale state was used for the decision

### Default recovery template

- **Refresh the page state** — command: `refresh`, confidence: 0.7, retryable: yes, priority: 1
- **Wait for state to stabilize** — command: `wait 2 seconds`, confidence: 0.6, retryable: yes, priority: 2

### See also

[`UB-HEALTH-EMPTY-CONTENT-AREA`](#ub-health-empty-content-area), [`UB-HEALTH-EMPTY-TEXT-SIGNAL`](#ub-health-empty-text-signal), [`UB-HEALTH-ERROR-TEXT-SIGNAL`](#ub-health-error-text-signal), [`UB-HEALTH-LOADING-CLASS-SIGNAL`](#ub-health-loading-class-signal), [`UB-HEALTH-LOADING-TEXT-SIGNAL`](#ub-health-loading-text-signal), [`UB-HEALTH-LOW-ELEMENT-DIVERSITY`](#ub-health-low-element-diversity), [`UB-HEALTH-LOW-SPATIAL-COVERAGE`](#ub-health-low-spatial-coverage), [`UB-HEALTH-MANY-DISABLED-INTERACTIVE`](#ub-health-many-disabled-interactive), [`UB-HEALTH-NO-CONTENT-ELEMENTS`](#ub-health-no-content-elements), [`UB-HEALTH-OFF-SCREEN-ELEMENT`](#ub-health-off-screen-element), [`UB-HEALTH-SPARSE-CONTENT`](#ub-health-sparse-content), [`UB-HEALTH-ZERO-SIZE-ELEMENT`](#ub-health-zero-size-element), [`UB-PARSE-ERROR`](#ub-parse-error), [`UB-STATE-NOT-REACHED`](#ub-state-not-reached), [`UB-UNKNOWN-ERROR`](#ub-unknown-error), [`UB-VALIDATION-ERROR`](#ub-validation-error), [`UB-VLM-STRUCTURED-PARSE-FAIL`](#ub-vlm-structured-parse-fail)

## UB-UNKNOWN-ERROR

**Category:** `system`

An unknown or uncategorized error occurred.

### Common causes

- An unexpected runtime exception with no specific code
- An error path that has not yet been mapped to a stable code

### Default recovery template

- **Try a different approach or check the page state** — confidence: 0.5, retryable: no, priority: 1

### See also

[`UB-HEALTH-EMPTY-CONTENT-AREA`](#ub-health-empty-content-area), [`UB-HEALTH-EMPTY-TEXT-SIGNAL`](#ub-health-empty-text-signal), [`UB-HEALTH-ERROR-TEXT-SIGNAL`](#ub-health-error-text-signal), [`UB-HEALTH-LOADING-CLASS-SIGNAL`](#ub-health-loading-class-signal), [`UB-HEALTH-LOADING-TEXT-SIGNAL`](#ub-health-loading-text-signal), [`UB-HEALTH-LOW-ELEMENT-DIVERSITY`](#ub-health-low-element-diversity), [`UB-HEALTH-LOW-SPATIAL-COVERAGE`](#ub-health-low-spatial-coverage), [`UB-HEALTH-MANY-DISABLED-INTERACTIVE`](#ub-health-many-disabled-interactive), [`UB-HEALTH-NO-CONTENT-ELEMENTS`](#ub-health-no-content-elements), [`UB-HEALTH-OFF-SCREEN-ELEMENT`](#ub-health-off-screen-element), [`UB-HEALTH-SPARSE-CONTENT`](#ub-health-sparse-content), [`UB-HEALTH-ZERO-SIZE-ELEMENT`](#ub-health-zero-size-element), [`UB-PARSE-ERROR`](#ub-parse-error), [`UB-STATE-NOT-REACHED`](#ub-state-not-reached), [`UB-UNEXPECTED-STATE`](#ub-unexpected-state), [`UB-VALIDATION-ERROR`](#ub-validation-error), [`UB-VLM-STRUCTURED-PARSE-FAIL`](#ub-vlm-structured-parse-fail)

## UB-UNSUPPORTED-ACTION

**Category:** `action`

The requested action type is not supported for this element or surface.

### Common causes

- The action verb is not implemented for the element type
- A composite action needs to be broken into primitives

### Default recovery template

- **Use a different action type** — confidence: 0.9, retryable: no, priority: 1
- **Break down into simpler actions** — confidence: 0.7, retryable: no, priority: 2

### See also

[`UB-ACTION-FAILED`](#ub-action-failed), [`UB-ACTION-REJECTED`](#ub-action-rejected), [`UB-ACTION-TIMEOUT`](#ub-action-timeout)

## UB-VALIDATION-ERROR

**Category:** `system`

The parsed action failed validation.

### Common causes

- Required parameters for the action are missing
- A parameter value is out of range or the wrong type
- The instruction format is invalid

### Default recovery template

- **Provide required parameters for the action** — confidence: 0.9, retryable: no, priority: 1
- **Check the instruction format** — confidence: 0.7, retryable: no, priority: 2

### See also

[`UB-HEALTH-EMPTY-CONTENT-AREA`](#ub-health-empty-content-area), [`UB-HEALTH-EMPTY-TEXT-SIGNAL`](#ub-health-empty-text-signal), [`UB-HEALTH-ERROR-TEXT-SIGNAL`](#ub-health-error-text-signal), [`UB-HEALTH-LOADING-CLASS-SIGNAL`](#ub-health-loading-class-signal), [`UB-HEALTH-LOADING-TEXT-SIGNAL`](#ub-health-loading-text-signal), [`UB-HEALTH-LOW-ELEMENT-DIVERSITY`](#ub-health-low-element-diversity), [`UB-HEALTH-LOW-SPATIAL-COVERAGE`](#ub-health-low-spatial-coverage), [`UB-HEALTH-MANY-DISABLED-INTERACTIVE`](#ub-health-many-disabled-interactive), [`UB-HEALTH-NO-CONTENT-ELEMENTS`](#ub-health-no-content-elements), [`UB-HEALTH-OFF-SCREEN-ELEMENT`](#ub-health-off-screen-element), [`UB-HEALTH-SPARSE-CONTENT`](#ub-health-sparse-content), [`UB-HEALTH-ZERO-SIZE-ELEMENT`](#ub-health-zero-size-element), [`UB-PARSE-ERROR`](#ub-parse-error), [`UB-STATE-NOT-REACHED`](#ub-state-not-reached), [`UB-UNEXPECTED-STATE`](#ub-unexpected-state), [`UB-UNKNOWN-ERROR`](#ub-unknown-error), [`UB-VLM-STRUCTURED-PARSE-FAIL`](#ub-vlm-structured-parse-fail)

## UB-VLM-STRUCTURED-PARSE-FAIL

**Category:** `system`

The VLM Describe response could not be parsed into the closed structured schema; the prose-only response was returned with structured=null.

### Common causes

- The model returned malformed or non-JSON output in JSON mode
- The structured payload did not validate against the schema
- Model-specific JSON-mode unreliability

### Default recovery template

- **Fall back to the prose description; retry the describe call once** — confidence: 0.4, retryable: yes, priority: 1

### See also

[`UB-HEALTH-EMPTY-CONTENT-AREA`](#ub-health-empty-content-area), [`UB-HEALTH-EMPTY-TEXT-SIGNAL`](#ub-health-empty-text-signal), [`UB-HEALTH-ERROR-TEXT-SIGNAL`](#ub-health-error-text-signal), [`UB-HEALTH-LOADING-CLASS-SIGNAL`](#ub-health-loading-class-signal), [`UB-HEALTH-LOADING-TEXT-SIGNAL`](#ub-health-loading-text-signal), [`UB-HEALTH-LOW-ELEMENT-DIVERSITY`](#ub-health-low-element-diversity), [`UB-HEALTH-LOW-SPATIAL-COVERAGE`](#ub-health-low-spatial-coverage), [`UB-HEALTH-MANY-DISABLED-INTERACTIVE`](#ub-health-many-disabled-interactive), [`UB-HEALTH-NO-CONTENT-ELEMENTS`](#ub-health-no-content-elements), [`UB-HEALTH-OFF-SCREEN-ELEMENT`](#ub-health-off-screen-element), [`UB-HEALTH-SPARSE-CONTENT`](#ub-health-sparse-content), [`UB-HEALTH-ZERO-SIZE-ELEMENT`](#ub-health-zero-size-element), [`UB-PARSE-ERROR`](#ub-parse-error), [`UB-STATE-NOT-REACHED`](#ub-state-not-reached), [`UB-UNEXPECTED-STATE`](#ub-unexpected-state), [`UB-UNKNOWN-ERROR`](#ub-unknown-error), [`UB-VALIDATION-ERROR`](#ub-validation-error)
