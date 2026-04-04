#!/usr/bin/env python3
"""
Open Politics HQ — Package Explorer

This script helps you work with data exported from Open Politics HQ.
It reads manifest.json and the included CSV files to give you an overview
of the package contents. No external dependencies required.

Usage:
    python explore.py              Print package summary
    python explore.py --tree       Show resource tree
    python explore.py --verify     Verify CSV files match manifest data
    python explore.py --sqlite     Export all data to SQLite (output.db)

Learn more: https://github.com/open-politics/open-politics
"""
import csv
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).parent


def load_manifest():
    manifest_path = ROOT / "manifest.json"
    if not manifest_path.exists():
        print("Error: manifest.json not found in this directory.")
        sys.exit(1)
    with open(manifest_path, encoding="utf-8") as f:
        return json.load(f)


def cmd_summary(manifest):
    meta = manifest.get("metadata", {})
    content = manifest.get("content", {})

    print(f"Package:  {meta.get('source_entity_name', 'unnamed')}")
    print(f"Created:  {meta.get('created_at', 'unknown')}")
    print(f"Instance: {meta.get('source_instance_id', 'unknown')}")
    print(f"Format:   {meta.get('format_version', '1.0')}")
    print()

    assets = content.get("assets", [])
    runs = content.get("annotation_runs", [])
    schemas = content.get("annotation_schemas", [])
    bundles = content.get("bundles", [])

    print(f"  Assets:  {len(assets)}")
    print(f"  Runs:    {len(runs)}")
    print(f"  Schemas: {len(schemas)}")
    print(f"  Bundles: {len(bundles)}")
    print()

    # List directories with CSVs
    for dirname, label in [
        ("assets", "Assets"),
        ("analysis_results", "Analysis Results"),
        ("schemas", "Schemas"),
        ("provenance", "Provenance"),
    ]:
        d = ROOT / dirname
        if not d.exists():
            continue
        csv_files = sorted(d.glob("*.csv"))
        json_files = sorted(d.glob("*.json"))
        if csv_files or json_files:
            print(f"\n{label} ({dirname}/):")
            for f in csv_files:
                try:
                    with open(f, encoding="utf-8") as csvf:
                        reader = csv.reader(csvf)
                        header = next(reader, None)
                        row_count = sum(1 for _ in reader)
                    print(f"  {f.name}: {row_count} rows, {len(header or [])} columns")
                except Exception as e:
                    print(f"  {f.name}: (error: {e})")
            for f in json_files:
                print(f"  {f.name} ({f.stat().st_size / 1024:.1f} KB)")

    files_dir = ROOT / "files"
    if files_dir.exists():
        file_list = list(files_dir.iterdir())
        if file_list:
            total_size = sum(f.stat().st_size for f in file_list if f.is_file())
            print()
            print(f"Source files (files/): {len(file_list)} files, {total_size / 1024 / 1024:.1f} MB")


def cmd_tree(manifest):
    content = manifest.get("content", {})
    runs = content.get("annotation_runs", [])
    bundles = content.get("bundles", [])
    schemas = content.get("annotation_schemas", [])
    assets = content.get("assets", [])

    print("Package contents:")
    print()

    for run in runs:
        print(f"  [run] {run.get('name', 'unnamed')}")
        run_schemas = run.get("annotation_schemas", [])
        for s in run_schemas:
            print(f"    [schema] {s.get('name', '?')} v{s.get('version', '?')}")
        ann_count = len(run.get("annotations", []))
        asset_count = len(run.get("assets", []))
        if ann_count:
            print(f"    ({ann_count} annotations across {asset_count} assets)")

    for bundle in bundles:
        print(f"  [bundle] {bundle.get('name', 'unnamed')}")
        refs = bundle.get("asset_references", [])
        if refs:
            print(f"    ({len(refs)} assets)")

    for schema in schemas:
        print(f"  [schema] {schema.get('name', '?')} v{schema.get('version', '?')}")

    standalone = [a for a in assets if not a.get("parent_asset_id")]
    for asset in standalone[:20]:
        print(f"  [asset] {asset.get('title', 'unnamed')}")
    if len(standalone) > 20:
        print(f"  ... and {len(standalone) - 20} more assets")


def cmd_verify(manifest):
    """Verify that CSV files match manifest data (basic row count check)."""
    content = manifest.get("content", {})
    issues = []

    # Check assets/assets.csv
    assets_csv = ROOT / "assets" / "assets.csv"
    if assets_csv.exists():
        with open(assets_csv, encoding="utf-8") as f:
            row_count = sum(1 for _ in csv.reader(f)) - 1
        expected = len(content.get("assets", []))
        if row_count != expected:
            issues.append(f"assets.csv: {row_count} rows, manifest has {expected} assets")
        else:
            print(f"  assets/assets.csv: OK ({row_count} rows)")
    else:
        print("  No assets/assets.csv found.")

    # Check schemas/schemas.csv
    schemas_csv = ROOT / "schemas" / "schemas.csv"
    if schemas_csv.exists():
        with open(schemas_csv, encoding="utf-8") as f:
            row_count = sum(1 for _ in csv.reader(f)) - 1
        expected = len(content.get("annotation_schemas", []))
        if row_count != expected:
            issues.append(f"schemas.csv: {row_count} rows, manifest has {expected} schemas")
        else:
            print(f"  schemas.csv: OK ({row_count} rows)")

    if issues:
        print()
        print("Issues found:")
        for issue in issues:
            print(f"  - {issue}")
    else:
        print()
        print("All checks passed.")


def cmd_sqlite(manifest):
    """Export manifest data to a SQLite database."""
    import sqlite3

    db_path = ROOT / "output.db"
    content = manifest.get("content", {})

    conn = sqlite3.connect(str(db_path))
    cur = conn.cursor()

    # Assets table
    assets = content.get("assets", [])
    if assets:
        cur.execute("CREATE TABLE IF NOT EXISTS assets (uuid TEXT, title TEXT, kind TEXT, created_at TEXT)")
        for a in assets:
            cur.execute("INSERT INTO assets VALUES (?, ?, ?, ?)",
                        (a.get("uuid"), a.get("title"), str(a.get("kind", "")), a.get("created_at")))

    # Schemas table
    schemas = content.get("annotation_schemas", [])
    if schemas:
        cur.execute("CREATE TABLE IF NOT EXISTS schemas (uuid TEXT, name TEXT, version TEXT, description TEXT)")
        for s in schemas:
            cur.execute("INSERT INTO schemas VALUES (?, ?, ?, ?)",
                        (s.get("uuid"), s.get("name"), str(s.get("version")), s.get("description")))

    # Annotations table (from runs)
    runs = content.get("annotation_runs", [])
    if runs:
        cur.execute("""CREATE TABLE IF NOT EXISTS annotations
                       (uuid TEXT, asset_id INTEGER, schema_id INTEGER, run_id INTEGER,
                        status TEXT, value TEXT)""")
        for run in runs:
            for ann in run.get("annotations", []):
                cur.execute("INSERT INTO annotations VALUES (?, ?, ?, ?, ?, ?)",
                            (ann.get("uuid"), ann.get("asset_id"), ann.get("schema_id"),
                             ann.get("run_id"), ann.get("status"), json.dumps(ann.get("value"))))

    conn.commit()
    conn.close()
    print(f"Exported to {db_path}")


def main():
    manifest = load_manifest()

    if "--tree" in sys.argv:
        cmd_tree(manifest)
    elif "--verify" in sys.argv:
        cmd_verify(manifest)
    elif "--sqlite" in sys.argv:
        cmd_sqlite(manifest)
    else:
        cmd_summary(manifest)


if __name__ == "__main__":
    main()
