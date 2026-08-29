<!-- BEGIN License & CLA preamble — added 2026-04-29 during AGPL rollout -->

## License & CLA

This project is licensed under the **GNU Affero General Public License v3.0 or later** (`AGPL-3.0-or-later`). See [`LICENSE`](LICENSE) for the full text. Contributors should be aware:

- AGPL is a strong copyleft license. Anyone who runs a modified version of this project as a network service must publish their modifications under AGPL too.
- For typical self-hosting, internal use, forking, or contributing back, AGPL behaves like GPL.

All non-trivial contributions require signing the qontinui Contributor License Agreement (CLA). The CLA is administered via [cla-assistant.io](https://cla-assistant.io/) — when you open a pull request, the CLA bot will comment with a one-click sign link, and signing applies across all qontinui repositories. The CLA text lives in [`CLA.md`](CLA.md). It grants Joshua Spinak the right to relicense your contribution under any future license; you retain copyright in your contributions.

The remainder of this document covers contribution mechanics specific to this repository.

<!-- END License & CLA preamble -->

# Contributing to UI Bridge

Thank you for your interest in contributing to UI Bridge! This document provides guidelines and instructions for contributing.

## Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment for everyone.

## Getting Started

### Prerequisites

- Node.js 18 or later
- npm 9 or later
- Python 3.10+ (for ui-bridge-python)

### Setting Up the Development Environment

1. **Fork and clone the repository**

   ```bash
   git clone https://github.com/YOUR_USERNAME/ui-bridge.git
   cd ui-bridge
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Build all packages**

   ```bash
   npm run build
   ```

4. **Run tests**

   ```bash
   npm run test
   ```

### Project Structure

```
ui-bridge/
├── packages/
│   ├── ui-bridge/           # Main React package
│   │   ├── src/
│   │   │   ├── core/        # Element identification, registry
│   │   │   ├── render-log/  # DOM observation
│   │   │   ├── control/     # Action execution
│   │   │   ├── debug/       # DevTools, inspector
│   │   │   └── react/       # Hooks and providers
│   │   └── package.json
│   │
│   ├── ui-bridge-server/    # Server adapters
│   │   ├── src/
│   │   │   ├── express.ts
│   │   │   ├── nextjs.ts
│   │   │   └── standalone.ts
│   │   └── package.json
│   │
│   └── ui-bridge-python/    # Python client
│       ├── src/ui_bridge/
│       └── pyproject.toml
│
├── examples/                # Example applications
├── docs-site/              # Documentation (Docusaurus)
└── package.json            # Root workspace config
```

## Development Workflow

### Making Changes

1. **Create a branch**

   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/issue-description
   ```

2. **Make your changes**

   Follow the coding standards outlined below.

3. **Test your changes**

   ```bash
   # Run all tests
   npm run test

   # Run specific package tests
   npm run test -w packages/ui-bridge

   # Run type checking
   npm run typecheck
   ```

4. **Commit your changes**

   Use clear, descriptive commit messages:

   ```bash
   git commit -m "feat: add workflow pause/resume functionality"
   git commit -m "fix: resolve element state not updating on blur"
   git commit -m "docs: add Tauri integration guide"
   ```

   Commit message format:
   - `feat:` - New features
   - `fix:` - Bug fixes
   - `docs:` - Documentation changes
   - `refactor:` - Code refactoring
   - `test:` - Test additions/changes
   - `chore:` - Build/tooling changes

5. **Push and create a PR**

   ```bash
   git push origin your-branch-name
   ```

   Then create a pull request on GitHub.

### Coding Standards

#### TypeScript

- Use TypeScript strict mode
- Export types alongside implementations
- Prefer `interface` over `type` for object shapes
- Use meaningful variable and function names
- Add JSDoc comments for public APIs

````typescript
/**
 * Registers a UI element for control via UI Bridge.
 *
 * @param options - Element registration options
 * @returns Element control handle with ref and state access
 *
 * @example
 * ```tsx
 * const button = useUIElement({
 *   id: 'submit-btn',
 *   type: 'button',
 *   label: 'Submit Form',
 * });
 * ```
 */
export function useUIElement(options: UseUIElementOptions): UseUIElementReturn {
  // Implementation
}
````

#### React

- Use functional components with hooks
- Memoize expensive computations with `useMemo`
- Use `useCallback` for stable function references
- Follow React naming conventions (`use*` for hooks)

#### Python

- Follow PEP 8 style guidelines
- Use type hints for all function signatures
- Use Pydantic for data validation
- Write docstrings for public functions

```python
def click(
    self,
    element_id: str,
    *,
    wait_visible: bool = True,
    timeout: int = 10000,
) -> ActionResponse:
    """
    Click an element by its UI Bridge ID.

    Args:
        element_id: The element's data-ui-id or registered ID
        wait_visible: Wait for element to be visible before clicking
        timeout: Maximum wait time in milliseconds

    Returns:
        ActionResponse with success status and element state

    Raises:
        ElementNotFoundError: If element doesn't exist
        TimeoutError: If wait_visible times out
    """
```

### Testing

- Write tests for new features
- Maintain existing test coverage
- Use descriptive test names

```typescript
describe('useUIElement', () => {
  it('should register element with provided id', () => {
    // Test implementation
  });

  it('should update state when element changes', () => {
    // Test implementation
  });
});
```

### Documentation

- Update documentation for user-facing changes
- Add JSDoc comments for new APIs
- Include code examples where helpful
- Update README if adding new features

## Pull Request Guidelines

### Before Submitting

- [ ] Tests pass locally
- [ ] Code follows project style
- [ ] Documentation is updated
- [ ] Commit messages are clear
- [ ] No unnecessary files included

### Adding or removing a route in `UI_BRIDGE_ROUTES`

`UI_BRIDGE_ROUTES` (`packages/ui-bridge/src/server/types.ts`) is the source of
truth for the UI Bridge HTTP contract, and `qontinui-runner` must expose every
entry. A route added here with no runner handler simply 404s against a live
runner — silently, because both repos' CI can be green while it is true.

The `Runner Contract` check gates that on your PR. Run it locally first:

```bash
npm run contract:runner            # finds ../qontinui-runner automatically
npm run contract:runner -- --runner /path/to/qontinui-runner
```

It prints which runner ref it compared against — a green from a stale local
checkout is not a green against the ref CI will use, so read that line.

If it fails, there are three legitimate answers and the allow-list is only one
of them; the failure message spells out all three. In short: land the runner
handler and bump `.github/sibling-pins.conf` in this PR, or declare the runner
adaptation PR with a `coord:` dep-edge label so the check resolves that tree
instead of the pin, or — for genuinely intentional divergence — add a line to
`.github/peer-contract-baseline.conf` **with a reason**.

### PR Description

- Clearly describe what the PR does
- Reference related issues
- Include screenshots for UI changes
- List any breaking changes

### Review Process

1. Maintainers will review your PR
2. Address any requested changes
3. Once approved, your PR will be merged

## Reporting Issues

### Bug Reports

Include:

- Clear description of the bug
- Steps to reproduce
- Expected vs actual behavior
- Environment details (versions, OS, etc.)
- Minimal code sample if possible

### Feature Requests

Include:

- Problem statement or use case
- Proposed solution
- Example usage
- Alternatives considered

## Getting Help

- Check existing issues and documentation
- Ask questions in issue discussions
- Be patient and respectful

## License

UI Bridge is licensed under the **GNU Affero General Public License v3.0 or later** (`AGPL-3.0-or-later`); see [`LICENSE`](LICENSE). By contributing, you agree that your contributions are licensed under AGPL-3.0-or-later and you sign the [Contributor License Agreement](CLA.md) — which additionally grants Joshua Spinak the right to relicense your contribution (e.g. under a commercial/dual license). The CLA is retained on UI Bridge specifically because it is the embeddable library where the dual-/commercial-license lever is a real revenue path; the other qontinui apps use the DCO instead.
