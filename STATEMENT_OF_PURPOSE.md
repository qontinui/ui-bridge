# UI Bridge: Statement of Purpose

## Mission

UI Bridge exists to make any React application **semantically observable and programmatically controllable** by AI agents, automation workflows, and developers — without brittle selectors, external browser drivers, or manual test instrumentation.

## Core Principle

**The application knows itself better than any external tool can.** By embedding observability directly into the React rendering lifecycle, UI Bridge captures semantic meaning, component relationships, and application state that external tools (Playwright, Selenium) can only approximate through DOM scraping. This inside-out approach makes AI-driven automation fundamentally more reliable.

## What UI Bridge Is

UI Bridge is a **semantic control plane** for React applications. It transforms a running app into a programmable system through five capabilities:

### 1. Discovery and Control

**Discovering** interactive and content elements through React hooks, exposing them with stable semantic IDs, human-readable labels, available actions, and rich state (value, visibility, validation, constraints). **Controlling** those elements through a uniform action API (click, type, select, scroll, drag, submit) that returns structured feedback — not fire-and-forget events.

### 2. Semantic Page Specs

**Specs** are declarative JSON specifications that define the complete expected behavior of a page — its purpose, its visual design, its interactive flows, and its domain logic correctness. A spec is not a simple element checklist. It encodes:

- **What the page achieves for the user** — its functional purpose and success criteria
- **What it should look like** — layout, typography, colors, spacing, theme compliance
- **What its architecture should be** — component structure, data flow, state management
- **What correct domain logic looks like** — for pages backed by algorithms or backend libraries, specs define testable criteria for correct output (e.g., "every discovered state must contain at least one element", "no two states should have identical element sets")

Specs can reference functionality in any module available to the AI — backend services, shared libraries, data models. This makes specs a powerful tool: an AI can read a spec to understand what functionality *should* do, then use UI Bridge to see what it *currently* does. The gap between the two is the work to be done. This enables long-running autonomous workflows to develop entire applications by iterating against specs.

### 3. Model-Based State Machine

The UI Bridge state machine uses **model-based GUI automation** to provide effortless navigation to any place in an application's UI. Instead of writing brittle sequential scripts ("click A, then B, then C to reach the dashboard"), the consumer says "navigate to the dashboard" and the state machine finds and executes the optimal path.

Key properties:
- **Multiple active states** — A toolbar, sidebar, and main content area can all be active simultaneously. The state machine tracks the full set of active states (`S_Ξ`), not just one.
- **Multi-target pathfinding** — "Navigate to states X, Y, and Z" finds a path that reaches all targets, not just one.
- **Automatic pathfinding** — BFS, Dijkstra, and A* strategies find optimal paths through the state graph. Consumers never think about navigation sequences.
- **Fingerprint-based state discovery** — States can be automatically discovered by analyzing which UI elements co-occur across different views of the application.

This reduces automation complexity from exponential (O(c^n) for process-based scripts) to polynomial (O(n × c) for model-based). For a 30-state app with 5 transitions each, that's 180 definitions instead of trillions of possible paths.

### 4. Observation and Readiness

**Observing** application readiness through multi-signal idle detection (network, DOM, loading indicators, form state) so consumers know when the app has settled after an action. Every action returns what happened — state before and after, errors captured, timing. The render log records what changed. Console errors are captured automatically.

### 5. AI-Native Bridge

**Bridging** the gap between AI reasoning and UI interaction through: fuzzy element search, semantic snapshots, natural language assertions, change summarization, form discovery, media snapshot capture, pixel-level visual comparison, layout and component diffs, design property inspection, and responsive breakpoint analysis.

## Who It Serves

| Consumer | How They Use It | What They Need |
|----------|----------------|----------------|
| **AI agents** (Claude, LLMs) | HTTP API or MCP tools to understand and interact with UI | Semantic snapshots, fuzzy search, concise element descriptions, reliable action feedback, specs to understand intent |
| **Automation workflows** (Qontinui Runner) | Deterministic steps in state-machine workflows | Stable element IDs, state machine navigation, spec-based verification, idle detection |
| **Developers** | Python/TypeScript clients for testing and debugging | Simple API, inspector overlay, console/error capture, render logs |
| **Specs/QA** | Declarative assertions against expected UI state | Spec format, assertion execution, regression detection, quality evaluation |

## Design Principles

1. **Semantic over structural** — Elements are identified by purpose and meaning, not CSS paths. A "Submit" button is a Submit button regardless of its DOM nesting.

2. **Embedded, not bolted on** — The SDK lives inside the app via React hooks (`useUIElement`, `useUIComponent`). This gives it access to React state, component boundaries, and rendering lifecycle that no external tool can see.

3. **AI-native by default** — Every API is designed for LLM consumption: concise structured responses, fuzzy matching that tolerates imprecise queries, semantic summaries that fit in context windows, and error messages that guide the AI toward the right next action.

4. **Readiness, not timeouts** — Instead of arbitrary `sleep(2000)` waits, UI Bridge measures actual readiness through composable signals. Actions can wait for the app to settle before returning.

5. **Layered abstraction** — Three levels of control: element-level (click a button), component-level (log in with credentials), and workflow-level (complete a multi-step process). Each layer builds on the one below.

6. **Cross-platform uniformity** — The same HTTP API works whether the app runs in a browser (Next.js), a desktop webview (Tauri), or a mobile device (React Native). Consumers don't need to know the hosting context.

7. **Observable by design** — Every action returns what happened (state before/after, errors captured, timing). The render log records what changed. Console errors are captured automatically. Nothing is silent.

8. **Declarative correctness** — Specs define what the application should do; the state machine defines how to reach any part of it. Together, they let an AI verify an entire application without procedural scripting.

## The Vision: AI Eyes Into the Application

The ultimate UI Bridge gives an AI **everything it needs to see** to understand, develop, and debug an application — and does so efficiently. This means:

- **Intent** — Specs that describe what each page should achieve, how it should look, and what correct behavior means — including domain logic backed by any code available to the AI
- **Current state** — Element registry, component trees, state snapshots, form state, visual captures, design properties
- **Navigation** — A state machine that can reach any place in the application without the AI needing to think about pathfinding
- **Change detection** — DOM diffs, layout comparisons, component tree diffs, content diffs, form diffs, pixel-level visual comparison
- **Runtime context** — Console errors, network failures, navigation events, long tasks, memory snapshots, HMR events, React error boundaries
- **Visual data** — Screenshots, pixel captures, media element snapshots, canvas content, responsive viewport captures, interaction state styles

Any capability that helps an AI see more, understand more, or act more precisely within an application is a welcome addition to the UI Bridge. The SDK should be the AI's complete window into the running application.

## What UI Bridge Is Not

- **Not a test orchestrator** — It provides the primitives (discovery, control, assertion, visual comparison, specs, state machine) but doesn't own test scheduling, sequencing, or reporting. That's the runner's and workflow system's job.
- **Not a browser launcher** — It doesn't start browsers, manage browser processes, or create sessions. It's embedded in an already-running application and observes from the inside.
- **Not an accessibility compliance tool** — It serves AI agents and automation, not WCAG auditing (though the semantic layer could support accessibility use cases).
- **Not a network proxy** — It captures network events and errors as they happen inside the app, but doesn't intercept, modify, or mock HTTP traffic. Network-level concerns belong to the application or external tools.
- **Not a build tool** — It doesn't compile, bundle, or deploy applications. It observes and controls running applications regardless of how they were built.

## Architectural Commitments

These are load-bearing decisions that guide all future development:

1. **The element registry is the source of truth.** All element metadata flows through the registry. External discovery (DOM scanning) supplements but doesn't replace registered elements.

2. **HTTP is the primary consumer interface.** All capabilities are exposed over HTTP (REST + SSE). IPC, MCP, and client libraries are adapters over HTTP, not separate implementations.

3. **The SDK must remain lightweight in the host app.** Memory budget per element must stay small. Discovery should be lazy where possible. The SDK must not degrade the host app's performance.

4. **Server adapters are thin.** Framework-specific adapters (Next.js, Express, Tauri IPC) should be minimal wrappers. Business logic lives in the core SDK, not in adapters.

5. **AI features are additive, not required.** The core SDK (discovery, control, idle) works without the AI module. AI features (fuzzy search, semantic snapshots, assertions) layer on top for consumers that need them.

6. **Specs are the contract between intent and implementation.** Specs define what the UI should do — not how to get there. They are versioned artifacts that can be authored, stored, executed, and used by AI agents to understand the gap between desired and actual behavior.

7. **The state machine abstracts navigation.** Consumers declare where they want to be, not how to get there. Pathfinding, transition execution, and multi-state tracking are the framework's responsibility.
