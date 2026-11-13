# Design Token Inference & Drift

Two endpoints derive design tokens from what an app actually renders, rather than checking it against tokens someone wrote down:

| Route                            | Handler            | What it answers                                                                                            |
| -------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------- |
| `POST /design/style-guide/infer` | `inferStyleGuide`  | A draft style guide and a ranked token inventory, from the computed styles of the page                     |
| `POST /design/tokens/drift`      | `diffDesignTokens` | Which values in use have no declared token (with the nearest one), which tokens nothing uses, per category |

Paths are relative to the UI Bridge base path your server mounts. Both are served by the direct server handlers and the browser relay with one model (`specs/style-inference-request.ts`), and by `@qontinui/ui-bridge-native` (see [React Native](#react-native)). They sit beside `POST /design/audit` and `POST /design/style-guide/load`: infer produces a guide, load installs it, drift measures against it.

Everything is deterministic — the same page yields the same answer. No model is called and no name is guessed.

## What is collected

For each sampled element, from its computed styles:

| Category         | Read from                                                      | Canonical form                                                                                                              |
| ---------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `colors`         | `color`, `backgroundColor`, border, outline and shadow colours | `#rrggbb`, or `#rrggbbaa` below full opacity                                                                                |
| `fontFamilies`   | `fontFamily`                                                   | the stack, lowercased, unquoted                                                                                             |
| `fontSizes`      | `fontSize`                                                     | px                                                                                                                          |
| `fontWeights`    | `fontWeight`                                                   | number (`normal` → 400, `bold` → 700)                                                                                       |
| `lineHeights`    | `lineHeight`                                                   | unitless ratio to the font size (`24px` at `16px` → `1.5`), with the px values seen                                         |
| `letterSpacings` | `letterSpacing`                                                | `em` relative to the font size, with the px values seen                                                                     |
| `spacing`        | margin and padding per side, `gap`                             | px (`%` kept)                                                                                                               |
| `borderRadius`   | each corner of `borderRadius`                                  | px (`%` kept)                                                                                                               |
| `shadows`        | `boxShadow`                                                    | each layer as `[inset] x y blur spread colour`, so Chrome's colour-first serialization equals an author's colour-last token |
| `borders`        | the `border` shorthand                                         | `1px solid #e5e7eb` (inventory only: a style guide has no border tokens)                                                    |

Colours are parsed from hex, `rgb()`, `hsl()`, `lab()`, `lch()`, `oklch()`, `oklab()`, `color(srgb …)` and CSS names. A colour outside the sRGB gamut is clamped and its entry carries `outOfGamut: true`. A value no canonical form fits is kept verbatim with `normalized: false` — never dropped.

**Defaults are excluded and counted** in `excludedDefaults`: transparent colours, zero spacing and radii, `normal` line height and letter spacing, `none` shadows, invisible borders and invisible shadow layers — a transparent colour, or offsets, blur and spread all zero (Tailwind's `0 0 0 0px #fff` ring offset). They would top every ranking and say nothing about the design.

Shadow comments are stripped, and a unitless number in a shadow is a length only when it is `0`. Every `rem` — in lengths, shadows and borders — resolves against the capture's `rootFontSizePx`. A style value that is not a string (React Native's numeric `fontWeight`, a `PlatformColor` object passed straight through) is skipped and counted in `unnormalized` for its category instead of failing the request.

Limits worth knowing, also reported in `capture.notes`: a border that differs per side computes to an empty shorthand and is not counted, and without CSS Typed OM (Chrome has it) an `auto` margin reads as its used px value.

## `POST /design/style-guide/infer`

```json
{
  "scope": "registered",
  "elementIds": ["save", "title"],
  "maxElements": 2000,
  "maxPerCategory": 24,
  "limits": { "colors": 40 },
  "name": "acme-draft",
  "rootFontSizePx": 16
}
```

Every field is optional. `scope` is `registered` (the SDK's registered elements, the default) or `document` (every element under `document.body`); `elementIds` applies to `registered` only.

The response `data`:

- `status` — `ok`, or `empty` with a `reason` when nothing was sampled or nothing carried a non-default value. An empty capture never produces a guide (`guide: null`), so it cannot be loaded and audited as "clean".
- `guide` — a `StyleGuideConfig`: `tokens` holds every `DesignTokens` key (`breakpoints` is `{}` — one viewport cannot reveal them), `rules` is `[]`.
- `inventory` — per category, the kept entries `{ name, value, occurrences, elementCount, properties, matchingCustomProperties, normalized, px? }`.
- `truncation` — per category `{ distinct, kept, dropped, droppedOccurrences }`, present for every category (`dropped: 0` included).
- `excludedDefaults`, `unnormalized`, `notInGuide` (`["borders"]`), `notInferable` (`["breakpoints"]`).
- `capture` — `{ scope, elementsAvailable, elementsSampled, elementsSkipped, elementCapReached, customPropertiesSeen, rootFontSizePx, notes }`.

### Naming and ranking

Entries are ranked by the number of elements carrying the value, then by occurrences, then by the value itself, and named by that rank: `color-1`, `font-size-2`, `space-3`, `radius-1`, `shadow-1`. A name says how common a value is, never what it means — rename them when you adopt the guide.

`matchingCustomProperties` lists the custom properties (from the sampled elements and `:root`) whose resolved value canonicalises to the entry's value. That is a value match: computed styles cannot show whether an element used `var()`.

### Loading the draft

The guide loads unchanged through `POST /design/style-guide/load` (`{ "guide": … }`). It holds **tokens only**: with no rules, `/design/audit` has nothing to check and reports no results. Write rules that reference the tokens (`{ "type": "tokenRef", "property": "color", "tokenPath": "colors.color-1" }`) before auditing. The validator compares canonical forms, so a hex token matches Chrome's `rgb(…)`, and a unitless line-height token matches the computed px at that font size. Colours use the same rule as drift (below), and `rem` resolves against the page's root font size: `/design/audit` measures it from `document.documentElement`, or takes `rootFontSizePx` in its body (`StyleValidationOptions` for `runStyleAudit` / `validateElement` / `evaluateConstraint`), so an audit and a drift report over one page agree.

## `POST /design/tokens/drift`

Give **exactly one** declared token source:

| Field                      | Meaning                                                                                                                                                                                                              |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tokens`                   | a `DesignTokens`-shaped object (any subset of its groups)                                                                                                                                                            |
| `customProperties`         | a flat `{ "--name": "value" }` map, e.g. read from a token package's CSS. `var()` is substituted from the map itself and a one-operator `calc()` is evaluated (`calc(14 * var(--unit))` with `--unit: 1px` → `14px`) |
| `pageCustomPropertyPrefix` | read the page's own `:root` custom properties whose name starts with the prefix (`@layer` and matching `@media` blocks included)                                                                                     |
| _(none)_                   | the loaded style guide's `tokens`; with none loaded, `UB-VALIDATION-ERROR`                                                                                                                                           |

Flat maps are classified by value shape: colours, absolute lengths, `em` (letter spacing), integers 100–1000 (font weights), numbers below 10 (line-height ratios), layered lengths (shadows) and font stacks. An absolute length is placed by its name when the name says which length category it is for (`lengthCategoryOfName`: a `space`/`spacing`/`gap`/`gutter` segment → spacing, `radius`/`rounded` → radii, `font-size`/`text`/`fs` → font sizes, matched as whole `-`-segments anywhere, so `--chakra-space-4` counts). A length whose name names none or more than one (`--size-2`, `--text-gap`) may still match a value in any length category, but never makes a category `compared` and so never decides the verdict; it is counted in `ambiguousDeclared` and, when unused, listed with `categoriesInferred: true`. Durations and easings are counted in `ignoredDeclared`; anything else is listed in `unresolved` with a reason.

Also accepted: `scope`, `elementIds`, `maxElements`, `rootFontSizePx` as above, `tolerance: { colorDeltaE, px }` (defaults 3 and 2) and `maxListed` (default 50 per category).

The response `data`:

- `verdict` — `drift` (a compared value has no token), `no-drift` (every compared value matched) or `unknown` with a `reason`. An empty capture, a declared set with nothing comparable, or no category with both values and tokens is `unknown` — **never `no-drift`**. So is a clean result when some category had values in use and declared tokens none of which resolved (all its tokens are in `unresolved`): its values went uncompared.
- `categories` — per category `{ status, inUse, declared, ambiguousDeclared, matched, undeclaredInUse, unusedDeclared, unresolvedDeclared }`. `status` is `compared`, `no-declared-tokens` (counted, not listed: a colour palette says nothing about spacing), `no-values-in-use` or `empty`. Borders are never compared.
- `summary` — one line per category, e.g. `12 distinct colors in use vs 6 declared: 5 matched, 7 undeclared, 1 declared but unused`.
- `undeclared` — `{ category, value, occurrences, elementCount, properties, nearest, nearMiss, outOfGamut? }`. `nearest` is `{ token, value, distance, unit }`: colours by CIEDE2000 ΔE, lengths in px, ratios, `em`, weights, or `same-primary-family` for fonts. `nearMiss` is true within tolerance — usually a token typed by hand.
- `unused` — tokens nothing in use matched.
- `unresolved` — declared tokens that could not be compared (an unsubstituted `var()`, a default value, an unrecognised value), with a reason. They are not counted as unused.
- `notComparable` (`["breakpoints"]` when declared), `ignoredDeclared`, `unresolvedUncategorised` (unresolved flat-map entries of no recognisable kind; with the per-category `unresolvedDeclared` it sums to `unresolved.length`), `truncation` (`{ undeclared, unused }`, per category `{ total, listed, dropped }`), `declaredSource`, `capture`.

**One colour rule** (`canonicalColorsMatch`), shared by drift and the `/design/audit` validator: colours match when neither lay outside the sRGB gamut and either their hex is equal or their alpha is equal and their ΔE is below 0.5, which absorbs one-step rounding between a declared `oklch` and a computed `oklab`. An out-of-gamut colour never matches — clamping merges distinct wide-gamut colours into one hex — so it is listed in `undeclared` with `outOfGamut: true` even when its clamped hex equals a token. A token of another opacity is never the nearest suggestion, because ΔE cannot see alpha. Drift runs on the full inventory, not the capped one, so a cap never turns a value into "undeclared" or a token into "unused".

## Using the core directly

The aggregation is pure and exported from `@qontinui/ui-bridge/specs`:

```ts
import {
  buildStyleInventory,
  inferStyleGuideFromInventory,
  computeTokenDrift,
} from '@qontinui/ui-bridge/specs';

const inventory = buildStyleInventory([
  { elementId: 'a', styles: { color: 'rgb(17, 17, 17)', paddingTop: '16px' } },
]);
const draft = inferStyleGuideFromInventory(inventory, { maxPerCategory: 12 });
const drift = computeTokenDrift(inventory, { tokens: { colors: { ink: '#111111' } } });
```

## React Native

`@qontinui/ui-bridge-native` serves both routes over each registered element's flattened StyleSheet, using the same functions through its optional `@qontinui/ui-bridge` peer (a release later than 0.47.0; otherwise `INFERENCE_NOT_AVAILABLE`). There are no CSS custom properties and no document there, so `scope: "document"` and `pageCustomPropertyPrefix` answer `INVALID_REQUEST`. Numeric style values are stringified (`fontWeight: 700` → `"700"`), and an iOS `shadowOpacity` is folded into the shadow colour's alpha (`#000` at `0.25` → `rgba(0, 0, 0, 0.25)`; a colour it cannot fold keeps an explicit `opacity(…)` token). React Native has no root font size, so `rem` resolves at 16px unless the request (`/design/audit` included) passes `rootFontSizePx`.

A web host with no DOM at all (a bare Node server over `createHandlers`) answers both routes rather than throwing: inference is `empty` and drift `unknown`, with `capture.notes` saying no DOM was available.
