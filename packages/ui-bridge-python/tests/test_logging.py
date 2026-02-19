"""Tests for ui_bridge logging."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ui_bridge.logging import (
    LogLevel,
    TraceContext,
    UIBridgeLogger,
    get_default_logger,
    set_default_logger,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    """Read a JSONL file and return parsed entries."""
    lines = path.read_text(encoding="utf-8").strip().splitlines()
    return [json.loads(line) for line in lines]


def _make_logger(
    tmp_path: Path,
    *,
    level: str = "debug",
    console: bool = False,
    filename: str = "test.jsonl",
) -> tuple[UIBridgeLogger, Path]:
    """Create an enabled logger writing to a temp JSONL file."""
    log_file = tmp_path / filename
    logger = UIBridgeLogger()
    logger.enable(level=level, file_path=log_file, console=console)
    return logger, log_file


# ===========================================================================
# 1. Level filtering (_should_log)
# ===========================================================================


class TestLevelFiltering:
    """Tests for _should_log level filtering logic."""

    def test_disabled_logger_never_logs(self):
        logger = UIBridgeLogger()
        # Not enabled -- all levels should be suppressed.
        assert logger._should_log(LogLevel.DEBUG) is False
        assert logger._should_log(LogLevel.INFO) is False
        assert logger._should_log(LogLevel.WARN) is False
        assert logger._should_log(LogLevel.ERROR) is False

    def test_debug_level_logs_everything(self):
        logger = UIBridgeLogger()
        logger.enable(level="debug")
        assert logger._should_log(LogLevel.DEBUG) is True
        assert logger._should_log(LogLevel.INFO) is True
        assert logger._should_log(LogLevel.WARN) is True
        assert logger._should_log(LogLevel.ERROR) is True

    def test_info_level_filters_out_debug(self):
        logger = UIBridgeLogger()
        logger.enable(level="info")
        assert logger._should_log(LogLevel.DEBUG) is False
        assert logger._should_log(LogLevel.INFO) is True
        assert logger._should_log(LogLevel.WARN) is True
        assert logger._should_log(LogLevel.ERROR) is True

    def test_warn_level_filters_out_debug_and_info(self):
        logger = UIBridgeLogger()
        logger.enable(level="warn")
        assert logger._should_log(LogLevel.DEBUG) is False
        assert logger._should_log(LogLevel.INFO) is False
        assert logger._should_log(LogLevel.WARN) is True
        assert logger._should_log(LogLevel.ERROR) is True

    def test_error_level_only_logs_error(self):
        logger = UIBridgeLogger()
        logger.enable(level="error")
        assert logger._should_log(LogLevel.DEBUG) is False
        assert logger._should_log(LogLevel.INFO) is False
        assert logger._should_log(LogLevel.WARN) is False
        assert logger._should_log(LogLevel.ERROR) is True

    def test_disable_stops_logging(self):
        logger = UIBridgeLogger()
        logger.enable(level="debug")
        assert logger._should_log(LogLevel.DEBUG) is True
        logger.disable()
        assert logger._should_log(LogLevel.DEBUG) is False


# ===========================================================================
# 2. JSONL file output (_emit)
# ===========================================================================


class TestJSONLFileOutput:
    """Tests for JSONL file writing in _emit."""

    def test_entry_written_as_valid_json_line(self, tmp_path: Path):
        logger, log_file = _make_logger(tmp_path)
        logger.request_started("GET", "/snapshot")

        entries = _read_jsonl(log_file)
        assert len(entries) == 1

    def test_each_line_is_parseable_json(self, tmp_path: Path):
        logger, log_file = _make_logger(tmp_path)
        logger.request_started("GET", "/a")
        logger.request_started("POST", "/b")

        raw_lines = log_file.read_text(encoding="utf-8").strip().splitlines()
        for line in raw_lines:
            parsed = json.loads(line)
            assert isinstance(parsed, dict)

    def test_all_log_entry_fields_present(self, tmp_path: Path):
        logger, log_file = _make_logger(tmp_path)
        trace = logger.start_trace()
        logger.request_started("GET", "/snapshot", trace=trace)

        entries = _read_jsonl(log_file)
        # The second entry is the request_started (first is trace_start).
        entry = entries[1]
        assert "timestamp" in entry
        assert "level" in entry
        assert "event_type" in entry
        assert "message" in entry
        assert "data" in entry
        assert "trace_id" in entry
        assert "span_id" in entry

    def test_file_opened_in_append_mode(self, tmp_path: Path):
        logger, log_file = _make_logger(tmp_path)
        logger.request_started("GET", "/first")
        logger.request_started("GET", "/second")
        logger.request_started("GET", "/third")

        entries = _read_jsonl(log_file)
        assert len(entries) == 3

    def test_no_file_written_when_file_path_is_none(self, tmp_path: Path):
        logger = UIBridgeLogger()
        logger.enable(level="debug", file_path=None, console=False)
        logger.request_started("GET", "/test")

        # No files should be created in tmp_path.
        assert list(tmp_path.iterdir()) == []

    def test_filtered_entries_not_written(self, tmp_path: Path):
        logger, log_file = _make_logger(tmp_path, level="error")
        # request_started is DEBUG -- should be filtered out.
        logger.request_started("GET", "/snapshot")

        assert not log_file.exists() or log_file.read_text(encoding="utf-8") == ""

    def test_entry_timestamp_is_float(self, tmp_path: Path):
        logger, log_file = _make_logger(tmp_path)
        logger.request_started("GET", "/test")

        entry = _read_jsonl(log_file)[0]
        assert isinstance(entry["timestamp"], float)

    def test_entry_level_value_is_string(self, tmp_path: Path):
        logger, log_file = _make_logger(tmp_path)
        logger.request_started("GET", "/test")

        entry = _read_jsonl(log_file)[0]
        assert entry["level"] == "debug"

    def test_entry_event_type_value_is_string(self, tmp_path: Path):
        logger, log_file = _make_logger(tmp_path)
        logger.request_started("GET", "/test")

        entry = _read_jsonl(log_file)[0]
        assert entry["event_type"] == "request_start"


# ===========================================================================
# 3. Console output
# ===========================================================================


class TestConsoleOutput:
    """Tests for formatted stderr console output."""

    def test_console_output_goes_to_stderr(self, tmp_path: Path, capsys):
        logger, _ = _make_logger(tmp_path, console=True)
        logger.request_completed("GET", "/snapshot", status=200, duration_ms=42.3)

        captured = capsys.readouterr()
        assert captured.out == ""  # Nothing on stdout.
        assert "request_complete" in captured.err

    def test_console_format_level_event_message(self, tmp_path: Path, capsys):
        logger, _ = _make_logger(tmp_path, console=True)
        logger.request_started("GET", "/snapshot")

        captured = capsys.readouterr()
        line = captured.err.strip()
        # Expected: [DEBUG] request_start: GET /snapshot
        assert line.startswith("[DEBUG]")
        assert "request_start:" in line
        assert "GET /snapshot" in line

    def test_console_includes_duration_when_present(self, tmp_path: Path, capsys):
        logger, _ = _make_logger(tmp_path, console=True)
        logger.request_completed("GET", "/snapshot", status=200, duration_ms=123.4)

        captured = capsys.readouterr()
        assert "(123.4ms)" in captured.err

    def test_console_no_duration_when_absent(self, tmp_path: Path, capsys):
        logger, _ = _make_logger(tmp_path, console=True)
        logger.request_started("GET", "/snapshot")

        captured = capsys.readouterr()
        assert "ms)" not in captured.err

    def test_console_not_printed_when_disabled(self, tmp_path: Path, capsys):
        logger, _ = _make_logger(tmp_path, console=False)
        logger.request_completed("GET", "/snapshot", status=200, duration_ms=10.0)

        captured = capsys.readouterr()
        assert captured.err == ""


# ===========================================================================
# 4. start_trace / end_trace
# ===========================================================================


class TestTraceLifecycle:
    """Tests for trace start and end."""

    def test_start_trace_returns_trace_context(self, tmp_path: Path):
        logger, _ = _make_logger(tmp_path)
        trace = logger.start_trace()

        assert isinstance(trace, TraceContext)
        assert isinstance(trace.trace_id, str)
        assert isinstance(trace.span_id, str)

    def test_start_trace_ids_are_valid_hex(self, tmp_path: Path):
        logger, _ = _make_logger(tmp_path)
        trace = logger.start_trace()

        # trace_id is a full uuid4 hex (32 chars).
        int(trace.trace_id, 16)
        assert len(trace.trace_id) == 32

        # span_id is the first 16 hex chars of a uuid4.
        int(trace.span_id, 16)
        assert len(trace.span_id) == 16

    def test_start_trace_emits_trace_start_entry(self, tmp_path: Path):
        logger, log_file = _make_logger(tmp_path)
        trace = logger.start_trace()

        entries = _read_jsonl(log_file)
        assert len(entries) == 1
        assert entries[0]["event_type"] == "trace_start"
        assert entries[0]["trace_id"] == trace.trace_id
        assert entries[0]["span_id"] == trace.span_id

    def test_end_trace_emits_trace_end_entry(self, tmp_path: Path):
        logger, log_file = _make_logger(tmp_path)
        trace = logger.start_trace()
        logger.end_trace(trace.trace_id)

        entries = _read_jsonl(log_file)
        assert len(entries) == 2
        assert entries[1]["event_type"] == "trace_end"
        assert entries[1]["trace_id"] == trace.trace_id

    def test_end_trace_span_id_is_null(self, tmp_path: Path):
        """end_trace does not receive span_id, so it should be null."""
        logger, log_file = _make_logger(tmp_path)
        trace = logger.start_trace()
        logger.end_trace(trace.trace_id)

        entries = _read_jsonl(log_file)
        assert entries[1]["span_id"] is None

    def test_multiple_traces_have_unique_ids(self, tmp_path: Path):
        logger, _ = _make_logger(tmp_path)
        trace1 = logger.start_trace()
        trace2 = logger.start_trace()

        assert trace1.trace_id != trace2.trace_id
        assert trace1.span_id != trace2.span_id


# ===========================================================================
# 5. Request logging
# ===========================================================================


class TestRequestLogging:
    """Tests for request_started, request_completed, request_failed."""

    def test_request_started_emits_at_debug(self, tmp_path: Path):
        logger, log_file = _make_logger(tmp_path)
        logger.request_started("GET", "/snapshot")

        entry = _read_jsonl(log_file)[0]
        assert entry["event_type"] == "request_start"
        assert entry["level"] == "debug"
        assert entry["data"]["method"] == "GET"
        assert entry["data"]["path"] == "/snapshot"
        assert "GET /snapshot" in entry["message"]

    def test_request_started_filtered_at_info_level(self, tmp_path: Path):
        logger, log_file = _make_logger(tmp_path, level="info")
        logger.request_started("GET", "/snapshot")

        assert not log_file.exists() or log_file.read_text(encoding="utf-8") == ""

    def test_request_completed_emits_at_info(self, tmp_path: Path):
        logger, log_file = _make_logger(tmp_path)
        logger.request_completed("GET", "/snapshot", status=200, duration_ms=55.2)

        entry = _read_jsonl(log_file)[0]
        assert entry["event_type"] == "request_complete"
        assert entry["level"] == "info"
        assert entry["data"]["status"] == 200
        assert entry["data"]["duration_ms"] == 55.2
        assert "200" in entry["message"]

    def test_request_completed_passes_info_filter(self, tmp_path: Path):
        logger, log_file = _make_logger(tmp_path, level="info")
        logger.request_completed("POST", "/action", status=200, duration_ms=10.0)

        entries = _read_jsonl(log_file)
        assert len(entries) == 1

    def test_request_failed_emits_at_error(self, tmp_path: Path):
        logger, log_file = _make_logger(tmp_path)
        logger.request_failed(
            "POST",
            "/action",
            error_message="Connection refused",
            duration_ms=100.5,
        )

        entry = _read_jsonl(log_file)[0]
        assert entry["event_type"] == "request_fail"
        assert entry["level"] == "error"
        assert entry["data"]["error"] == "Connection refused"
        assert entry["data"]["duration_ms"] == 100.5
        assert "FAILED" in entry["message"]

    def test_request_failed_with_status(self, tmp_path: Path):
        logger, log_file = _make_logger(tmp_path)
        logger.request_failed(
            "GET",
            "/snapshot",
            error_message="Server error",
            duration_ms=200.0,
            status=500,
        )

        entry = _read_jsonl(log_file)[0]
        assert entry["data"]["status"] == 500

    def test_request_failed_without_status(self, tmp_path: Path):
        logger, log_file = _make_logger(tmp_path)
        logger.request_failed(
            "GET",
            "/snapshot",
            error_message="Timeout",
            duration_ms=5000.0,
        )

        entry = _read_jsonl(log_file)[0]
        assert "status" not in entry["data"]

    def test_request_failed_passes_error_filter(self, tmp_path: Path):
        """Even at error level, request_failed should be emitted."""
        logger, log_file = _make_logger(tmp_path, level="error")
        logger.request_failed(
            "GET",
            "/snapshot",
            error_message="Timeout",
            duration_ms=5000.0,
        )

        entries = _read_jsonl(log_file)
        assert len(entries) == 1


# ===========================================================================
# 6. Action logging
# ===========================================================================


class TestActionLogging:
    """Tests for action_started, action_completed, action_failed."""

    def test_action_started_emits_at_debug(self, tmp_path: Path):
        logger, log_file = _make_logger(tmp_path)
        logger.action_started("btn-1", "click")

        entry = _read_jsonl(log_file)[0]
        assert entry["event_type"] == "action_start"
        assert entry["level"] == "debug"
        assert entry["data"]["element_id"] == "btn-1"
        assert entry["data"]["action"] == "click"
        assert "click on btn-1" in entry["message"]

    def test_action_started_with_params(self, tmp_path: Path):
        logger, log_file = _make_logger(tmp_path)
        logger.action_started("input-1", "type", params={"text": "hello"})

        entry = _read_jsonl(log_file)[0]
        assert entry["data"]["params"] == {"text": "hello"}

    def test_action_started_without_params(self, tmp_path: Path):
        logger, log_file = _make_logger(tmp_path)
        logger.action_started("btn-1", "click")

        entry = _read_jsonl(log_file)[0]
        assert "params" not in entry["data"]

    def test_action_started_filtered_at_info_level(self, tmp_path: Path):
        logger, log_file = _make_logger(tmp_path, level="info")
        logger.action_started("btn-1", "click")

        assert not log_file.exists() or log_file.read_text(encoding="utf-8") == ""

    def test_action_completed_emits_at_info(self, tmp_path: Path):
        logger, log_file = _make_logger(tmp_path)
        logger.action_completed("btn-1", "click", duration_ms=25.3)

        entry = _read_jsonl(log_file)[0]
        assert entry["event_type"] == "action_complete"
        assert entry["level"] == "info"
        assert entry["data"]["duration_ms"] == 25.3
        assert "completed" in entry["message"]

    def test_action_completed_with_result(self, tmp_path: Path):
        logger, log_file = _make_logger(tmp_path)
        logger.action_completed("input-1", "type", duration_ms=10.0, result={"typed": True})

        entry = _read_jsonl(log_file)[0]
        assert entry["data"]["result"] == {"typed": True}

    def test_action_completed_without_result(self, tmp_path: Path):
        logger, log_file = _make_logger(tmp_path)
        logger.action_completed("btn-1", "click", duration_ms=5.0)

        entry = _read_jsonl(log_file)[0]
        assert "result" not in entry["data"]

    def test_action_failed_emits_at_error(self, tmp_path: Path):
        logger, log_file = _make_logger(tmp_path)
        logger.action_failed(
            "btn-1",
            "click",
            error_code="NOT_FOUND",
            error_message="Element not found",
            duration_ms=12.0,
        )

        entry = _read_jsonl(log_file)[0]
        assert entry["event_type"] == "action_fail"
        assert entry["level"] == "error"
        assert entry["data"]["error_code"] == "NOT_FOUND"
        assert entry["data"]["error_message"] == "Element not found"
        assert entry["data"]["duration_ms"] == 12.0
        assert "FAILED" in entry["message"]

    def test_action_failed_passes_error_filter(self, tmp_path: Path):
        logger, log_file = _make_logger(tmp_path, level="error")
        logger.action_failed(
            "btn-1",
            "click",
            error_code="DISABLED",
            error_message="Element is disabled",
            duration_ms=8.0,
        )

        entries = _read_jsonl(log_file)
        assert len(entries) == 1


# ===========================================================================
# 7. Trace correlation
# ===========================================================================


class TestTraceCorrelation:
    """Tests for trace_id and span_id propagation in log entries."""

    def test_trace_ids_present_when_trace_provided(self, tmp_path: Path):
        logger, log_file = _make_logger(tmp_path)
        trace = logger.start_trace()
        logger.request_started("GET", "/snapshot", trace=trace)

        entries = _read_jsonl(log_file)
        request_entry = entries[1]
        assert request_entry["trace_id"] == trace.trace_id
        assert request_entry["span_id"] == trace.span_id

    def test_trace_ids_null_when_no_trace(self, tmp_path: Path):
        logger, log_file = _make_logger(tmp_path)
        logger.request_started("GET", "/snapshot")

        entry = _read_jsonl(log_file)[0]
        assert entry["trace_id"] is None
        assert entry["span_id"] is None

    def test_request_completed_with_trace(self, tmp_path: Path):
        logger, log_file = _make_logger(tmp_path)
        trace = logger.start_trace()
        logger.request_completed("GET", "/snapshot", status=200, duration_ms=10.0, trace=trace)

        entries = _read_jsonl(log_file)
        assert entries[1]["trace_id"] == trace.trace_id
        assert entries[1]["span_id"] == trace.span_id

    def test_request_failed_with_trace(self, tmp_path: Path):
        logger, log_file = _make_logger(tmp_path)
        trace = logger.start_trace()
        logger.request_failed(
            "GET",
            "/snapshot",
            error_message="Timeout",
            duration_ms=5000.0,
            trace=trace,
        )

        entries = _read_jsonl(log_file)
        assert entries[1]["trace_id"] == trace.trace_id
        assert entries[1]["span_id"] == trace.span_id

    def test_action_started_with_trace(self, tmp_path: Path):
        logger, log_file = _make_logger(tmp_path)
        trace = logger.start_trace()
        logger.action_started("btn-1", "click", trace=trace)

        entries = _read_jsonl(log_file)
        assert entries[1]["trace_id"] == trace.trace_id
        assert entries[1]["span_id"] == trace.span_id

    def test_action_completed_with_trace(self, tmp_path: Path):
        logger, log_file = _make_logger(tmp_path)
        trace = logger.start_trace()
        logger.action_completed("btn-1", "click", duration_ms=20.0, trace=trace)

        entries = _read_jsonl(log_file)
        assert entries[1]["trace_id"] == trace.trace_id
        assert entries[1]["span_id"] == trace.span_id

    def test_action_failed_with_trace(self, tmp_path: Path):
        logger, log_file = _make_logger(tmp_path)
        trace = logger.start_trace()
        logger.action_failed(
            "btn-1",
            "click",
            error_code="NOT_FOUND",
            error_message="Element not found",
            duration_ms=5.0,
            trace=trace,
        )

        entries = _read_jsonl(log_file)
        assert entries[1]["trace_id"] == trace.trace_id
        assert entries[1]["span_id"] == trace.span_id

    def test_action_methods_without_trace(self, tmp_path: Path):
        logger, log_file = _make_logger(tmp_path)
        logger.action_started("btn-1", "click")
        logger.action_completed("btn-1", "click", duration_ms=10.0)
        logger.action_failed(
            "btn-1",
            "click",
            error_code="ERR",
            error_message="fail",
            duration_ms=1.0,
        )

        entries = _read_jsonl(log_file)
        for entry in entries:
            assert entry["trace_id"] is None
            assert entry["span_id"] is None


# ===========================================================================
# 8. get_default_logger / set_default_logger
# ===========================================================================


class TestDefaultLogger:
    """Tests for the global default logger singleton."""

    def test_get_default_logger_creates_singleton(self):
        import ui_bridge.logging as logging_mod

        # Reset the module-level singleton.
        logging_mod._default_logger = None

        logger1 = get_default_logger()
        logger2 = get_default_logger()

        assert logger1 is logger2
        assert isinstance(logger1, UIBridgeLogger)

    def test_set_default_logger_replaces_singleton(self):
        import ui_bridge.logging as logging_mod

        logging_mod._default_logger = None

        original = get_default_logger()
        replacement = UIBridgeLogger()
        set_default_logger(replacement)

        assert get_default_logger() is replacement
        assert get_default_logger() is not original

    def test_set_default_logger_then_get(self):
        import ui_bridge.logging as logging_mod

        logging_mod._default_logger = None

        custom = UIBridgeLogger()
        set_default_logger(custom)

        assert get_default_logger() is custom

    def test_get_default_logger_returns_ui_bridge_logger(self):
        import ui_bridge.logging as logging_mod

        logging_mod._default_logger = None

        logger = get_default_logger()
        assert isinstance(logger, UIBridgeLogger)


# ===========================================================================
# Integration-style tests
# ===========================================================================


class TestIntegration:
    """End-to-end scenarios combining multiple features."""

    def test_full_request_lifecycle(self, tmp_path: Path, capsys):
        logger, log_file = _make_logger(tmp_path, console=True)

        trace = logger.start_trace()
        logger.request_started("GET", "/snapshot", trace=trace)
        logger.request_completed("GET", "/snapshot", status=200, duration_ms=42.0, trace=trace)
        logger.end_trace(trace.trace_id)

        entries = _read_jsonl(log_file)
        assert len(entries) == 4
        assert entries[0]["event_type"] == "trace_start"
        assert entries[1]["event_type"] == "request_start"
        assert entries[2]["event_type"] == "request_complete"
        assert entries[3]["event_type"] == "trace_end"

        # All entries within the trace share the same trace_id.
        for entry in entries:
            assert entry["trace_id"] == trace.trace_id

        # Console output should also have been produced.
        captured = capsys.readouterr()
        assert "request_start" in captured.err
        assert "request_complete" in captured.err
        assert "(42.0ms)" in captured.err

    def test_full_action_lifecycle(self, tmp_path: Path):
        logger, log_file = _make_logger(tmp_path)

        trace = logger.start_trace()
        logger.action_started("btn-1", "click", trace=trace)
        logger.action_completed("btn-1", "click", duration_ms=15.0, trace=trace)
        logger.end_trace(trace.trace_id)

        entries = _read_jsonl(log_file)
        assert len(entries) == 4
        assert entries[0]["event_type"] == "trace_start"
        assert entries[1]["event_type"] == "action_start"
        assert entries[2]["event_type"] == "action_complete"
        assert entries[3]["event_type"] == "trace_end"

    def test_failed_action_lifecycle(self, tmp_path: Path):
        logger, log_file = _make_logger(tmp_path)

        trace = logger.start_trace()
        logger.action_started("input-1", "type", trace=trace, params={"text": "hello"})
        logger.action_failed(
            "input-1",
            "type",
            error_code="DISABLED",
            error_message="Element is disabled",
            duration_ms=3.0,
            trace=trace,
        )
        logger.end_trace(trace.trace_id)

        entries = _read_jsonl(log_file)
        assert len(entries) == 4
        assert entries[2]["event_type"] == "action_fail"
        assert entries[2]["data"]["error_code"] == "DISABLED"

    def test_level_filtering_mixed_events(self, tmp_path: Path):
        """At INFO level, DEBUG events are dropped but INFO+ are kept."""
        logger, log_file = _make_logger(tmp_path, level="info")

        # These are DEBUG -> should be filtered.
        logger.request_started("GET", "/snapshot")
        logger.action_started("btn-1", "click")

        # These are INFO -> should pass.
        logger.request_completed("GET", "/snapshot", status=200, duration_ms=10.0)
        logger.action_completed("btn-1", "click", duration_ms=5.0)

        # This is ERROR -> should pass.
        logger.request_failed(
            "POST",
            "/action",
            error_message="fail",
            duration_ms=1.0,
        )

        entries = _read_jsonl(log_file)
        assert len(entries) == 3
        event_types = [e["event_type"] for e in entries]
        assert "request_start" not in event_types
        assert "action_start" not in event_types
        assert "request_complete" in event_types
        assert "action_complete" in event_types
        assert "request_fail" in event_types
