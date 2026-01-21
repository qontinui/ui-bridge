---
sidebar_position: 1
---

# Python Installation

Install the UI Bridge Python client to control your React applications from Python.

## Requirements

- Python 3.9 or higher
- A running UI Bridge server

## Installation

### From PyPI

```bash
pip install ui-bridge-python
```

### With Poetry

```bash
poetry add ui-bridge-python
```

### From Source

```bash
git clone https://github.com/qontinui/ui-bridge.git
cd ui-bridge/packages/ui-bridge-python
pip install -e .
```

## Verify Installation

```python
from ui_bridge import UIBridgeClient

client = UIBridgeClient()
print(f"Client version: {client.__version__}")
```

## Dependencies

The package depends on:

- `httpx` - HTTP client
- `pydantic` - Data validation

These are installed automatically.

## Development Installation

For development with testing and linting:

```bash
pip install ui-bridge-python[dev]
```

This includes:

- `pytest` - Testing framework
- `pytest-asyncio` - Async test support
- `ruff` - Linting
- `mypy` - Type checking
