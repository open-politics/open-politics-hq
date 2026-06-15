"""content cutover finalize: drop asset.logical_path; normalize Source rows

The content-domain cutover's data half (the code half landed in the same change-set):

1. ``asset.logical_path`` dies. Navigation is the bundle tree (``bundle_ids`` +
   ``parent_bundle_id``); provenance is ``source_id`` + ``source_identifier``
   (archive members already carry their position as ``source_identifier``).
   Both prefix/nav indexes go with it.

2. ``source.kind`` normalizes to the registered source-kind vocabulary
   (rss · web · web_search · upload · text · directory · crawl) and ``details``
   reshapes to that source's read-config, verbatim — the mint is then a copy.
   This mapping is the retired runtime bridge (``_source_job_spec``), preserved
   here as the one-time data conversion it always should have been. Unmappable
   kinds are deactivated + flagged WARNING for user reconfiguration.

3. Destination leaves ``details``: any ``details.target_bundle_id`` moves into
   the ``output_bundle_id`` column (when the column is empty) and the key is
   stripped.

Downgrade restores the column + indexes (values are unrecoverable) and does NOT
reverse the kind normalization — the old vocabulary has no living consumer.
"""
import json

import sqlalchemy as sa
from alembic import op

revision = "r1_content_cutover_finalize"
down_revision = "q2_add_archive_assetkind"
branch_labels = None
depends_on = None

REGISTERED = {"rss", "web", "web_search", "upload", "text", "directory", "crawl"}


def _normalize(kind: str, d: dict) -> tuple:
    """legacy (kind, details) -> (new_kind, read-config) | (None, None) if unmappable."""
    if kind in REGISTERED:
        return kind, d
    if kind == "rss_feed":
        return "rss", {k: v for k, v in {
            "feed_url": d.get("feed_url"), "max_items": d.get("max_items")}.items() if v is not None}
    if kind in ("search", "search_monitor", "news_source_monitor"):
        sc = d.get("search_config") or {}
        cfg = {"query": sc.get("query") or d.get("query"),
               "max_results": sc.get("max_results", 20)}
        return ("web_search", cfg) if cfg["query"] else (None, None)
    if kind in ("url_list", "url_list_scrape", "url_monitor"):
        urls = d.get("urls") or ([d["url"]] if d.get("url") else [])
        return ("web", {"urls": urls}) if urls else (None, None)
    if kind == "site_discovery":
        if not d.get("base_url"):
            return None, None
        return "crawl", {k: v for k, v in {
            "base_url": d.get("base_url"), "max_depth": d.get("max_depth"),
            "max_urls": d.get("max_urls")}.items() if v is not None}
    if kind in ("upload_csv", "upload_pdf"):
        if not d.get("storage_path"):
            return None, None
        return "upload", {k: v for k, v in {
            "storage_path": d.get("storage_path"), "filename": d.get("filename")}.items() if v is not None}
    if kind == "text_block_ingest":
        text_content = d.get("text_content") or d.get("text")
        return ("text", {"text": text_content}) if text_content else (None, None)
    if kind == "directory_inbox":
        path = d.get("inbox_path") or d.get("source_path") or d.get("path")
        if not path:
            return None, None
        cfg = {"path": path, "inbox_mode": True}
        if d.get("dataset_name"):
            cfg["dataset_name"] = d["dataset_name"]
        return "directory", cfg
    if kind == "directory_local":
        path = d.get("source_path") or d.get("path")
        if not path:
            return None, None
        cfg = {"path": path}
        if d.get("dataset_name"):
            cfg["dataset_name"] = d["dataset_name"]
        return "directory", cfg
    return None, None


def upgrade() -> None:
    # ── 1) logical_path dies ──
    op.execute("DROP INDEX IF EXISTS ix_asset_logical_path_prefix")
    op.execute("DROP INDEX IF EXISTS ix_asset_logical_path")
    op.drop_column("asset", "logical_path")

    # ── 2+3) Source rows normalize ──
    conn = op.get_bind()
    rows = conn.execute(sa.text(
        "SELECT id, kind, details, output_bundle_id FROM source"
    )).mappings().all()

    for r in rows:
        d = r["details"]
        if isinstance(d, str):
            d = json.loads(d or "{}")
        d = dict(d or {})

        # Destination → column, always stripped from details.
        target = d.pop("target_bundle_id", None)
        new_output = r["output_bundle_id"] or target

        new_kind, cfg = _normalize(r["kind"], d)
        if new_kind is None:
            conn.execute(sa.text(
                "UPDATE source SET details = :details, output_bundle_id = :out, "
                "is_active = false, status = 'WARNING', "
                "error_message = :msg WHERE id = :id"
            ), {
                "details": json.dumps(d),
                "out": new_output,
                "msg": f"Legacy source kind {r['kind']!r} has no registered equivalent — reconfigure this source.",
                "id": r["id"],
            })
            continue

        conn.execute(sa.text(
            "UPDATE source SET kind = :kind, details = :details, output_bundle_id = :out "
            "WHERE id = :id"
        ), {"kind": new_kind, "details": json.dumps(cfg), "out": new_output, "id": r["id"]})


def downgrade() -> None:
    op.add_column("asset", sa.Column("logical_path", sa.String(), nullable=True))
    op.create_index("ix_asset_logical_path", "asset", ["logical_path"], unique=False)
    # Values are unrecoverable; the kind normalization is one-way (the legacy
    # vocabulary has no living consumer to downgrade for).
