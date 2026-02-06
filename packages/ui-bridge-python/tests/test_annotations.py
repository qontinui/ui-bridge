"""Tests for annotation types and AnnotationControl client."""

from unittest.mock import MagicMock, patch

import httpx
import pytest

from ui_bridge.client import UIBridgeClient

# Import directly from submodules to avoid __init__.py which imports
# modules that may not exist yet (states, ai_types, recovery_types).
from ui_bridge.types import (
    AnnotationConfig,
    AnnotationCoverage,
    ElementAnnotation,
)

# ============================================================================
# Pydantic Model Tests
# ============================================================================


class TestElementAnnotation:
    """Tests for ElementAnnotation Pydantic model."""

    def test_serialize_camel_case_aliases(self):
        """related_elements -> relatedElements, updated_at -> updatedAt in output."""
        annotation = ElementAnnotation(
            description="Submit button",
            related_elements=["btn-cancel", "form-1"],
            updated_at=1700000000,
        )
        dumped = annotation.model_dump(by_alias=True)
        assert "relatedElements" in dumped
        assert "updatedAt" in dumped
        assert dumped["relatedElements"] == ["btn-cancel", "form-1"]
        assert dumped["updatedAt"] == 1700000000

    def test_deserialize_from_camel_case(self):
        """Model can be constructed from camelCase JSON."""
        data = {
            "description": "Email input",
            "purpose": "User login",
            "relatedElements": ["label-email"],
            "updatedAt": 1700000001,
            "author": "test-user",
        }
        annotation = ElementAnnotation.model_validate(data)
        assert annotation.description == "Email input"
        assert annotation.purpose == "User login"
        assert annotation.related_elements == ["label-email"]
        assert annotation.updated_at == 1700000001
        assert annotation.author == "test-user"

    def test_optional_fields_default_to_none(self):
        """All fields are optional and default to None."""
        annotation = ElementAnnotation()
        assert annotation.description is None
        assert annotation.purpose is None
        assert annotation.notes is None
        assert annotation.tags is None
        assert annotation.related_elements is None
        assert annotation.metadata is None
        assert annotation.updated_at is None
        assert annotation.author is None

    def test_roundtrip_via_alias(self):
        """Serialize with aliases and deserialize back."""
        original = ElementAnnotation(
            description="A button",
            purpose="Submit form",
            notes="Primary action",
            tags=["primary", "action"],
            related_elements=["input-1"],
            metadata={"priority": 1},
            updated_at=1700000002,
            author="alice",
        )
        dumped = original.model_dump(by_alias=True, exclude_none=True)
        restored = ElementAnnotation.model_validate(dumped)
        assert restored.description == original.description
        assert restored.purpose == original.purpose
        assert restored.notes == original.notes
        assert restored.tags == original.tags
        assert restored.related_elements == original.related_elements
        assert restored.metadata == original.metadata
        assert restored.updated_at == original.updated_at
        assert restored.author == original.author

    def test_exclude_none_on_dump(self):
        """exclude_none removes unset optional fields."""
        annotation = ElementAnnotation(description="Only desc")
        dumped = annotation.model_dump(by_alias=True, exclude_none=True)
        assert dumped == {"description": "Only desc"}


class TestAnnotationConfig:
    """Tests for AnnotationConfig Pydantic model."""

    def test_roundtrip(self):
        """Config roundtrips correctly through dump and validate."""
        config = AnnotationConfig(
            version="1.0",
            annotations={
                "btn-1": ElementAnnotation(description="Submit"),
                "input-1": ElementAnnotation(
                    description="Email",
                    related_elements=["label-email"],
                ),
            },
            metadata={"exported_by": "test"},
        )
        dumped = config.model_dump(by_alias=True, exclude_none=True)
        restored = AnnotationConfig.model_validate(dumped)
        assert restored.version == "1.0"
        assert len(restored.annotations) == 2
        assert restored.annotations["btn-1"].description == "Submit"
        assert restored.annotations["input-1"].related_elements == ["label-email"]
        assert restored.metadata == {"exported_by": "test"}

    def test_optional_metadata_defaults_to_none(self):
        config = AnnotationConfig(
            version="1.0",
            annotations={},
        )
        assert config.metadata is None


class TestAnnotationCoverage:
    """Tests for AnnotationCoverage Pydantic model."""

    def test_parse_from_camel_case(self):
        """AnnotationCoverage parses correctly from camelCase input."""
        data = {
            "totalElements": 20,
            "annotatedElements": 5,
            "coveragePercent": 25.0,
            "annotatedIds": ["btn-1", "input-1", "form-1", "link-1", "select-1"],
            "unannotatedIds": ["div-1", "span-1"],
            "timestamp": 1700000003,
        }
        coverage = AnnotationCoverage.model_validate(data)
        assert coverage.total_elements == 20
        assert coverage.annotated_elements == 5
        assert coverage.coverage_percent == 25.0
        assert len(coverage.annotated_ids) == 5
        assert len(coverage.unannotated_ids) == 2
        assert coverage.timestamp == 1700000003

    def test_serialize_with_aliases(self):
        coverage = AnnotationCoverage(
            total_elements=10,
            annotated_elements=3,
            coverage_percent=30.0,
            annotated_ids=["a", "b", "c"],
            unannotated_ids=["d", "e"],
            timestamp=1700000004,
        )
        dumped = coverage.model_dump(by_alias=True)
        assert "totalElements" in dumped
        assert "annotatedElements" in dumped
        assert "coveragePercent" in dumped
        assert "annotatedIds" in dumped
        assert "unannotatedIds" in dumped


# ============================================================================
# AnnotationControl Client Tests (mocked HTTP)
# ============================================================================


class TestAnnotationControlGet:
    """Tests for AnnotationControl.get()."""

    @pytest.fixture
    def client(self):
        return UIBridgeClient(base_url="http://localhost:9876")

    @pytest.fixture
    def mock_response(self):
        response = MagicMock(spec=httpx.Response)
        response.status_code = 200
        response.raise_for_status = MagicMock()
        return response

    def test_get_calls_correct_endpoint(self, client, mock_response):
        """get() calls GET /annotations/{id} and returns ElementAnnotation."""
        mock_response.json.return_value = {
            "success": True,
            "data": {
                "description": "Submit button",
                "purpose": "Form submission",
                "relatedElements": ["form-1"],
                "updatedAt": 1700000000,
            },
        }

        with patch.object(client._client, "request", return_value=mock_response) as mock_req:
            result = client.annotations.get("btn-1")

            # Verify correct HTTP method and URL
            call_args = mock_req.call_args
            assert call_args[0][0] == "GET"
            assert "/annotations/btn-1" in call_args[0][1]

        assert isinstance(result, ElementAnnotation)
        assert result.description == "Submit button"
        assert result.purpose == "Form submission"
        assert result.related_elements == ["form-1"]
        assert result.updated_at == 1700000000


class TestAnnotationControlSet:
    """Tests for AnnotationControl.set()."""

    @pytest.fixture
    def client(self):
        return UIBridgeClient(base_url="http://localhost:9876")

    @pytest.fixture
    def mock_response(self):
        response = MagicMock(spec=httpx.Response)
        response.status_code = 200
        response.raise_for_status = MagicMock()
        return response

    def test_set_calls_correct_endpoint(self, client, mock_response):
        """set() calls PUT /annotations/{id} with correct serialized body."""
        mock_response.json.return_value = {
            "success": True,
            "data": {
                "description": "Submit button",
                "updatedAt": 1700000001,
            },
        }

        annotation = ElementAnnotation(
            description="Submit button",
            related_elements=["form-1"],
        )

        with patch.object(client._client, "request", return_value=mock_response) as mock_req:
            result = client.annotations.set("btn-1", annotation)

            call_args = mock_req.call_args
            assert call_args[0][0] == "PUT"
            assert "/annotations/btn-1" in call_args[0][1]

            # Verify the body uses camelCase aliases
            sent_json = call_args[1]["json"]
            assert sent_json["description"] == "Submit button"
            assert sent_json["relatedElements"] == ["form-1"]
            # None fields should be excluded
            assert "purpose" not in sent_json
            assert "notes" not in sent_json

        assert isinstance(result, ElementAnnotation)
        assert result.description == "Submit button"


class TestAnnotationControlDelete:
    """Tests for AnnotationControl.delete()."""

    @pytest.fixture
    def client(self):
        return UIBridgeClient(base_url="http://localhost:9876")

    @pytest.fixture
    def mock_response(self):
        response = MagicMock(spec=httpx.Response)
        response.status_code = 200
        response.raise_for_status = MagicMock()
        return response

    def test_delete_calls_correct_endpoint(self, client, mock_response):
        """delete() calls DELETE /annotations/{id}."""
        mock_response.json.return_value = {
            "success": True,
            "data": None,
        }

        with patch.object(client._client, "request", return_value=mock_response) as mock_req:
            client.annotations.delete("btn-1")

            call_args = mock_req.call_args
            assert call_args[0][0] == "DELETE"
            assert "/annotations/btn-1" in call_args[0][1]


class TestAnnotationControlList:
    """Tests for AnnotationControl.list()."""

    @pytest.fixture
    def client(self):
        return UIBridgeClient(base_url="http://localhost:9876")

    @pytest.fixture
    def mock_response(self):
        response = MagicMock(spec=httpx.Response)
        response.status_code = 200
        response.raise_for_status = MagicMock()
        return response

    def test_list_calls_correct_endpoint(self, client, mock_response):
        """list() calls GET /annotations and returns dict of annotations."""
        mock_response.json.return_value = {
            "success": True,
            "data": {
                "btn-1": {
                    "description": "Submit button",
                    "updatedAt": 1700000000,
                },
                "input-1": {
                    "description": "Email input",
                    "relatedElements": ["label-email"],
                },
            },
        }

        with patch.object(client._client, "request", return_value=mock_response) as mock_req:
            result = client.annotations.list()

            call_args = mock_req.call_args
            assert call_args[0][0] == "GET"
            assert call_args[0][1].endswith("/annotations")

        assert isinstance(result, dict)
        assert len(result) == 2
        assert isinstance(result["btn-1"], ElementAnnotation)
        assert result["btn-1"].description == "Submit button"
        assert result["btn-1"].updated_at == 1700000000
        assert isinstance(result["input-1"], ElementAnnotation)
        assert result["input-1"].related_elements == ["label-email"]


class TestAnnotationControlExportConfig:
    """Tests for AnnotationControl.export_config()."""

    @pytest.fixture
    def client(self):
        return UIBridgeClient(base_url="http://localhost:9876")

    @pytest.fixture
    def mock_response(self):
        response = MagicMock(spec=httpx.Response)
        response.status_code = 200
        response.raise_for_status = MagicMock()
        return response

    def test_export_config_calls_correct_endpoint(self, client, mock_response):
        """export_config() calls GET /annotations/export and returns AnnotationConfig."""
        mock_response.json.return_value = {
            "success": True,
            "data": {
                "version": "1.0",
                "annotations": {
                    "btn-1": {"description": "Submit"},
                },
                "metadata": {"exported_at": 1700000000},
            },
        }

        with patch.object(client._client, "request", return_value=mock_response) as mock_req:
            result = client.annotations.export_config()

            call_args = mock_req.call_args
            assert call_args[0][0] == "GET"
            assert "/annotations/export" in call_args[0][1]

        assert isinstance(result, AnnotationConfig)
        assert result.version == "1.0"
        assert len(result.annotations) == 1
        assert result.annotations["btn-1"].description == "Submit"
        assert result.metadata == {"exported_at": 1700000000}


class TestAnnotationControlImportConfig:
    """Tests for AnnotationControl.import_config()."""

    @pytest.fixture
    def client(self):
        return UIBridgeClient(base_url="http://localhost:9876")

    @pytest.fixture
    def mock_response(self):
        response = MagicMock(spec=httpx.Response)
        response.status_code = 200
        response.raise_for_status = MagicMock()
        return response

    def test_import_config_calls_correct_endpoint(self, client, mock_response):
        """import_config() calls POST /annotations/import with serialized config."""
        mock_response.json.return_value = {
            "success": True,
            "data": {"count": 2},
        }

        config = AnnotationConfig(
            version="1.0",
            annotations={
                "btn-1": ElementAnnotation(description="Submit"),
                "input-1": ElementAnnotation(
                    description="Email",
                    related_elements=["label-email"],
                ),
            },
        )

        with patch.object(client._client, "request", return_value=mock_response) as mock_req:
            result = client.annotations.import_config(config)

            call_args = mock_req.call_args
            assert call_args[0][0] == "POST"
            assert "/annotations/import" in call_args[0][1]

            # Verify the body uses camelCase aliases
            sent_json = call_args[1]["json"]
            assert sent_json["version"] == "1.0"
            assert "btn-1" in sent_json["annotations"]
            assert "input-1" in sent_json["annotations"]
            # Check nested annotation uses alias
            input_ann = sent_json["annotations"]["input-1"]
            assert input_ann["relatedElements"] == ["label-email"]

        assert result == 2


class TestAnnotationControlCoverage:
    """Tests for AnnotationControl.coverage()."""

    @pytest.fixture
    def client(self):
        return UIBridgeClient(base_url="http://localhost:9876")

    @pytest.fixture
    def mock_response(self):
        response = MagicMock(spec=httpx.Response)
        response.status_code = 200
        response.raise_for_status = MagicMock()
        return response

    def test_coverage_calls_correct_endpoint(self, client, mock_response):
        """coverage() calls GET /annotations/coverage and returns AnnotationCoverage."""
        mock_response.json.return_value = {
            "success": True,
            "data": {
                "totalElements": 15,
                "annotatedElements": 3,
                "coveragePercent": 20.0,
                "annotatedIds": ["btn-1", "input-1", "form-1"],
                "unannotatedIds": ["div-1", "span-1"],
                "timestamp": 1700000005,
            },
        }

        with patch.object(client._client, "request", return_value=mock_response) as mock_req:
            result = client.annotations.coverage()

            call_args = mock_req.call_args
            assert call_args[0][0] == "GET"
            assert "/annotations/coverage" in call_args[0][1]

        assert isinstance(result, AnnotationCoverage)
        assert result.total_elements == 15
        assert result.annotated_elements == 3
        assert result.coverage_percent == 20.0
        assert result.annotated_ids == ["btn-1", "input-1", "form-1"]
        assert result.unannotated_ids == ["div-1", "span-1"]
        assert result.timestamp == 1700000005
