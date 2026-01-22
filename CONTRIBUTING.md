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

```typescript
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
```

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

By contributing to UI Bridge, you agree that your contributions will be licensed under the MIT License.
