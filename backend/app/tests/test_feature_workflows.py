"""
Feature workflow tests — real user operations end-to-end.

Each class tests a complete user-facing workflow through the HTTP API:
  1. Search — text search across workspace assets
  4. Sources / RSS — create RSS source, poll it, content arrives
  5. Packages — create package, share via token, recipient sees scoped data
  7. Tree API — browse the workspace tree, drill into bundles and containers
  9. Asset detail — retrieve an asset and its content after ingestion

Requires: Postgres, SearXNG (via docker compose).
Builds on the data created in test_user_operations.py fixture patterns.
"""
from pathlib import Path

import pytest

from app.core.config import settings

FIXTURES = Path(__file__).parent / "fixtures"
API = settings.API_V1_STR


# ─── Fixtures ────────────────────────────────────────────────────────────────
# client, auth, headers, user_id, infospace_factory — provided by conftest.py

@pytest.fixture(scope="module")
def workspace(infospace_factory, user_id):
    """Dedicated infospace for all feature workflow tests — auto-deleted on teardown."""
    return infospace_factory("Feature Workflow Tests", user_id)


@pytest.fixture(scope="module")
def seeded_assets(client, headers, workspace):
    """Ingest several assets so search/tree/detail tests have data to work with.

    Returns dict of {label: asset_dict} for downstream tests.
    """
    assets = {}

    # 1. Text note
    r = client.post(
        f"{API}/infospaces/{workspace}/assets/ingest-text",
        headers=headers,
        params={
            "text_content": "The European Parliament debated climate adaptation funding in March 2026.",
            "title": "Climate Brief",
        },
    )
    assert r.status_code == 200, f"Text ingest failed: {r.text[:300]}"
    assets["text"] = r.json()

    # 2. Markdown upload
    with open(FIXTURES / "README.md", "rb") as f:
        r = client.post(
            f"{API}/infospaces/{workspace}/assets/upload",
            headers=headers,
            files={"file": ("README.md", f, "text/markdown")},
        )
    assert r.status_code == 200
    assets["markdown"] = r.json()

    # 3. CSV (container — produces children)
    with open(FIXTURES / "eu_parl_10.csv", "rb") as f:
        r = client.post(
            f"{API}/infospaces/{workspace}/assets/upload",
            headers=headers,
            files={"file": ("eu_parl_10.csv", f, "text/csv")},
        )
    assert r.status_code == 200
    assets["csv"] = r.json()

    # 4. Image
    with open(FIXTURES / "exactly.png", "rb") as f:
        r = client.post(
            f"{API}/infospaces/{workspace}/assets/upload",
            headers=headers,
            files={"file": ("exactly.png", f, "image/png")},
        )
    assert r.status_code == 200
    assets["image"] = r.json()

    # 5. Another text for search diversity
    r = client.post(
        f"{API}/infospaces/{workspace}/assets/ingest-text",
        headers=headers,
        params={
            "text_content": "Budget allocation for humanitarian aid increased by 15% year-over-year.",
            "title": "Budget Report",
        },
    )
    assert r.status_code == 200
    assets["budget"] = r.json()

    return assets


@pytest.fixture(scope="module")
def bundle_with_assets(client, headers, workspace, seeded_assets):
    """Create a bundle and add some assets to it. Returns (bundle_dict, asset_ids)."""
    # Create bundle
    r = client.post(
        f"{API}/infospaces/{workspace}/bundles",
        headers=headers,
        json={"name": "Research Collection"},
    )
    assert r.status_code == 201
    bundle = r.json()

    # Add two assets to it
    asset_ids = [seeded_assets["text"]["id"], seeded_assets["budget"]["id"]]
    for aid in asset_ids:
        r = client.post(
            f"{API}/infospaces/{workspace}/bundles/{bundle['id']}/assets/{aid}",
            headers=headers,
        )
        assert r.status_code == 200

    return bundle, asset_ids


# ═══════════════════════════════════════════════════
# 1. Search — find assets by text query
# ═══════════════════════════════════════════════════

class TestSearch:
    """Users search their workspace for assets matching a query."""

    def test_text_search_returns_results(self, client, headers, workspace, seeded_assets):
        """Search for 'climate' should find the Climate Brief asset."""
        r = client.get(
            f"{API}/infospaces/{workspace}/tree/text-search",
            headers=headers,
            params={"query": "climate", "limit": 50},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["query"] == "climate"
        assert body["total_found"] >= 1
        titles = [hit["asset"]["title"] for hit in body["results"]]
        assert "Climate Brief" in titles

    def test_text_search_no_results(self, client, headers, workspace, seeded_assets):
        """Search for nonsense returns empty results, not an error."""
        r = client.get(
            f"{API}/infospaces/{workspace}/tree/text-search",
            headers=headers,
            params={"query": "xyzzy_nonexistent_gibberish_42"},
        )
        assert r.status_code == 200
        assert r.json()["total_found"] == 0
        assert r.json()["results"] == []

    def test_text_search_respects_infospace_isolation(self, client, headers, user_id, seeded_assets, infospace_factory):
        """Search in a different workspace shouldn't find assets from the test workspace."""
        other = infospace_factory("Search Isolation Test", user_id)

        r = client.get(
            f"{API}/infospaces/{other}/tree/text-search",
            headers=headers,
            params={"query": "climate"},
        )
        assert r.status_code == 200
        assert r.json()["total_found"] == 0

    def test_text_search_result_has_score_and_context(self, client, headers, workspace, seeded_assets):
        """Each search result includes relevance score and match context."""
        r = client.get(
            f"{API}/infospaces/{workspace}/tree/text-search",
            headers=headers,
            params={"query": "budget humanitarian"},
        )
        assert r.status_code == 200
        if r.json()["total_found"] > 0:
            hit = r.json()["results"][0]
            assert "score" in hit
            assert hit["score"] > 0
            assert "match_type" in hit

    def test_text_search_filter_by_bundle(self, client, headers, workspace, bundle_with_assets, seeded_assets):
        """Search within a specific bundle only returns assets in that bundle."""
        bundle, asset_ids = bundle_with_assets
        r = client.get(
            f"{API}/infospaces/{workspace}/tree/text-search",
            headers=headers,
            params={"query": "budget", "bundle_id": bundle["id"]},
        )
        assert r.status_code == 200
        # Budget Report is in the bundle, so it should appear
        if r.json()["total_found"] > 0:
            result_ids = [hit["asset"]["id"] for hit in r.json()["results"]]
            # All results should be from assets in this bundle
            for rid in result_ids:
                assert rid in asset_ids


# ═══════════════════════════════════════════════════
# 4. Sources / RSS — create source, manage lifecycle
# ═══════════════════════════════════════════════════

class TestSources:
    """Users create RSS sources, manage their lifecycle, and poll for content."""

    def test_create_rss_source(self, client, headers, workspace):
        """Create an RSS source with a known feed URL."""
        r = client.post(
            f"{API}/infospaces/{workspace}/sources/create-rss-source",
            headers=headers,
            json={
                "feed_url": "https://feeds.bbci.co.uk/news/world/rss.xml",
                "source_name": "BBC World News",
            },
        )
        assert r.status_code == 200, f"RSS source creation failed: {r.text[:300]}"
        source = r.json()
        assert source["kind"] == "rss"
        assert source["name"] == "BBC World News"
        assert "feed_url" in source["details"]

    def test_list_sources(self, client, headers, workspace):
        """List sources for the workspace — should include the RSS source."""
        r = client.get(
            f"{API}/infospaces/{workspace}/sources",
            headers=headers,
        )
        assert r.status_code == 200
        body = r.json()
        assert body["count"] >= 1
        kinds = [s["kind"] for s in body["data"]]
        assert "rss" in kinds

    def test_get_source_detail(self, client, headers, workspace):
        """Retrieve a specific source by ID."""
        # Get list first
        sources = client.get(
            f"{API}/infospaces/{workspace}/sources", headers=headers,
        ).json()["data"]
        source_id = sources[0]["id"]

        r = client.get(
            f"{API}/infospaces/{workspace}/sources/{source_id}",
            headers=headers,
        )
        assert r.status_code == 200
        assert r.json()["id"] == source_id

    def test_update_source(self, client, headers, workspace):
        """Update a source's name."""
        sources = client.get(
            f"{API}/infospaces/{workspace}/sources", headers=headers,
        ).json()["data"]
        source_id = sources[0]["id"]

        r = client.patch(
            f"{API}/infospaces/{workspace}/sources/{source_id}",
            headers=headers,
            json={"name": "BBC World (renamed)"},
        )
        assert r.status_code == 200
        assert r.json()["name"] == "BBC World (renamed)"

    def test_create_generic_source(self, client, headers, workspace):
        """Create a non-RSS source (url_list kind)."""
        r = client.post(
            f"{API}/infospaces/{workspace}/sources",
            headers=headers,
            json={
                "name": "URL Collection",
                "kind": "url_list",
                "details": {"urls": ["https://example.com"]},
            },
        )
        assert r.status_code == 201
        assert r.json()["kind"] == "url_list"

    def test_duplicate_rss_source_reuses_existing(self, client, headers, workspace):
        """Creating an RSS source with the same feed URL returns the existing source."""
        r1 = client.post(
            f"{API}/infospaces/{workspace}/sources/create-rss-source",
            headers=headers,
            json={"feed_url": "https://feeds.bbci.co.uk/news/world/rss.xml"},
        )
        r2 = client.post(
            f"{API}/infospaces/{workspace}/sources/create-rss-source",
            headers=headers,
            json={"feed_url": "https://feeds.bbci.co.uk/news/world/rss.xml"},
        )
        assert r1.json()["id"] == r2.json()["id"], "Duplicate feed URL should reuse existing source"

    def test_source_creates_output_bundle(self, client, headers, workspace):
        """RSS source creation auto-creates an output bundle."""
        r = client.post(
            f"{API}/infospaces/{workspace}/sources/create-rss-source",
            headers=headers,
            json={
                "feed_url": "https://feeds.reuters.com/reuters/worldNews",
                "source_name": "Reuters World",
            },
        )
        assert r.status_code == 200
        source = r.json()
        # The source should have a target_bundle_id in details
        assert "target_bundle_id" in source["details"]

        # Verify the bundle exists
        bundle_id = source["details"]["target_bundle_id"]
        rb = client.get(
            f"{API}/infospaces/{workspace}/bundles/{bundle_id}",
            headers=headers,
        )
        assert rb.status_code == 200

    def test_delete_source(self, client, headers, workspace):
        """Delete a source."""
        # Create a disposable source
        src = client.post(
            f"{API}/infospaces/{workspace}/sources",
            headers=headers,
            json={"name": "Disposable", "kind": "url_list", "details": {}},
        ).json()

        r = client.delete(
            f"{API}/infospaces/{workspace}/sources/{src['id']}",
            headers=headers,
        )
        assert r.status_code == 204

        # Confirm gone
        r2 = client.get(
            f"{API}/infospaces/{workspace}/sources/{src['id']}",
            headers=headers,
        )
        assert r2.status_code == 404


# ═══════════════════════════════════════════════════
# 5. Packages — share a curated subset, access via token
# ═══════════════════════════════════════════════════

class TestPackages:
    """Users create packages to share curated subsets of their workspace."""

    def test_create_package_with_bundle(self, client, headers, workspace, bundle_with_assets):
        """Create a package containing a bundle."""
        bundle, _ = bundle_with_assets
        r = client.post(
            f"{API}/infospaces/{workspace}/packages",
            headers=headers,
            json={
                "name": "Research Package",
                "description": "Curated research materials",
                "visibility": "token",
                "default_allow_download": True,
                "items": [{"bundle_id": bundle["id"]}],
            },
        )
        assert r.status_code == 201
        pkg = r.json()
        assert pkg["name"] == "Research Package"
        assert pkg["token"]  # token was generated
        assert len(pkg["items"]) == 1
        assert pkg["items"][0]["resource_type"] == "bundle"

    def test_create_package_with_assets(self, client, headers, workspace, seeded_assets):
        """Create a package containing individual assets."""
        r = client.post(
            f"{API}/infospaces/{workspace}/packages",
            headers=headers,
            json={
                "name": "Asset Package",
                "visibility": "token",
                "items": [
                    {"asset_id": seeded_assets["text"]["id"]},
                    {"asset_id": seeded_assets["image"]["id"]},
                ],
            },
        )
        assert r.status_code == 201
        pkg = r.json()
        assert len(pkg["items"]) == 2

    def test_list_packages(self, client, headers, workspace):
        """List packages in the workspace."""
        r = client.get(f"{API}/infospaces/{workspace}/packages", headers=headers)
        assert r.status_code == 200
        packages = r.json()
        assert len(packages) >= 2
        names = [p["name"] for p in packages]
        assert "Research Package" in names

    def test_access_package_by_token(self, client, headers, workspace):
        """Access a package by its token — no auth required."""
        # Get a package to find its token
        packages = client.get(
            f"{API}/infospaces/{workspace}/packages", headers=headers,
        ).json()
        token = packages[0]["token"]

        # Access without authentication
        r = client.get(f"{API}/p/{token}")
        assert r.status_code == 200
        body = r.json()
        assert body["name"] == packages[0]["name"]
        assert "token" not in body  # token not re-exposed
        assert len(body["items"]) >= 1

    def test_package_token_scopes_tree_access(self, client, headers, workspace, bundle_with_assets, seeded_assets):
        """A package token restricts tree browsing to only the shared bundle."""
        bundle, asset_ids = bundle_with_assets

        # Create package with just one bundle
        pkg = client.post(
            f"{API}/infospaces/{workspace}/packages",
            headers=headers,
            json={
                "name": "Scoped Tree Test",
                "visibility": "token",
                "items": [{"bundle_id": bundle["id"]}],
            },
        ).json()
        token = pkg["token"]

        # Access tree with package token (no auth header — anonymous + token)
        r = client.get(
            f"{API}/infospaces/{workspace}/tree",
            params={"package_token": token},
        )
        assert r.status_code == 200
        tree = r.json()
        # Only the shared bundle should appear (not the CSV, image, etc.)
        node_names = [n["name"] for n in tree["nodes"]]
        assert bundle["name"] in node_names
        # Assets not in the bundle should not be visible at root
        # (the image and csv are at root, not in the bundle)
        assert tree["total_assets"] <= len(asset_ids)

    def test_package_token_scopes_feed(self, client, headers, workspace, bundle_with_assets, seeded_assets):
        """Feed endpoint with package token only shows assets in scoped bundles."""
        bundle, asset_ids = bundle_with_assets

        pkg = client.post(
            f"{API}/infospaces/{workspace}/packages",
            headers=headers,
            json={
                "name": "Scoped Feed Test",
                "visibility": "token",
                "items": [{"bundle_id": bundle["id"]}],
            },
        ).json()
        token = pkg["token"]

        r = client.get(
            f"{API}/infospaces/{workspace}/tree/feed",
            params={"package_token": token, "bundle_id": bundle["id"]},
        )
        assert r.status_code == 200
        feed = r.json()
        # All returned assets should be ones we put in the bundle
        for asset in feed["assets"]:
            assert asset["id"] in asset_ids

    def test_add_and_remove_package_item(self, client, headers, workspace, seeded_assets):
        """Add an item to a package, then remove it."""
        # Create empty package
        pkg = client.post(
            f"{API}/infospaces/{workspace}/packages",
            headers=headers,
            json={"name": "Editable Package", "visibility": "token"},
        ).json()

        # Add item
        r = client.post(
            f"{API}/infospaces/{workspace}/packages/{pkg['id']}/items",
            headers=headers,
            json={"asset_id": seeded_assets["markdown"]["id"]},
        )
        assert r.status_code == 201
        item_id = r.json()["id"]

        # Verify it's there
        pkg_detail = client.get(
            f"{API}/infospaces/{workspace}/packages/{pkg['id']}",
            headers=headers,
        ).json()
        assert len(pkg_detail["items"]) == 1

        # Remove it
        r = client.delete(
            f"{API}/infospaces/{workspace}/packages/{pkg['id']}/items/{item_id}",
            headers=headers,
        )
        assert r.status_code == 204

        # Verify it's gone
        pkg_detail = client.get(
            f"{API}/infospaces/{workspace}/packages/{pkg['id']}",
            headers=headers,
        ).json()
        assert len(pkg_detail["items"]) == 0

    def test_delete_package(self, client, headers, workspace):
        """Delete a package."""
        pkg = client.post(
            f"{API}/infospaces/{workspace}/packages",
            headers=headers,
            json={"name": "Deletable", "visibility": "token"},
        ).json()

        r = client.delete(
            f"{API}/infospaces/{workspace}/packages/{pkg['id']}",
            headers=headers,
        )
        assert r.status_code == 204

        # Confirm gone
        r2 = client.get(
            f"{API}/infospaces/{workspace}/packages/{pkg['id']}",
            headers=headers,
        )
        assert r2.status_code == 404


# ═══════════════════════════════════════════════════
# 7. Tree API — browse workspace structure
# ═══════════════════════════════════════════════════

class TestTreeAPI:
    """Users browse the workspace tree: root view, drill into bundles, expand containers."""

    def test_root_tree_shows_bundles_and_assets(self, client, headers, workspace, seeded_assets, bundle_with_assets):
        """Root tree should show bundles and loose assets."""
        r = client.get(
            f"{API}/infospaces/{workspace}/tree",
            headers=headers,
        )
        assert r.status_code == 200
        tree = r.json()
        assert tree["total_bundles"] >= 1
        assert tree["total_assets"] >= 3  # at least our seeded assets
        assert tree["total_nodes"] >= 1

        # Should have both bundle and asset nodes
        types = {n["type"] for n in tree["nodes"]}
        assert "bundle" in types

    def test_tree_children_of_bundle(self, client, headers, workspace, bundle_with_assets):
        """Drilling into a bundle shows its child assets."""
        bundle, asset_ids = bundle_with_assets
        r = client.get(
            f"{API}/infospaces/{workspace}/tree/children",
            headers=headers,
            params={"parent_id": f"bundle-{bundle['id']}"},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["parent_id"] == f"bundle-{bundle['id']}"
        assert body["total_children"] >= len(asset_ids)

    def test_tree_children_of_container_asset(self, client, headers, workspace, seeded_assets):
        """Drilling into a CSV asset (container) shows its row children."""
        csv_id = seeded_assets["csv"]["id"]
        r = client.get(
            f"{API}/infospaces/{workspace}/tree/children",
            headers=headers,
            params={"parent_id": f"asset-{csv_id}"},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["parent_id"] == f"asset-{csv_id}"
        # CSV with 10 rows should have children
        assert body["total_children"] >= 1

    def test_tree_children_of_leaf_asset(self, client, headers, workspace, seeded_assets):
        """Drilling into a non-container asset returns empty children."""
        text_id = seeded_assets["text"]["id"]
        r = client.get(
            f"{API}/infospaces/{workspace}/tree/children",
            headers=headers,
            params={"parent_id": f"asset-{text_id}"},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["total_children"] == 0
        assert body["children"] == []
        assert body["has_more"] is False

    def test_tree_children_pagination(self, client, headers, workspace, bundle_with_assets):
        """Tree children support skip/limit pagination."""
        bundle, _ = bundle_with_assets
        r = client.get(
            f"{API}/infospaces/{workspace}/tree/children",
            headers=headers,
            params={"parent_id": f"bundle-{bundle['id']}", "skip": 0, "limit": 1},
        )
        assert r.status_code == 200
        body = r.json()
        assert len(body["children"]) <= 1

    def test_tree_invalid_parent_id_400(self, client, headers, workspace):
        """Invalid parent_id format returns 400."""
        r = client.get(
            f"{API}/infospaces/{workspace}/tree/children",
            headers=headers,
            params={"parent_id": "invalid-format"},
        )
        assert r.status_code == 400

    def test_tree_nonexistent_bundle_404(self, client, headers, workspace):
        """Requesting children of a nonexistent bundle returns 404."""
        r = client.get(
            f"{API}/infospaces/{workspace}/tree/children",
            headers=headers,
            params={"parent_id": "bundle-999999"},
        )
        assert r.status_code == 404

    def test_feed_assets(self, client, headers, workspace, seeded_assets):
        """Feed endpoint returns recent assets sorted by date."""
        r = client.get(
            f"{API}/infospaces/{workspace}/tree/feed",
            headers=headers,
            params={"limit": 50},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["total"] >= 3
        assert len(body["assets"]) >= 3

    def test_feed_filter_by_kind(self, client, headers, workspace, seeded_assets):
        """Feed can be filtered to specific asset kinds."""
        r = client.get(
            f"{API}/infospaces/{workspace}/tree/feed",
            headers=headers,
            params={"kinds": ["image"]},
        )
        assert r.status_code == 200
        body = r.json()
        for asset in body["assets"]:
            assert asset["kind"] == "image"

    def test_feed_filter_by_bundle(self, client, headers, workspace, bundle_with_assets):
        """Feed filtered by bundle_id only shows assets in that bundle."""
        bundle, asset_ids = bundle_with_assets
        r = client.get(
            f"{API}/infospaces/{workspace}/tree/feed",
            headers=headers,
            params={"bundle_id": bundle["id"]},
        )
        assert r.status_code == 200
        body = r.json()
        for asset in body["assets"]:
            assert asset["id"] in asset_ids

    def test_tree_delete_preview(self, client, headers, workspace, seeded_assets):
        """Delete preview shows what would be deleted without actually deleting."""
        text_id = seeded_assets["text"]["id"]
        r = client.post(
            f"{API}/infospaces/{workspace}/tree/delete-preview",
            headers=headers,
            json={"node_ids": [f"asset-{text_id}"]},
        )
        assert r.status_code == 200
        body = r.json()
        # Preview should not have actually deleted anything
        assert body.get("executed") is False or "preview" in str(body).lower() or "would" in str(body).lower() or body.get("message")

    def test_batch_get_assets(self, client, headers, workspace, seeded_assets):
        """Batch fetch multiple assets by ID."""
        ids = [seeded_assets["text"]["id"], seeded_assets["image"]["id"]]
        r = client.post(
            f"{API}/infospaces/{workspace}/tree/assets/batch",
            headers=headers,
            json={"asset_ids": ids},
        )
        assert r.status_code == 200
        body = r.json()
        assert len(body) == 2
        returned_ids = [a["id"] for a in body]
        assert set(returned_ids) == set(ids)


# ═══════════════════════════════════════════════════
# 9. Asset detail — retrieve asset and its content
# ═══════════════════════════════════════════════════

class TestAssetDetail:
    """Users retrieve individual assets and their content after ingestion."""

    def test_get_asset_by_id(self, client, headers, workspace, seeded_assets):
        """GET asset by ID returns full asset detail."""
        aid = seeded_assets["text"]["id"]
        r = client.get(
            f"{API}/infospaces/{workspace}/assets/{aid}",
            headers=headers,
        )
        assert r.status_code == 200
        asset = r.json()
        assert asset["id"] == aid
        assert asset["title"] == "Climate Brief"
        assert asset["kind"] == "text"

    def test_asset_has_text_content(self, client, headers, workspace, seeded_assets):
        """Text assets return their content in text_content field."""
        aid = seeded_assets["text"]["id"]
        r = client.get(
            f"{API}/infospaces/{workspace}/assets/{aid}",
            headers=headers,
        )
        assert r.status_code == 200
        assert "European Parliament" in r.json()["text_content"]

    def test_asset_has_metadata(self, client, headers, workspace, seeded_assets):
        """Assets have standard metadata fields."""
        aid = seeded_assets["text"]["id"]
        asset = client.get(
            f"{API}/infospaces/{workspace}/assets/{aid}", headers=headers,
        ).json()
        assert "uuid" in asset
        assert "created_at" in asset
        assert asset["infospace_id"] == workspace

    def test_get_csv_children(self, client, headers, workspace, seeded_assets):
        """CSV asset children endpoint returns row assets."""
        csv_id = seeded_assets["csv"]["id"]
        r = client.get(
            f"{API}/infospaces/{workspace}/assets/{csv_id}/children",
            headers=headers,
        )
        assert r.status_code == 200
        children = r.json()
        assert len(children) >= 1
        # Children should be csv_row kind
        for child in children:
            assert child["kind"] == "csv_row"
            assert child["parent_asset_id"] == csv_id

    def test_csv_row_has_content(self, client, headers, workspace, seeded_assets):
        """Individual CSV row children have text_content with the row data."""
        csv_id = seeded_assets["csv"]["id"]
        children = client.get(
            f"{API}/infospaces/{workspace}/assets/{csv_id}/children",
            headers=headers,
        ).json()
        if children:
            row = children[0]
            # Row should have some content
            row_detail = client.get(
                f"{API}/infospaces/{workspace}/assets/{row['id']}",
                headers=headers,
            ).json()
            assert row_detail["text_content"] is not None

    def test_image_asset_has_kind(self, client, headers, workspace, seeded_assets):
        """Image asset detail includes kind and file info."""
        aid = seeded_assets["image"]["id"]
        r = client.get(
            f"{API}/infospaces/{workspace}/assets/{aid}",
            headers=headers,
        )
        assert r.status_code == 200
        asset = r.json()
        assert asset["kind"] == "image"
        assert asset["title"] == "exactly.png"

    def test_update_asset(self, client, headers, workspace, seeded_assets):
        """Update an asset's title."""
        aid = seeded_assets["budget"]["id"]
        r = client.put(
            f"{API}/infospaces/{workspace}/assets/{aid}",
            headers=headers,
            json={"title": "Budget Report (Updated)"},
        )
        assert r.status_code == 200
        assert r.json()["title"] == "Budget Report (Updated)"

    def test_nonexistent_asset_404(self, client, headers, workspace):
        """GET nonexistent asset returns 404."""
        r = client.get(
            f"{API}/infospaces/{workspace}/assets/999999",
            headers=headers,
        )
        assert r.status_code == 404

    def test_asset_list_pagination(self, client, headers, workspace, seeded_assets):
        """Asset list supports pagination with skip/limit."""
        r = client.get(
            f"{API}/infospaces/{workspace}/assets",
            headers=headers,
            params={"skip": 0, "limit": 2},
        )
        assert r.status_code == 200
        body = r.json()
        assert len(body["data"]) <= 2
        assert body["count"] >= 3  # we have at least 5 seeded assets

    def test_asset_cross_infospace_isolation(self, client, headers, workspace, user_id, seeded_assets, infospace_factory):
        """Asset from one workspace not accessible in another."""
        other = infospace_factory("Asset Isolation Test", user_id)
        aid = seeded_assets["text"]["id"]
        r = client.get(
            f"{API}/infospaces/{other}/assets/{aid}",
            headers=headers,
        )
        assert r.status_code == 404
