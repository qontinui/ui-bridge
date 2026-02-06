"""
UI Bridge Logging

Logging utilities for UI Bridge client operations.
"""

from __future__ import annotations

from enum import Enum
from pathlib import Path
from typing import Any

from pydantic import BaseModel


class LogLevel(str, Enum):
    """Log levels."""

    DEBUG = "debug"
    INFO = "info"
    WARN = "warn"
    ERROR = "error"


class EventType(str, Enum):
    """Event types for structured logging."""

    REQUEST_START = "request_start"
    REQUEST_COMPLETE = "request_complete"
    REQUEST_FAIL = "request_fail"
    ACTION_START = "action_start"
    ACTION_COMPLETE = "action_complete"
    ACTION_FAIL = "action_fail"
    TRACE_START = "trace_start"
    TRACE_END = "trace_end"


class TraceContext(BaseModel):
    """Trace context for correlating related operations."""

    trace_id: str
    span_id: str


class LogEntry(BaseModel):
    """A single log entry."""

    timestamp: float
    level: LogLevel
    event_type: EventType
    message: str
    data: dict[str, Any] | None = None
    trace_id: str | None = None
    span_id: str | None = None


class UIBridgeLogger:
    """Logger for UI Bridge client operations."""

    def __init__(self) -> None:
        self._enabled: bool = False
        self._level: LogLevel = LogLevel.INFO
        self._file_path: str | Path | None = None
        self._console: bool = False

    def enable(
        self,
        *,
        level: str = "info",
        file_path: str | Path | None = None,
        console: bool = False,
    ) -> None:
        """Enable logging."""
        self._enabled = True
        self._level = LogLevel(level)
        self._file_path = file_path
        self._console = console

    def disable(self) -> None:
        """Disable logging."""
        self._enabled = False

    def start_trace(self) -> TraceContext:
        """Start a new trace context."""
        import uuid

        return TraceContext(
            trace_id=uuid.uuid4().hex,
            span_id=uuid.uuid4().hex[:16],
        )

    def end_trace(self, trace_id: str) -> None:
        """End a trace."""
        pass

    def request_started(
        self,
        method: str,
        path: str,
        *,
        trace: TraceContext | None = None,
    ) -> None:
        """Log a request start."""
        pass

    def request_completed(
        self,
        method: str,
        path: str,
        *,
        status: int,
        duration_ms: float,
        trace: TraceContext | None = None,
    ) -> None:
        """Log a request completion."""
        pass

    def request_failed(
        self,
        method: str,
        path: str,
        *,
        error_message: str,
        duration_ms: float,
        trace: TraceContext | None = None,
        status: int | None = None,
    ) -> None:
        """Log a request failure."""
        pass

    def action_started(
        self,
        element_id: str,
        action: str,
        *,
        trace: TraceContext | None = None,
        params: dict[str, Any] | None = None,
    ) -> None:
        """Log an action start."""
        pass

    def action_completed(
        self,
        element_id: str,
        action: str,
        *,
        duration_ms: float,
        trace: TraceContext | None = None,
        result: Any = None,
    ) -> None:
        """Log an action completion."""
        pass

    def action_failed(
        self,
        element_id: str,
        action: str,
        *,
        error_code: str,
        error_message: str,
        duration_ms: float,
        trace: TraceContext | None = None,
    ) -> None:
        """Log an action failure."""
        pass


_default_logger: UIBridgeLogger | None = None


def get_default_logger() -> UIBridgeLogger:
    """Get or create the default logger instance."""
    global _default_logger
    if _default_logger is None:
        _default_logger = UIBridgeLogger()
    return _default_logger


def set_default_logger(logger: UIBridgeLogger) -> None:
    """Set the default logger instance."""
    global _default_logger
    _default_logger = logger
