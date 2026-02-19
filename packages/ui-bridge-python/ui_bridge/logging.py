"""
UI Bridge Logging

Logging utilities for UI Bridge client operations.
Supports JSONL file output and formatted console output.
"""

from __future__ import annotations

import sys
import time
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


# Numeric ordering for level comparison
_LEVEL_ORDER: dict[LogLevel, int] = {
    LogLevel.DEBUG: 0,
    LogLevel.INFO: 1,
    LogLevel.WARN: 2,
    LogLevel.ERROR: 3,
}


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


# Map event types to their default log levels
_EVENT_LEVELS: dict[EventType, LogLevel] = {
    EventType.REQUEST_START: LogLevel.DEBUG,
    EventType.REQUEST_COMPLETE: LogLevel.INFO,
    EventType.REQUEST_FAIL: LogLevel.ERROR,
    EventType.ACTION_START: LogLevel.DEBUG,
    EventType.ACTION_COMPLETE: LogLevel.INFO,
    EventType.ACTION_FAIL: LogLevel.ERROR,
    EventType.TRACE_START: LogLevel.DEBUG,
    EventType.TRACE_END: LogLevel.DEBUG,
}


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
    """Logger for UI Bridge client operations.

    Supports JSONL file logging and formatted console output.

    Example:
        >>> logger = UIBridgeLogger()
        >>> logger.enable(level="debug", file_path="ui-bridge.jsonl", console=True)
        >>> trace = logger.start_trace()
        >>> logger.request_started("GET", "/control/snapshot", trace=trace)
    """

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

    def _should_log(self, level: LogLevel) -> bool:
        """Check if a message at the given level should be logged."""
        if not self._enabled:
            return False
        return _LEVEL_ORDER[level] >= _LEVEL_ORDER[self._level]

    def _emit(self, entry: LogEntry) -> None:
        """Write a log entry to configured outputs."""
        if not self._should_log(entry.level):
            return

        if self._file_path is not None:
            with open(self._file_path, "a", encoding="utf-8") as f:
                f.write(entry.model_dump_json() + "\n")

        if self._console:
            level_str = entry.level.value.upper()
            duration = ""
            if entry.data and "duration_ms" in entry.data:
                duration = f" ({entry.data['duration_ms']:.1f}ms)"
            print(
                f"[{level_str}] {entry.event_type.value}: {entry.message}{duration}",
                file=sys.stderr,
            )

    def start_trace(self) -> TraceContext:
        """Start a new trace context."""
        import uuid

        trace = TraceContext(
            trace_id=uuid.uuid4().hex,
            span_id=uuid.uuid4().hex[:16],
        )
        self._emit(
            LogEntry(
                timestamp=time.time(),
                level=_EVENT_LEVELS[EventType.TRACE_START],
                event_type=EventType.TRACE_START,
                message=f"Trace started: {trace.trace_id[:8]}",
                trace_id=trace.trace_id,
                span_id=trace.span_id,
            )
        )
        return trace

    def end_trace(self, trace_id: str) -> None:
        """End a trace."""
        self._emit(
            LogEntry(
                timestamp=time.time(),
                level=_EVENT_LEVELS[EventType.TRACE_END],
                event_type=EventType.TRACE_END,
                message=f"Trace ended: {trace_id[:8]}",
                trace_id=trace_id,
            )
        )

    def request_started(
        self,
        method: str,
        path: str,
        *,
        trace: TraceContext | None = None,
    ) -> None:
        """Log a request start."""
        self._emit(
            LogEntry(
                timestamp=time.time(),
                level=_EVENT_LEVELS[EventType.REQUEST_START],
                event_type=EventType.REQUEST_START,
                message=f"{method} {path}",
                data={"method": method, "path": path},
                trace_id=trace.trace_id if trace else None,
                span_id=trace.span_id if trace else None,
            )
        )

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
        self._emit(
            LogEntry(
                timestamp=time.time(),
                level=_EVENT_LEVELS[EventType.REQUEST_COMPLETE],
                event_type=EventType.REQUEST_COMPLETE,
                message=f"{method} {path} -> {status}",
                data={
                    "method": method,
                    "path": path,
                    "status": status,
                    "duration_ms": duration_ms,
                },
                trace_id=trace.trace_id if trace else None,
                span_id=trace.span_id if trace else None,
            )
        )

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
        data: dict[str, Any] = {
            "method": method,
            "path": path,
            "error": error_message,
            "duration_ms": duration_ms,
        }
        if status is not None:
            data["status"] = status

        self._emit(
            LogEntry(
                timestamp=time.time(),
                level=_EVENT_LEVELS[EventType.REQUEST_FAIL],
                event_type=EventType.REQUEST_FAIL,
                message=f"{method} {path} FAILED: {error_message}",
                data=data,
                trace_id=trace.trace_id if trace else None,
                span_id=trace.span_id if trace else None,
            )
        )

    def action_started(
        self,
        element_id: str,
        action: str,
        *,
        trace: TraceContext | None = None,
        params: dict[str, Any] | None = None,
    ) -> None:
        """Log an action start."""
        data: dict[str, Any] = {
            "element_id": element_id,
            "action": action,
        }
        if params:
            data["params"] = params

        self._emit(
            LogEntry(
                timestamp=time.time(),
                level=_EVENT_LEVELS[EventType.ACTION_START],
                event_type=EventType.ACTION_START,
                message=f"{action} on {element_id}",
                data=data,
                trace_id=trace.trace_id if trace else None,
                span_id=trace.span_id if trace else None,
            )
        )

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
        data: dict[str, Any] = {
            "element_id": element_id,
            "action": action,
            "duration_ms": duration_ms,
        }
        if result is not None:
            data["result"] = result

        self._emit(
            LogEntry(
                timestamp=time.time(),
                level=_EVENT_LEVELS[EventType.ACTION_COMPLETE],
                event_type=EventType.ACTION_COMPLETE,
                message=f"{action} on {element_id} completed",
                data=data,
                trace_id=trace.trace_id if trace else None,
                span_id=trace.span_id if trace else None,
            )
        )

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
        self._emit(
            LogEntry(
                timestamp=time.time(),
                level=_EVENT_LEVELS[EventType.ACTION_FAIL],
                event_type=EventType.ACTION_FAIL,
                message=f"{action} on {element_id} FAILED: {error_message}",
                data={
                    "element_id": element_id,
                    "action": action,
                    "error_code": error_code,
                    "error_message": error_message,
                    "duration_ms": duration_ms,
                },
                trace_id=trace.trace_id if trace else None,
                span_id=trace.span_id if trace else None,
            )
        )


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
