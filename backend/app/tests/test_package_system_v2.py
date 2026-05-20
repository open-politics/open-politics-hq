"""
Package System v2 tests.

Unit tests for serializers and CSV writers (no DB needed).
Functional tests for security fixes and tree expansion (require running backend).
"""
import csv
import io
import json
import pytest

# ─── Unit tests: CSV writers ───


class TestFlattenDict:
    def test_flat_dict(self):
        from app.api.modules.sharing.csv_writers import flatten_dict

        result = flatten_dict({"name": "John", "age": 30})
        assert result == {"name": "John", "age": 30}

    def test_nested_dict(self):
        from app.api.modules.sharing.csv_writers import flatten_dict

        result = flatten_dict({"address": {"city": "NYC", "zip": "10001"}})
        assert result == {"address.city": "NYC", "address.zip": "10001"}

    def test_simple_list(self):
        from app.api.modules.sharing.csv_writers import flatten_dict

        result = flatten_dict({"tags": ["a", "b", "c"]})
        assert result == {"tags": "a|b|c"}

    def test_list_of_dicts(self):
        from app.api.modules.sharing.csv_writers import flatten_dict

        result = flatten_dict({"items": [{"id": 1}, {"id": 2}]})
        assert result == {"items[0].id": 1, "items[1].id": 2}

    def test_empty_list(self):
        from app.api.modules.sharing.csv_writers import flatten_dict

        result = flatten_dict({"tags": []})
        assert result == {"tags": ""}

    def test_deeply_nested(self):
        from app.api.modules.sharing.csv_writers import flatten_dict

        result = flatten_dict({"a": {"b": {"c": 1}}})
        assert result == {"a.b.c": 1}

    def test_with_parent_key(self):
        from app.api.modules.sharing.csv_writers import flatten_dict

        result = flatten_dict({"field": "val"}, parent_key="value")
        assert result == {"value.field": "val"}


class TestBuildAssetsCsv:
    def test_basic(self):
        from app.api.modules.sharing.csv_writers import build_assets_csv

        assets = [
            {"uuid": "abc-123", "id": 1, "title": "Test Doc", "kind": "pdf", "created_at": "2026-01-01"},
            {"uuid": "def-456", "id": 2, "title": "Another", "kind": "csv", "created_at": "2026-01-02"},
        ]
        result = build_assets_csv(assets)
        reader = csv.DictReader(io.StringIO(result.decode("utf-8")))
        rows = list(reader)
        assert len(rows) == 2
        # Sorted alphabetically by title: "Another" before "Test Doc"
        assert rows[0]["name"] == "Another"
        assert rows[0]["kind"] == "csv"
        assert rows[1]["name"] == "Test Doc"
        assert rows[1]["kind"] == "pdf"

    def test_hierarchy(self):
        from app.api.modules.sharing.csv_writers import build_assets_csv

        assets = [
            {"uuid": "parent-1", "id": 10, "title": "EFTA00039806", "kind": "pdf",
             "blob_file_reference": "files/EFTA00039806.pdf"},
            {"uuid": "child-1", "id": 11, "title": "Page 1", "kind": "pdf_page",
             "parent_asset_id": 10, "part_index": 0},
            {"uuid": "child-2", "id": 12, "title": "Page 2", "kind": "pdf_page",
             "parent_asset_id": 10, "part_index": 1},
        ]
        result = build_assets_csv(assets)
        reader = csv.DictReader(io.StringIO(result.decode("utf-8")))
        rows = list(reader)
        assert len(rows) == 3
        assert rows[0]["name"] == "EFTA00039806"
        assert rows[0]["file"] == "files/EFTA00039806.pdf"
        assert rows[1]["name"] == "EFTA00039806.0"
        assert rows[2]["name"] == "EFTA00039806.1"
        assert rows[1]["parent_title"] == "EFTA00039806"
        assert rows[1]["parent_uuid"] == "parent-1"

    def test_source_url(self):
        from app.api.modules.sharing.csv_writers import build_assets_csv

        assets = [
            {"uuid": "art-1", "id": 1, "title": "Some Article", "kind": "article",
             "source_identifier": "https://example.com/article/123"},
        ]
        result = build_assets_csv(assets)
        reader = csv.DictReader(io.StringIO(result.decode("utf-8")))
        rows = list(reader)
        assert rows[0]["source_url"] == "https://example.com/article/123"
        assert rows[0]["file"] == ""

    def test_empty(self):
        from app.api.modules.sharing.csv_writers import build_assets_csv

        result = build_assets_csv([])
        lines = result.decode("utf-8").strip().split("\n")
        assert len(lines) == 1  # header only


class TestBuildAnnotationsCsv:
    def test_flattened(self):
        from app.api.modules.sharing.csv_writers import build_annotations_csv

        annotations = [
            {
                "uuid": "ann-1",
                "asset_id": 1,
                "schema_id": 1,
                "run_id": 1,
                "status": "SUCCESS",
                "value": {"sentiment": 0.8, "entities": ["Alice", "Bob"]},
                "asset_reference": {"title": "Doc1", "uuid": "a-1"},
            },
        ]
        result = build_annotations_csv(annotations)
        reader = csv.DictReader(io.StringIO(result.decode("utf-8")))
        rows = list(reader)
        assert len(rows) == 1
        assert rows[0]["value.sentiment"] == "0.8"
        assert rows[0]["value.entities"] == "Alice|Bob"

    def test_with_justifications(self):
        from app.api.modules.sharing.csv_writers import build_annotations_csv

        annotations = [
            {
                "uuid": "ann-1",
                "value": {"score": 5},
                "justifications": [
                    {"field_name": "score", "reasoning": "Based on analysis"},
                ],
            },
        ]
        result = build_annotations_csv(annotations, include_justifications=True)
        reader = csv.DictReader(io.StringIO(result.decode("utf-8")))
        rows = list(reader)
        assert "justifications" in rows[0]
        assert "score:Based on analysis" in rows[0]["justifications"]

    def test_empty_annotations(self):
        from app.api.modules.sharing.csv_writers import build_annotations_csv

        result = build_annotations_csv([])
        assert result == b""


class TestBuildSchemasCsv:
    def test_basic(self):
        from app.api.modules.sharing.csv_writers import build_schemas_csv

        schemas = [
            {
                "uuid": "s-1",
                "name": "Contract Analysis",
                "version": "3.1",
                "description": "Extract contract details",
                "output_contract": {
                    "properties": {
                        "parties": {"type": "array", "items": {"type": "string"}},
                        "value": {"type": "number", "description": "Total contract value"},
                    },
                    "required": ["parties"],
                },
            },
        ]
        result = build_schemas_csv(schemas)
        reader = csv.DictReader(io.StringIO(result.decode("utf-8")))
        rows = list(reader)
        # One row per schema (index), full definition is in the JSON file
        assert len(rows) == 1
        assert rows[0]["name"] == "Contract Analysis"
        assert rows[0]["field_count"] == "2"
        assert "parties" in rows[0]["fields"]
        assert "value" in rows[0]["fields"]
        assert rows[0]["schema_file"].endswith(".json")


class TestBuildLineageCsv:
    def test_basic(self):
        from app.api.modules.sharing.csv_writers import build_lineage_csv

        entries = [
            {
                "entity_type": "annotation",
                "entity_uuid": "ann-1",
                "entity_name": "Doc1",
                "action": "annotated",
                "timestamp": "2026-03-01T00:00:00",
                "source_run": "Policy Extraction",
                "source_schema": "Contract v3",
            },
        ]
        result = build_lineage_csv(entries)
        reader = csv.DictReader(io.StringIO(result.decode("utf-8")))
        rows = list(reader)
        assert len(rows) == 1
        assert rows[0]["entity_type"] == "annotation"


class TestSafeCsvFilename:
    def test_normal_name(self):
        from app.api.modules.sharing.csv_writers import safe_csv_filename

        assert safe_csv_filename("Policy Extraction__Contract v3") == "Policy_Extraction__Contract_v3.csv"

    def test_empty_name(self):
        from app.api.modules.sharing.csv_writers import safe_csv_filename

        assert safe_csv_filename("") == "unnamed.csv"

    def test_dangerous_chars(self):
        from app.api.modules.sharing.csv_writers import safe_csv_filename

        result = safe_csv_filename("../../../etc/passwd")
        assert "/" not in result
        assert ".." not in result


# ─── Functional tests (require running backend with Postgres) ───


API = None


def _api():
    global API
    if API is None:
        from app.core.config import settings
        API = settings.API_V1_STR
    return API


class TestCrossInfospaceValidation:
    """Fix 5: Verify that adding items from another infospace is rejected."""

    def test_add_item_from_wrong_infospace(self, client, headers, user_id, infospace_factory):
        iid_a = infospace_factory("Package Test A", user_id)
        iid_b = infospace_factory("Package Test B", user_id)

        # Create a package in infospace A
        pkg_r = client.post(
            f"{_api()}/infospaces/{iid_a}/packages",
            headers=headers,
            json={"name": "Test Pkg", "items": []},
        )
        assert pkg_r.status_code == 201
        pkg_id = pkg_r.json()["id"]

        # Ingest an asset into infospace B
        asset_r = client.post(
            f"{_api()}/infospaces/{iid_b}/assets/ingest-text",
            headers=headers,
            params={"text_content": "hello from B", "title": "B's asset"},
        )
        assert asset_r.status_code == 200
        asset_id = asset_r.json()["id"]

        # Try adding B's asset to A's package → should fail
        add_r = client.post(
            f"{_api()}/infospaces/{iid_a}/packages/{pkg_id}/items",
            headers=headers,
            json={"asset_id": asset_id},
        )
        assert add_r.status_code == 404, f"Expected 404, got {add_r.status_code}: {add_r.text}"
        assert "not found in this infospace" in add_r.json()["detail"].lower()


class TestPackageItemExpansion:
    """Phase 4: Verify that adding a run auto-derives schema items."""

    def test_run_derives_schemas(self, client, headers, user_id, infospace_factory):
        iid = infospace_factory("Expansion Test", user_id)

        # Create a schema
        schema_r = client.post(
            f"{_api()}/infospaces/{iid}/annotation_schemas",
            headers=headers,
            json={"name": "Test Schema", "version": "1.0", "output_contract": {"properties": {"field1": {"type": "string"}}}},
        )
        if schema_r.status_code not in (200, 201):
            pytest.skip(f"Schema creation returned {schema_r.status_code}: {schema_r.text[:200]}")
        schema_id = schema_r.json()["id"]

        # Create a bundle (run needs a target)
        bundle_r = client.post(
            f"{_api()}/infospaces/{iid}/bundles",
            headers=headers,
            json={"name": "Test Bundle"},
        )
        if bundle_r.status_code not in (200, 201):
            pytest.skip(f"Bundle creation returned {bundle_r.status_code}: {bundle_r.text[:200]}")
        bundle_id = bundle_r.json()["id"]

        # Create a run linked to this schema and bundle
        run_r = client.post(
            f"{_api()}/infospaces/{iid}/runs",
            headers=headers,
            json={"name": "Test Run", "schema_ids": [schema_id], "target_bundle_id": bundle_id},
        )
        if run_r.status_code not in (200, 201):
            pytest.skip(f"Run creation returned {run_r.status_code}: {run_r.text[:200]}")
        run_id = run_r.json()["id"]

        # Create a package with this run
        pkg_r = client.post(
            f"{_api()}/infospaces/{iid}/packages",
            headers=headers,
            json={"name": "Expansion Pkg", "items": [{"run_id": run_id}]},
        )
        assert pkg_r.status_code == 201
        items = pkg_r.json()["items"]

        # Should have the run + at least 1 derived schema
        run_items = [i for i in items if i["resource_type"] == "run"]
        schema_items = [i for i in items if i["resource_type"] == "schema"]
        assert len(run_items) >= 1
        assert len(schema_items) >= 1

        # The derived schema should point back to the run item
        derived = [i for i in schema_items if i.get("derived_from_item_id") is not None]
        assert len(derived) >= 1
        assert derived[0]["derivation_type"] == "run_schema"
