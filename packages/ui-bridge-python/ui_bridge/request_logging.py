"""
Request logging shared by the sync and async clients.

``UIBridgeClient`` and ``AsyncUIBridgeClient`` differ only in whether they
await the transport. Every logging decision for ``_request`` and
``_request_envelope`` lives here, so the two clients cannot drift apart.
"""

from __future__ import annotations

from typing import Any

from .logging import TraceContext, UIBridgeLogger


class RequestLog:
    """The logging for one request. Every method is a no-op without a logger."""

    def __init__(
        self,
        logger: UIBridgeLogger | None,
        trace: TraceContext | None,
        method: str,
        path: str,
    ) -> None:
        self._logger = logger
        self._trace = trace
        self._method = method
        self._path = path

    def started(self) -> None:
        if self._logger:
            self._logger.request_started(self._method, self._path, trace=self._trace)

    def completed(self, *, status: int, duration_ms: float) -> None:
        if self._logger:
            self._logger.request_completed(
                self._method,
                self._path,
                status=status,
                duration_ms=duration_ms,
                trace=self._trace,
            )

    def failed(self, *, error_message: str, duration_ms: float, status: int | None = None) -> None:
        if self._logger:
            self._logger.request_failed(
                self._method,
                self._path,
                error_message=error_message,
                duration_ms=duration_ms,
                trace=self._trace,
                status=status,
            )

    def envelope_answer(self, *, status: int, body: Any, duration_ms: float) -> None:
        """Log an answer ``_request_envelope`` returns without raising.

        A 2xx JSON object that is not an explicit ``success: false`` is a
        completion; anything else is a failure, carrying the body's ``error``
        when it has one, else the HTTP status.
        """
        is_success_status = 200 <= status < 300
        if is_success_status and isinstance(body, dict) and body.get("success") is not False:
            self.completed(status=status, duration_ms=duration_ms)
            return
        error = body.get("error") if isinstance(body, dict) else None
        self.failed(
            error_message=str(error) if error is not None else f"HTTP {status}",
            duration_ms=duration_ms,
            status=status,
        )
