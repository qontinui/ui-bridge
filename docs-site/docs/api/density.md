# Information Density

`ui-bridge-density` measures information density as **reach per role**: for each audience role and real viewport, how much effort it takes to reach what that role came to the page for, what stands in the way, and which change would reduce it.

Density here is not content per pixel. A page is dense for a role when the answers that role opens it for are on the first screen, legibly, and everything else costs one deliberate step. So the tool reads a page against **asks** — the things a role comes to find out or do, written from an audience profile — and reports, per ask, whether its answer is rendered, how far below the first screen it sits, and how many interactions precede it.

The tool supplies **no score, no grade and no limit**. Limits and legibility floors are the caller's, copied from a document the budget names. Nothing is averaged across roles or viewports, and scroll, interactions and scan are never combined into one number. A quantity the input cannot carry is reported as unknown, never as zero.

One pure model answers three uses:

| When                   | Verb              | Answers                                                                 |
| ---------------------- | ----------------- | ----------------------------------------------------------------------- |
| Before the page exists | `fit`             | Where the fold falls when the asks are stacked in rank order            |
| While designing        | `measure`, `plan` | The reach of every ask; proposals, each with a predicted per-cell delta |
| After building         | `diff`, `assert`  | What changed between two captures; whether the caller's budget holds    |

`init` and `lint` write and check the files the other verbs read.

## Terms

- A **cell** is one combination of role, viewport and fixture (the data state the page was loaded with). Every quantity belongs to one cell.
- An **ask** is one thing a role comes to the page to find out or do. Its `kind` is `state` (brought on every visit), `lookup` (occasionally), `action`, or `reference` (rarely), and its `weight` is how often and how urgently the role brings it to this surface. Each ask quotes the audience-profile sentence it rests on.
- The **first screen** is document `y` in `[0, H)`, where `H` is the viewport height. All geometry is in document space, so a snapshot taken scrolled is reprojected (`foldBasis: reprojected`), not read as if its viewport were the top.
- An **action** is one scroll gesture (0.8 of the usable viewport height) or one interaction (opening a closed disclosure, an inactive tab or a closed menu, expanding a truncated answer, focusing a find field).

## Running it

The command ships as a second bin of `@qontinui/ui-bridge-headless`, from version 0.9.0, the first release that carries it (an older version has no such bin):

```bash
npx -p @qontinui/ui-bridge-headless ui-bridge-density --help
```

From a checkout of this repository, with no release of any package:

```bash
npm run build -w packages/ui-bridge-cli-args && npm run build -w packages/ui-bridge-headless
node packages/ui-bridge-headless/dist/density-cli.js measure --snapshot snapshot.json --role buyer
```

It reads a `GET /control/snapshot` answer from any relay or runner — in the relay's `{ success, data, _meta }` envelope or bare, as the wrapper's `--capture-matrix` writes `snapshot-<n>.json` — or a saved capture file. It does not load `@qontinui/ui-bridge` and never launches a browser: it runs a generated copy of the density core.

The same core is exported by the SDK as the `@qontinui/ui-bridge/density` subpath, for a caller that already holds a snapshot:

```ts
import { captureDensityFromSnapshot, measureDensity } from '@qontinui/ui-bridge/density';

const producer = { id: 'sdk/density', version: '1.0.0', package: 'my-tool' } as const;
const capture = captureDensityFromSnapshot(snapshotJson, { producer, role: 'buyer' });
if (capture.status === 'measured') {
  const report = measureDensity(capture.value, { producer });
}
```

Every entry point takes the `producer` as a required argument, so a report names the package that ran the core rather than claiming the SDK's version.

## The three schemas

### `ui-bridge/density-capture@1`

A capture is the text-free reading of one cell, built from a snapshot by an adapter that reads each text once (its length, a hash, its shape, the role probe, the targets' text matchers) and drops it. `measure --capture-out <file>` writes one; every other verb can read it back.

| Field                        | Holds                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scope`                      | `registered` (built from the registry's snapshot) or `document` (an in-page walk, a later release)                                                                                                                                                                                                                                                                                                |
| `cell`                       | `role`, `viewport` (`width`, `height`) and `fixture`                                                                                                                                                                                                                                                                                                                                              |
| `viewport`                   | width, height, scroll offsets, document extent and the scroll `container`                                                                                                                                                                                                                                                                                                                         |
| `bases`                      | how each reading was made: `foldBasis`, `pinBasis`, `scrollBasis`, `scroller`, `contentCap`                                                                                                                                                                                                                                                                                                       |
| `coverage`                   | items `considered`, `measured`, and each `unmeasured` dimension with its count and unknown code                                                                                                                                                                                                                                                                                                   |
| `probe`                      | whether the role probe matched the snapshot                                                                                                                                                                                                                                                                                                                                                       |
| `targetsHash`, `textMatches` | the targets file the text matchers were evaluated against, and which item ids each matched                                                                                                                                                                                                                                                                                                        |
| `items[]`                    | one per registered element: `id`, `parent`, `path`, `structureBy`, `tag`, `role`, `interactive`, `authorId`, `landmark`, `rect` (document space), `visibility`, `chars`, `ownChars`, `textHash`, `shape`, `fontPx`, `lineHeightPx`, `position`, `truncated`, `recoverable`, `expanded`, `controls`, `href` (a hash), among others (the structure keys the core derives, `selected`, `filters`, …) |

`chars` is `null` inside a redaction boundary, counted under `coverage.unmeasured`. A field the snapshot does not carry is `null` with a coverage entry, never a default.

### `ui-bridge/density-targets@1`

The targets file is the audience profile made executable. The designing agent writes it **before the page exists** and versions it beside the page's spec.

| Field      | Holds                                                                                                                            |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `surface`  | the route the file is for                                                                                                        |
| `profile`  | the audience profile it is derived from, as `audience_profile/<name>@<version>`                                                  |
| `classify` | optional matchers that declare an item's kind (`chrome`, `value`, …), which wins over every inferred kind                        |
| `blocks`   | optional declared blocks, `{ id, match }`; without them blocks come from the page's sections and headings                        |
| `roles[]`  | `role`, an optional `probe` (`{ id, includes }`: the item whose text shows the snapshot was taken as this role) and its `asks[]` |
| `review`   | `{ reviewer, asksHash }`: who reviewed the asks, and the SHA-256 of the asks they reviewed                                       |

Each ask carries `id`, `rank`, `weight`, `kind`, `question`, `source` (`{ doc, quote }`, a verbatim sentence of the profile), `answer`, `need` (`any` or `all`: whether the first or the last answering item decides), `via` (declared interactions on the way), `findChars` (characters typed into a find field) and `form` (`{ rows, lines }`, the size `fit` draws the answer at).

`answer` is a matcher, a list of matchers, or `null`. A matcher is `{ ids?, idPrefix?, idGlob?, role?, tag?, text?, within? }`, and every field given must hold. `answer: null` states that nothing on the page answers the ask; it is listed as **unanswered**. A matcher that matches nothing is **unresolved** — an unknown, never an absence — and its weight widens every interval it touches.

### `ui-bridge/density-budget@1`

| Field          | Holds                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------- |
| `source`       | the tenant document the limits were copied from                                                   |
| `matrix`       | the cells that must be measured; a declared cell with no capture answers unknown                  |
| `floors`       | `{ fontPx, lineHeightRatio, targetPx, rowPadPx }`: the legibility floors no proposal may go under |
| `floorsWaived` | a stated reason to judge compaction without floors, instead of `floors`                           |
| `volume`       | the number of rows each list is judged at; a repeat's extent is projected at it                   |
| `rules[]`      | `{ id, quantity, where, max }` or `{ id, quantity, where, min }`, with an optional `source`       |

A rule names a quantity of the table below. `where` selects the values it judges: `role`, `viewport`, `fixture`, `ask`, `rank`, `kind`, `block`, `repeat`. A rule answers `pass`, `fail` or `unknown` per matching value and is judged on intervals: it passes only if every value in the interval satisfies the limit. A `null` limit answers `unknown{no_expectation}`, never pass. A rule on a compaction quantity with neither `floors` nor `floorsWaived` is unknown and flagged `unbounded`.

## The verbs

```bash
ui-bridge-density init    --surface /orders --profile audience_profile/<name>@<version> \
                          [--targets-out density-targets.json] [--budget-out density-budget.json]
ui-bridge-density lint    --targets targets.json --profile-text profile.md [--profile <doc>]
ui-bridge-density fit     --targets targets.json --shell capture.json [--shell <capture>]... [--budget budget.json]
ui-bridge-density measure --snapshot <file|-> --role buyer [--fixture <name>] [--targets targets.json] \
                          [--capture-out capture.json]
ui-bridge-density measure --capture capture.json [--capture <file>]... [--targets targets.json]
ui-bridge-density plan    --capture capture.json [--capture <file>]... [--targets targets.json] [--budget budget.json] \
                          [--ordered-by <quantity>:<ascending|descending>] [--ordered-by-cell <n>]
ui-bridge-density assert  --budget budget.json <the cell flags of measure>
ui-bridge-density assert  --draft budget.json <the cell flags of measure>
ui-bridge-density diff    --before before.json --after after.json [--targets targets.json] [--budget budget.json] \
                          [--plan plan.json --applied <proposal id> [--applied <proposal id>]...]
```

- **`init`** writes a valid, empty targets file and budget file for a surface: no role, no ask, no limit. It never overwrites a file and supplies no content and no threshold.
- **`lint`** checks that each ask's `quote` is found in the profile text the caller supplies, and lists the profile sentences that no ask quotes. A missing or stale `review.asksHash` puts `review-targets` in `next[]`.
- **`fit`** stacks the asks in rank order at their declared `form` and the budget's floors under the chrome of a shell capture (any page of the same shell), and reports per role and viewport the rank at which the fold is crossed. It is labelled `basis: predicted`. Without floors it answers `unknown{no_expectation}`.
- **`measure`** reports each cell: the bases, the structure, the ledger of the first screen and of the page, and — with `--targets` — the reach of every ask, `answeredAt[k]` as intervals, the unanswered asks and the unclaimed blocks, plus the repeats, the affordances and the legibility bounds. Several `--capture` files measure several cells in one run, and block `invariance` is read across them.
- **`plan`** lists proposals from eight generators — `demote`, `order`, `pitch`, `one-line`, `chrome`, `disclose`, `find`, `dedupe` — each with its `evidence`, its `edits`, per-cell `predicted` deltas with bounds, its `costs` (the asks made worse, the interactions added) and its `conflicts`. A prediction is `measure` of the capture with the proposal's edits applied (`column-shift@1`), so prediction and re-measurement share every definition. Proposals are unranked unless `--ordered-by` names a quantity. No generator changes a font size or goes under a floor, and an added interaction is never netted against saved scroll.
- **`assert`** evaluates a budget and prints the three counts `pass`, `fail`, `unknown`. `--draft <file>` instead writes a budget whose rules carry the current values and `null` limits: the tool never supplies a limit.
- **`diff`** reports per-quantity deltas between two captures of one cell and, for each `--applied` proposal of a saved `plan` output, its `predictionError`: the quantities the prediction got exactly, missed (with the error), or could not compare.

Every report ends with `next[]` from a closed vocabulary: `write-targets`, `review-targets`, `set-limit`, `capture`, `apply`, `re-measure`. Lists are capped, and a capped list reports `shown`, `total` and `truncated`.

## Output

Standard output is one JSON document per run. Each cell carries one `Observation` from producer `sdk/density`: `status: measured` with a `value`, or `status: unknown` with a code from the SDK's closed unknown-code set and a reason. Provenance names the package and version that ran the core and the `targetsHash`. Interaction counts are read from structure and ARIA state with no control operated, and the report says so as `interactionsBasis: static`.

## Exit codes

| Code                | Meaning                                                                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`                 | an answer (`measure`, `plan`, `fit`, `diff`, `init`; unknowns included), or clean (`assert`, `lint`)                                                      |
| `1`                 | a failing rule (`assert`) or a missing quote (`lint`), or an internal error                                                                               |
| `2`                 | a usage error                                                                                                                                             |
| `3`                 | the only non-passes are unknowns (`assert`, `lint`); for `assert --draft`, a cell went unmeasured or no rule could be drafted, so the draft is incomplete |
| `129`, `130`, `143` | interrupted by SIGHUP, SIGINT or SIGTERM                                                                                                                  |

An interruption before any verdict prints one `interrupted` document naming the verb and the step it reached (for example `read-snapshot`). A signal after the verdict is printed adds a note on standard error that the verdict stands, and the run exits with the verdict's own code.

## Quantities

`DENSITY_QUANTITIES`, exported by the core, is the closed registry of every quantity a report emits. A budget rule can name only these. Every quantity reads as an interval `[lo, hi]`: a value the report only bounds (a mean over the asks whose reach is known, a displacement read while asks are unresolved) widens it, and a value given as `null` or as an unknown reads as unknown, never as zero. **compaction** marks a quantity whose rule needs floors or a stated waiver; **drafted** names the bound `assert --draft` writes for it.

| Quantity                           | Unit         | Scope      | Definition                                                                                                                                                                         | Notes                      |
| ---------------------------------- | ------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `cell.items`                       | count        | cell       | Items in the capture.                                                                                                                                                              |                            |
| `cell.coverage.considered`         | count        | cell       | Items considered.                                                                                                                                                                  |                            |
| `cell.coverage.measured`           | count        | cell       | Items measured in every dimension.                                                                                                                                                 |                            |
| `cell.contentRows`                 | count        | cell       | Content rows in the snapshot while its content cap is unreported (the cap's binding is unknown).                                                                                   |                            |
| `cell.structureBy`                 | count        | cell       | Items whose parent was read by the basis where.kind (xpath or geometry).                                                                                                           |                            |
| `cell.kindBy`                      | count        | cell       | Items whose kind was decided by the rule where.kind (declared, landmark, role, author-id, shape, other).                                                                           |                            |
| `structure.leaves`                 | count        | structure  | Leaves.                                                                                                                                                                            |                            |
| `structure.leavesUnknown`          | count        | structure  | Items whose leaf status is unknown (their own text is unreadable).                                                                                                                 |                            |
| `structure.geometryOwnChars`       | count        | structure  | Containers whose own characters subtracted a child linked by geometry, assumed to be a descendant.                                                                                 |                            |
| `structure.unattributedChars`      | chars        | structure  | Characters on registered containers that no registered child accounts for.                                                                                                         |                            |
| `structure.pinTopPx`               | px           | structure  | Height of the bars pinned to the top edge; a lower bound while any pin status is unknown.                                                                                          |                            |
| `structure.pinBottomPx`            | px           | structure  | Height of the bars pinned to the bottom edge; a lower bound while any pin status is unknown.                                                                                       |                            |
| `structure.usableHeightPx`         | px           | structure  | Viewport height less the pinned bars (Hu); an upper bound while any pin status is unknown.                                                                                         |                            |
| `structure.pins`                   | count        | structure  | Pinned items.                                                                                                                                                                      |                            |
| `structure.pinsUnknown`            | count        | structure  | Items whose pin status could not be read.                                                                                                                                          |                            |
| `structure.kindsByBasis`           | count        | structure  | Leaves of the kind where.kind, one value per rule that decided kinds.                                                                                                              |                            |
| `structure.blocksByBasis`          | count        | structure  | Blocks found by the basis where.kind (declared, path, heading).                                                                                                                    |                            |
| `structure.headingLevelUnknown`    | count        | structure  | Headings whose level the capture does not carry.                                                                                                                                   |                            |
| `structure.unblockedLeaves`        | count        | structure  | Leaves in no block.                                                                                                                                                                |                            |
| `ledger.firstScreen.widthPx`       | px           | ledger     | Width of the first screen (document y in [0, H)).                                                                                                                                  |                            |
| `ledger.firstScreen.heightPx`      | px           | ledger     | Height of the first screen (document y in [0, H)).                                                                                                                                 |                            |
| `ledger.firstScreen.cells`         | cells        | ledger     | 8 px grid cells in the first screen (document y in [0, H)).                                                                                                                        |                            |
| `ledger.firstScreen.kindCells`     | cells        | ledger     | Grid cells of the first screen (document y in [0, H)) whose smallest covering leaf is of kind where.kind (or uncovered).                                                           |                            |
| `ledger.firstScreen.share`         | share        | ledger     | Share of the first screen (document y in [0, H)) whose smallest covering leaf is of kind where.kind (or uncovered); the shares sum to 1.                                           |                            |
| `ledger.page.widthPx`              | px           | ledger     | Width of the whole page (the document extent).                                                                                                                                     |                            |
| `ledger.page.heightPx`             | px           | ledger     | Height of the whole page (the document extent).                                                                                                                                    |                            |
| `ledger.page.cells`                | cells        | ledger     | 8 px grid cells in the whole page (the document extent).                                                                                                                           |                            |
| `ledger.page.kindCells`            | cells        | ledger     | Grid cells of the whole page (the document extent) whose smallest covering leaf is of kind where.kind (or uncovered).                                                              |                            |
| `ledger.page.share`                | share        | ledger     | Share of the whole page (the document extent) whose smallest covering leaf is of kind where.kind (or uncovered); the shares sum to 1.                                              |                            |
| `ledger.contentTopPx`              | px           | ledger     | Top of the first painted leaf that is not chrome, document px.                                                                                                                     | drafted as max             |
| `ledger.unpainted`                 | count        | ledger     | Leaves the grid does not paint, for the reason where.kind (noRect, hidden, visibilityUnknown, leafUnknown).                                                                        |                            |
| `role.totalWeight`                 | weight       | role       | The summed weight of the role's asks.                                                                                                                                              |                            |
| `role.answeredAt.0`                | share        | role       | The weight share of the role's asks answered within 0 actions, as an interval that unresolved weight widens.                                                                       | drafted as min             |
| `role.answeredAt.1`                | share        | role       | The weight share of the role's asks answered within 1 actions, as an interval that unresolved weight widens.                                                                       | drafted as min             |
| `role.answeredAt.2`                | share        | role       | The weight share of the role's asks answered within 2 actions, as an interval that unresolved weight widens.                                                                       | drafted as min             |
| `role.answeredAt.3`                | share        | role       | The weight share of the role's asks answered within 3 actions, as an interval that unresolved weight widens.                                                                       | drafted as min             |
| `role.meanScrollPx`                | px           | role       | The weight-weighted mean scroll to the role's answered asks; bounded from below while any ask's reach is unknown, and unbounded while an ask is partial.                           | drafted as max             |
| `role.meanInteractions`            | interactions | role       | The weight-weighted mean interactions to the role's answered asks; bounded from below while any ask's reach is unknown, and unbounded while an ask is partial.                     | drafted as max             |
| `role.unweighted.meanScrollPx`     | px           | role       | The unweighted mean scroll to the role's answered asks; bounded from below while any ask's reach is unknown, and unbounded while an ask is partial.                                |                            |
| `role.unweighted.meanInteractions` | interactions | role       | The unweighted mean interactions to the role's answered asks; bounded from below while any ask's reach is unknown, and unbounded while an ask is partial.                          |                            |
| `role.unresolvedWeight`            | weight       | role       | The weight of asks whose answer matcher resolved to nothing, or only in part.                                                                                                      |                            |
| `role.unplacedWeight`              | weight       | role       | The weight of resolved asks answered by an item no block can hold.                                                                                                                 |                            |
| `role.unanswered`                  | count        | role       | Asks the targets state nothing on the page answers (answer: null).                                                                                                                 | drafted as max             |
| `role.unclaimedBlocks`             | count        | role       | Blocks on the first screen that answer none of the role's asks and displace answers below them; a lower bound while uncertain weight keeps the detector from firing.               | drafted as max             |
| `role.possiblyUnclaimedBlocks`     | count        | role       | Blocks that would read as unclaimed but for the unresolved or unplaced weight that could be inside them.                                                                           |                            |
| `ask.first.scrollPx`               | px           | ask        | Scroll from the top of the page until the ask's first answering leaf is in the usable viewport.                                                                                    | drafted as max             |
| `ask.first.gestures`               | gestures     | ask        | Scroll gestures of 0.8 usable viewport heights to reach the ask's first answering leaf.                                                                                            |                            |
| `ask.first.interactions`           | interactions | ask        | Disclosures, tabs, menus, truncation expansions and find-field focuses between the role and the ask's first answering leaf, read statically.                                       | drafted as max             |
| `ask.first.keystrokes`             | keystrokes   | ask        | Characters typed into a find field to reach the ask's first answering leaf (the ask's declared findChars).                                                                         |                            |
| `ask.first.actions`                | actions      | ask        | Gestures plus interactions to reach the ask's first answering leaf.                                                                                                                |                            |
| `ask.first.foreignPx`              | px           | ask        | Chrome height plus unclaimed block height above the ask's first answering leaf in its column; a lower bound while uncertain weight keeps blocks from reading as unclaimed.         |                            |
| `ask.all.scrollPx`                 | px           | ask        | Scroll from the top of the page until the last of the ask's answering leaves is in the usable viewport.                                                                            |                            |
| `ask.all.gestures`                 | gestures     | ask        | Scroll gestures of 0.8 usable viewport heights to reach the last of the ask's answering leaves.                                                                                    |                            |
| `ask.all.interactions`             | interactions | ask        | Disclosures, tabs, menus, truncation expansions and find-field focuses between the role and the last of the ask's answering leaves, read statically.                               |                            |
| `ask.all.keystrokes`               | keystrokes   | ask        | Characters typed into a find field to reach the last of the ask's answering leaves (the ask's declared findChars).                                                                 |                            |
| `ask.all.actions`                  | actions      | ask        | Gestures plus interactions to reach the last of the ask's answering leaves.                                                                                                        |                            |
| `ask.all.foreignPx`                | px           | ask        | Chrome height plus unclaimed block height above the last of the ask's answering leaves in its column; a lower bound while uncertain weight keeps blocks from reading as unclaimed. |                            |
| `ask.all.unknownItems`             | count        | ask        | The ask's answering leaves whose reach is unknown.                                                                                                                                 |                            |
| `ask.answerItems`                  | count        | ask        | Leaves answering the ask; a lower bound while the ask is partial.                                                                                                                  |                            |
| `ask.answerItemsFirstScreen`       | count        | ask        | Leaves answering the ask that lie on the first screen.                                                                                                                             |                            |
| `cell.blocks`                      | count        | cell       | Blocks.                                                                                                                                                                            |                            |
| `block.members`                    | count        | block      | The block's members.                                                                                                                                                               |                            |
| `block.topPx`                      | px           | block      | Top of the block's members, document px.                                                                                                                                           |                            |
| `block.heightPx`                   | px           | block      | Height of the union of the block's members.                                                                                                                                        | compaction                 |
| `block.pitchPx`                    | px           | block      | Distance from the block's top to the top of the next block in its column, padding included.                                                                                        | compaction                 |
| `block.firstScreenPx`              | px           | block      | Height of the block that lies on the first screen.                                                                                                                                 |                            |
| `block.claimedWeight`              | weight       | block      | The weight of the role's asks answered inside the block; a lower bound while uncertain weight could be answered inside it.                                                         |                            |
| `block.displacementPx`             | px           | block      | The scroll the block costs the role per visit: Σ below w·min(pitch, scroll) / Σ w; a lower bound while reach is unknown.                                                           | drafted as max             |
| `block.invariance.identical`       | captures     | block      | The most captures of this invocation that hold the block with identical text.                                                                                                      |                            |
| `block.invariance.of`              | captures     | block      | The captures of this invocation that hold the block.                                                                                                                               |                            |
| `cell.repeatsByBasis`              | count        | cell       | Repeats found by the basis where.kind (path, geometry).                                                                                                                            |                            |
| `cell.repeats`                     | count        | cell       | Repeats.                                                                                                                                                                           |                            |
| `repeat.members`                   | count        | repeat     | The repeat's members.                                                                                                                                                              |                            |
| `repeat.rows`                      | rows         | repeat     | Rendered rows of the repeat.                                                                                                                                                       |                            |
| `repeat.perRow`                    | count        | repeat     | Columns: the most left-edge clusters a row holds.                                                                                                                                  |                            |
| `repeat.firstRow.topPx`            | px           | repeat     | Top of the repeat's first row, document px.                                                                                                                                        |                            |
| `repeat.firstRow.bottomPx`         | px           | repeat     | Bottom of the repeat's first row, document px.                                                                                                                                     |                            |
| `repeat.lastRow.topPx`             | px           | repeat     | Top of the repeat's last row, document px.                                                                                                                                         |                            |
| `repeat.lastRow.bottomPx`          | px           | repeat     | Bottom of the repeat's last row, document px.                                                                                                                                      |                            |
| `repeat.rowPitchPx`                | px           | repeat     | Median top-to-top distance between consecutive rows.                                                                                                                               | compaction, drafted as max |
| `repeat.linesPerRow`               | lines        | repeat     | Median distinct line bands per row (estimated from a snapshot).                                                                                                                    | compaction                 |
| `repeat.rowTextPx`                 | px           | repeat     | Median height of a row's text lines.                                                                                                                                               |                            |
| `repeat.rowFill`                   | ratio        | repeat     | Median row text height over the row's pitch.                                                                                                                                       | compaction                 |
| `repeat.rowsEstimated`             | rows         | repeat     | Rows whose line bands could be estimated.                                                                                                                                          |                            |
| `repeat.valuesPerRow`              | count        | repeat     | Median value leaves per row.                                                                                                                                                       |                            |
| `repeat.widthFill`                 | ratio        | repeat     | Median share of a row's width its leaves cover.                                                                                                                                    |                            |
| `repeat.rowsPerScreen`             | rows         | repeat     | Rows that fit the usable viewport height (Hu / rowPitchPx); an upper bound while a pin status is unknown.                                                                          | compaction, drafted as min |
| `repeat.extentPx`                  | px           | repeat     | From the repeat's first row's top to its lowest member's bottom.                                                                                                                   | compaction                 |
| `repeat.extentAtVolumePx`          | px           | repeat     | The repeat's extent projected at the budget's row volume.                                                                                                                          | compaction                 |
| `repeat.renderedOf`                | rows         | repeat     | How many rows exist, of which the rendered ones are shown (measured by the document walk only).                                                                                    |                            |
| `cell.affordancesByKind`           | count        | cell       | Affordances of the kind where.kind (disclosure, tab, menu, search, filter, pager, truncation, abbreviation).                                                                       |                            |
| `cell.affordancesByRule`           | count        | cell       | Affordances detected by the rule where.kind.                                                                                                                                       |                            |
| `cell.affordances`                 | count        | cell       | Affordances.                                                                                                                                                                       |                            |
| `affordance.hidesItems`            | count        | affordance | Items the affordance hides (measured by the document walk only).                                                                                                                   |                            |
| `affordance.hidesValues`           | count        | affordance | Value leaves the affordance hides (measured by the document walk only).                                                                                                            |                            |
| `affordance.hidesChars`            | chars        | affordance | Characters the affordance hides (measured by the document walk only).                                                                                                              |                            |
| `bounds.textLeaves`                | count        | bounds     | Answer and value leaves the text bounds considered, or left out for the reason where.kind.                                                                                         |                            |
| `bounds.fontPx.min`                | px           | bounds     | The smallest font size, px of the answer and value leaves.                                                                                                                         | drafted as min             |
| `bounds.fontPx.of`                 | count        | bounds     | Answer and value leaves whose font size, px was read.                                                                                                                              |                            |
| `bounds.fontPx.atMin`              | count        | bounds     | Leaves at the smallest font size, px.                                                                                                                                              |                            |
| `bounds.fontPx.p10`                | px           | bounds     | The 10th-percentile font size of the answer and value leaves.                                                                                                                      |                            |
| `bounds.lineHeightRatio.min`       | ratio        | bounds     | The smallest line height over font size of the answer and value leaves.                                                                                                            | drafted as min             |
| `bounds.lineHeightRatio.of`        | count        | bounds     | Answer and value leaves whose line height over font size was read.                                                                                                                 |                            |
| `bounds.lineHeightRatio.atMin`     | count        | bounds     | Leaves at the smallest line height over font size.                                                                                                                                 |                            |
| `bounds.lineHeightRatio.p10`       | ratio        | bounds     | The 10th-percentile line-height ratio of the answer and value leaves.                                                                                                              |                            |
| `bounds.gapEm.min`                 | em           | bounds     | The smallest vertical gap to the next leaf, in em of the answer and value leaves.                                                                                                  |                            |
| `bounds.gapEm.of`                  | count        | bounds     | Answer and value leaves whose vertical gap to the next leaf, in em was read.                                                                                                       |                            |
| `bounds.gapEm.atMin`               | count        | bounds     | Leaves at the smallest vertical gap to the next leaf, in em.                                                                                                                       |                            |
| `bounds.controls`                  | count        | bounds     | Painted control leaves.                                                                                                                                                            |                            |
| `bounds.controls.minSidePx`        | px           | bounds     | The smallest side of a painted control.                                                                                                                                            | drafted as min             |
| `bounds.controls.minSidePx.atMin`  | count        | bounds     | Controls at the smallest side.                                                                                                                                                     |                            |
| `bounds.controls.minGapPx`         | px           | bounds     | The smallest gap between two painted controls that do not overlap.                                                                                                                 |                            |
| `bounds.truncated`                 | count        | bounds     | Truncated leaves, recoverable or not.                                                                                                                                              |                            |
| `bounds.occluded`                  | count        | bounds     | Occluded leaves.                                                                                                                                                                   |                            |

## What a snapshot cannot measure

In this release every reading comes from the control snapshot, which holds only what the app registered. Each limit has a field that says when it applies.

| Limit                                                        | How the report says so                                                                                 |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| A pinned bar the app never registered is not in the snapshot | `pinBasis: registered-only`                                                                            |
| The snapshot was taken scrolled                              | `foldBasis: reprojected`; rects are moved to document space                                            |
| The page scrolls inside an inner scroller                    | `scrollBasis: inner-scroller`, and scroll quantities for items inside it are `unknown{input_missing}`  |
| The registrar's content cap may have dropped rows            | `contentCap: unreported` with the count of content rows, never "nothing dropped"                       |
| Text, a hidden panel or a bar in no registered element       | `uncovered` in the ledger means _unregistered or empty_; `unattributedChars` counts text on containers |
| How many rows a lazy list has                                | `repeat.renderedOf` is `unknown{input_missing}`                                                        |
| What a disclosure, tab or menu hides                         | `hides` is `unknown{input_missing}`                                                                    |
| Line bands of a row                                          | estimated from characters, font size and width (`linesBasis: estimated`)                               |
| A redacted text                                              | `chars: null`, counted under `coverage.unmeasured` with code `not_attempted_by_policy`                 |
| Whether a truncated answer has a recoverable full form       | `recoverable` is `true` only when the accessible name came from `title`, otherwise `null`              |
| What operating a control would reveal                        | nothing is operated: `interactionsBasis: static`                                                       |
| An item kind decided only by the shape of its text           | counted apart under `kindBy.shape`, the weakest basis                                                  |
| A prediction where columns would rebalance                   | `unknown{not_attempted_by_policy}`: `column-shift@1` declines it                                       |

So a page whose values are not registered reads as mostly `uncovered`, which is a true statement about the registry and not about the page.

A capture holds no page text, but its text hashes are equality tokens: the hash of a short value can be reversed by trying candidates. A capture is no more private than the snapshot it was built from. Keep captures of a real app's pages in that app's own store.

## Worked example

A synthetic order page at 1280 × 800, document height 1000. A fixed header is 64 px tall. Below it, three sections stack in one column:

| Block     | Members                                            | Document `y` |
| --------- | -------------------------------------------------- | ------------ |
| `company` | a heading, an address paragraph, a story paragraph | 80 to 464    |
| `orders`  | a heading and six order rows at a 56 px pitch      | 480 to 820   |
| `help`    | one paragraph                                      | 900 to 948   |

The buyer's audience profile says _"A buyer checks every morning which open orders need action. Now and then a buyer needs help with an order. A buyer wants to know when a back-ordered item arrives. A buyer sometimes compares prices across suppliers."_ The targets file turns that into three asks:

```json
{
  "schema": "ui-bridge/density-targets@1",
  "surface": "/orders",
  "profile": "audience_profile/example-buyer@1",
  "blocks": [
    { "id": "company", "match": { "idPrefix": "app.company." } },
    { "id": "orders", "match": { "idPrefix": "app.orders." } },
    { "id": "help", "match": { "ids": ["app.help.p"] } }
  ],
  "roles": [
    {
      "role": "buyer",
      "asks": [
        {
          "id": "B1",
          "rank": 1,
          "weight": 5,
          "kind": "state",
          "question": "Which of my open orders need action today?",
          "source": {
            "doc": "audience_profile/example-buyer@1",
            "quote": "A buyer checks every morning which open orders need action."
          },
          "answer": { "idPrefix": "app.orders.row" },
          "need": "all",
          "form": { "rows": 6, "lines": 1 }
        },
        {
          "id": "B2",
          "rank": 2,
          "weight": 1,
          "kind": "reference",
          "question": "How do I get help?",
          "source": {
            "doc": "audience_profile/example-buyer@1",
            "quote": "Now and then a buyer needs help with an order."
          },
          "answer": { "ids": ["app.help.p"] }
        },
        {
          "id": "B3",
          "rank": 3,
          "weight": 2,
          "kind": "lookup",
          "question": "When will a back-ordered item arrive?",
          "source": {
            "doc": "audience_profile/example-buyer@1",
            "quote": "A buyer wants to know when a back-ordered item arrives."
          },
          "answer": null
        }
      ]
    }
  ],
  "review": {
    "reviewer": "example-designing-agent",
    "asksHash": "41247275872e350cf0631e4772927941892779a0a5720fe7303ffb481b506055"
  }
}
```

`lint --targets targets.json --profile-text profile.md` finds all three quotes and lists the one sentence of the profile no ask quotes yet (_"A buyer sometimes compares prices across suppliers."_), which is the designing agent's cue to decide whether it is an ask.

**Measure.** `measure --snapshot snapshot.json --role buyer --targets targets.json --capture-out capture.json` answers, for the buyer at 1280 × 800 (values from the run):

| Ask  | State      | Reach                                                                                                                                                                    |
| ---- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `B1` | rendered   | five of six rows on the first screen; the last needs 20 px of scroll, one gesture (`all.actions: 1`), with `foreignPx: 432` (the header plus the company block) above it |
| `B2` | rendered   | 124 px of scroll, one gesture                                                                                                                                            |
| `B3` | unanswered | listed in `unanswered`                                                                                                                                                   |

`answeredAt` is `[0, 0]` at k = 0 and `[0.75, 0.75]` at k = 1: no ask is answered without an action, and 6 of the 8 weight within one. The interval is a single point because no ask is unresolved.

The report lists one **unclaimed block**: `company`, with `firstScreenPx: 368`, `claimedWeight: 0` and `displacementPx: 28`. Nobody told the tool that a company address is not what a buyer comes for: the block takes first-screen space, answers no ask of this role, and pushes answers below the fold. Had any ask been unresolved, the block would be listed as _possibly unclaimed_ with the unresolved weight beside it, because the missing answer could be inside it.

**Plan.** `plan --capture capture.json --targets targets.json` proposes four changes, unranked:

| Proposal                       | Edit                                   | Predicted for the buyer                                                                |
| ------------------------------ | -------------------------------------- | -------------------------------------------------------------------------------------- |
| `demote:company`               | move the company block below `help`    | `answeredAt[0]` 0 → 0.75; `meanScrollPx` 37.3 → 0; `unclaimedBlocks` 1 → 0; costs none |
| `order:company>orders`         | move the company block below `orders`  | `answeredAt[0]` 0 → 0.625; `meanScrollPx` 37.3 → 20.7                                  |
| `pitch:repeat:app.orders.row1` | tighten the row pitch                  | `unknown{no_expectation}`: a compaction is planned against floors, and none were given |
| `disclose:help`                | put the help paragraph behind a toggle | `answeredAt[1]` 0.75 → 0.625; costs: `B2` gains one interaction and 24 px of scroll    |

`demote` and `order` move the same block, so each lists the other under `conflicts`. With a budget that states floors (`fontPx: 14`, `lineHeightRatio: 1.4`, `targetPx: 32`, `rowPadPx: 8`), `pitch` becomes a measured prediction: the row pitch from 56 to 35.6 px and `answeredAt[0]` from 0 to 0.625, with no font size changed.

**Assert.** The budget is the tenant's, not the tool's:

```json
{
  "schema": "ui-bridge/density-budget@1",
  "source": "design_standard/example-shop@1",
  "matrix": [{ "role": "buyer", "viewport": { "width": 1280, "height": 800 }, "fixture": null }],
  "volume": null,
  "rules": [
    {
      "id": "state-asks-in-one-action",
      "quantity": "role.answeredAt.1",
      "where": { "role": "buyer" },
      "min": 0.7
    },
    {
      "id": "no-scroll-to-the-first-order",
      "quantity": "ask.first.scrollPx",
      "where": { "role": "buyer", "kind": "state" },
      "max": 0
    },
    {
      "id": "everything-on-the-first-screen",
      "quantity": "role.answeredAt.0",
      "where": { "role": "buyer" },
      "min": 0.5
    },
    {
      "id": "block-displacement",
      "quantity": "block.displacementPx",
      "where": { "role": "buyer" },
      "max": null
    }
  ]
}
```

`assert --budget budget.json --capture capture.json --targets targets.json` exits `1` with `pass: 2, fail: 1, unknown: 1`: `everything-on-the-first-screen` fails (`[0, 0]` against a minimum of 0.5), and `block-displacement` is `unknown{no_expectation}` because its limit is `null`, with `set-limit` in `next[]`.

**Diff.** After the demote is built, a second snapshot is measured and compared: `diff --before capture.json --after capture-after.json --targets targets.json --plan plan.json --applied demote:company`. The measured deltas match the prediction on the buyer's quantities — `answeredAt[0]` 0 → 0.75, `meanScrollPx` 37.3 → 0, `unclaimedBlocks` 1 → 0 — and `predictionError` names what the prediction missed. Every miss comes from one gap: `column-shift@1` placed the company block 16 px below `help` and the built page leaves 32 px, so `block.topPx[block=company]` was predicted at 564 and measured at 580, and the quantities that follow from it (the block's `firstScreenPx`, the pitch of `help`, the ledger's prose and uncovered cells, `bounds.gapEm.min`) miss with it. The comparisons that could not be made (the reach of the unanswered `B3`, among them) are listed as `unknown`, not as exact.
