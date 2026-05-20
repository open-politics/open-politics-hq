"""
CSV Processor
=============

Processes CSV files into row assets.
Streams file reads to avoid loading entire file into memory.
"""

import asyncio
import csv
import io
import logging
from typing import Any, Dict, Iterator, List, Optional, Tuple
from app.api.modules.content.models import Asset, AssetKind, ProcessingStatus
from app.api.modules.content.services.asset_builder import AssetBuilder
from .base import BaseProcessor, ProcessingError

logger = logging.getLogger(__name__)


class CSVProcessor(BaseProcessor):
    """
    Process single-sheet CSV files.
    
    Creates child assets for each row in the CSV.
    """
    
    def can_process(self, asset: Asset) -> bool:
        """Check if asset is a processable CSV."""
        return (
            asset.kind == AssetKind.CSV and
            asset.blob_path is not None and
            not asset.blob_path.endswith(('.xlsx', '.xls'))
        )
    
    async def process(self, asset: Asset) -> List[Asset]:
        """
        Process CSV file and create row assets.

        Parses the CSV, updates parent summary, and batch-inserts row children
        through AssetBuilder.build_children (flush-only — caller owns commit).

        Args:
            asset: Parent CSV asset

        Returns:
            List of CSV_ROW child assets (flushed to session)
        """
        if not self.can_process(asset):
            raise ProcessingError(f"Cannot process asset {asset.id} as CSV")

        child_assets, summary = await self._extract_child_assets(asset)
        self._apply_summary_to_parent(asset, summary)

        if child_assets:
            builder = AssetBuilder(self.context.session, asset.user_id, asset.infospace_id)
            await builder.build_children(asset.id, child_assets)

        logger.info(
            f"Processed CSV: {summary['rows_processed']} rows, "
            f"{len(summary['header'])} columns, created {len(child_assets)} child assets"
        )
        return child_assets

    async def _extract_child_assets(
        self, asset: Asset,
    ) -> Tuple[List[Asset], Dict[str, Any]]:
        """Parse CSV → (child Asset blueprints, summary dict). Does NOT insert.

        Used by `process()` (which then inserts via build_children) and by
        `CsvMaterializer.reprocess_preserving_children` (which diffs against
        existing rows instead of inserting). The CSV file is read via the
        storage provider; the parse itself is off-thread.
        """
        delimiter = self.context.options.get('delimiter')
        encoding = self.context.options.get('encoding', 'utf-8')
        skip_rows = self.context.options.get('skip_rows', 0)
        max_rows = self.context.max_rows

        from app.api.modules.content.storage_access import read_to_path
        storage = self.context.storage_provider
        file_path, is_temp = await read_to_path(storage, asset.blob_path)
        try:
            result = await asyncio.to_thread(
                self._process_csv_stream_from_path,
                file_path, asset, encoding, delimiter, skip_rows, max_rows,
            )
        finally:
            if is_temp:
                try: file_path.unlink()
                except OSError: pass

        summary = {
            "full_text_parts": result["full_text_parts"],
            "header": result["header"],
            "delimiter": result["delimiter"],
            "encoding": encoding,
            "rows_processed": result["rows_processed"],
        }
        return result["child_assets"], summary

    def _apply_summary_to_parent(self, asset: Asset, summary: Dict[str, Any]) -> None:
        """Write parse summary back onto the parent CSV asset (text + file_info)."""
        asset.text_content = "\n".join(summary["full_text_parts"])
        file_info = asset.file_info or {}
        file_info.update({
            'columns': summary["header"],
            'delimiter_used': summary["delimiter"],
            'encoding_used': summary["encoding"],
            'rows_processed': summary["rows_processed"],
            'column_count': len(summary["header"]),
            'processing_options': self.context.options,
        })
        asset.file_info = file_info

    def _process_csv_stream_from_path(
        self,
        file_path,
        asset: Asset,
        encoding: str,
        delimiter: Optional[str],
        skip_rows: int,
        max_rows: int,
    ) -> dict:
        """Stream CSV from local file path (zero-copy, no full load)."""
        enc = self._resolve_encoding_for_path(file_path, encoding)
        with open(file_path, "r", encoding=enc) as f:
            return self._stream_process_csv(f, asset, enc, delimiter, skip_rows, max_rows)

    def _process_csv_stream_from_file(
        self,
        file_stream,
        asset: Asset,
        encoding: str,
        delimiter: Optional[str],
        skip_rows: int,
        max_rows: int,
    ) -> dict:
        """Stream CSV from file-like object (binary stream). Falls back to provided encoding."""
        text_stream = io.TextIOWrapper(file_stream, encoding=encoding)
        try:
            return self._stream_process_csv(
                text_stream, asset, encoding, delimiter, skip_rows, max_rows
            )
        finally:
            try:
                text_stream.detach()
            except (ValueError, AttributeError):
                pass

    def _resolve_encoding_for_path(self, file_path, encoding: str) -> str:
        """Try opening path with given encoding; fall back to common encodings."""
        for enc in [encoding, "utf-8", "latin1", "cp1252"]:
            try:
                with open(file_path, "r", encoding=enc) as f:
                    f.read(1)
                return enc
            except (UnicodeDecodeError, OSError):
                continue
        raise ProcessingError("Could not decode CSV file with any common encoding")

    def _stream_process_csv(
        self,
        text_stream,
        asset: Asset,
        encoding: str,
        delimiter: Optional[str],
        skip_rows: int,
        max_rows: int,
    ) -> dict:
        """Process CSV from text stream (iterator of lines)."""
        lines = []
        for i in range(50):
            line = text_stream.readline()
            if not line:
                break
            lines.append(line)
        sample_text = "".join(lines)
        if not delimiter:
            delimiter = self._detect_delimiter(sample_text)

        def line_iter() -> Iterator[str]:
            for line in lines:
                yield line
            while True:
                line = text_stream.readline()
                if not line:
                    break
                yield line

        csv_reader = csv.reader(line_iter(), delimiter=delimiter)
        for _ in range(skip_rows):
            try:
                next(csv_reader)
            except StopIteration:
                raise ProcessingError(f"CSV has fewer rows than skip_rows={skip_rows}")
        try:
            header = [h.strip() for h in next(csv_reader) if h.strip()]
        except StopIteration:
            raise ProcessingError("CSV is empty or has no header row")
        if not header:
            raise ProcessingError("CSV header row is empty")

        child_assets = []
        full_text_parts = [f"CSV Headers: {' | '.join(header)}"]
        rows_processed = 0

        for row in csv_reader:
            if rows_processed >= max_rows:
                logger.warning(f"CSV processing stopped at {max_rows} rows limit")
                break
            if not any(cell.strip() for cell in row if cell):
                continue
            while len(row) < len(header):
                row.append("")
            if len(row) > len(header):
                row = row[: len(header)]
            cleaned_row = [cell.replace("\x00", "").strip() for cell in row]
            row_data = {header[j]: cleaned_row[j] for j in range(len(header))}
            row_text = " | ".join(cleaned_row)
            full_text_parts.append(row_text)
            title_parts = [str(rows_processed + 1)]
            title_parts.extend(
                v[:25] + ("..." if len(v) > 25 else "")
                for v in cleaned_row[:3]
                if v.strip()
            )
            row_title = " | ".join(title_parts) if len(title_parts) > 1 else f"Row {rows_processed + 1}"
            child_assets.append(
                Asset(
                    title=row_title,
                    kind=AssetKind.CSV_ROW,
                    user_id=asset.user_id,
                    infospace_id=asset.infospace_id,
                    part_index=rows_processed,
                    text_content=row_text,
                    processing_status=ProcessingStatus.READY,
                    file_info={
                        "row_number": skip_rows + rows_processed + 2,
                        "data_row_index": rows_processed,
                        "original_row_data": row_data,
                    },
                )
            )
            rows_processed += 1

        return {
            "child_assets": child_assets,
            "full_text_parts": full_text_parts,
            "header": header,
            "delimiter": delimiter,
            "rows_processed": rows_processed,
        }

    def _decode_csv(self, file_bytes: bytes, encoding: str) -> str:
        """Decode CSV bytes with fallback encodings."""
        try:
            return file_bytes.decode(encoding, errors='replace')
        except UnicodeDecodeError:
            for fallback in ['utf-8', 'latin1', 'cp1252']:
                try:
                    return file_bytes.decode(fallback, errors='replace')
                except UnicodeDecodeError:
                    continue
            raise ProcessingError("Could not decode CSV file with any common encoding")
    
    def _detect_delimiter(self, csv_text: str) -> str:
        """Auto-detect CSV delimiter with improved heuristics."""
        lines = [line for line in csv_text.split('\n')[:20] if line.strip()]
        
        if len(lines) < 2:
            return ','
        
        try:
            sample = '\n'.join(lines[:10])
            sniffer = csv.Sniffer()
            dialect = sniffer.sniff(sample, delimiters=',;\t|')
            
            test_reader = csv.reader(lines[:5], delimiter=dialect.delimiter)
            field_counts = [len(row) for row in test_reader if row]
            
            if len(field_counts) >= 2:
                variance = max(field_counts) - min(field_counts)
                avg_fields = sum(field_counts) / len(field_counts)
                
                if avg_fields > 1 and variance <= max(2, avg_fields * 0.2):
                    return dialect.delimiter
        except:
            pass
        
        # Try each candidate delimiter
        candidates = [',', ';', '\t', '|']
        best_delimiter = ','
        best_score = 0
        
        for delimiter in candidates:
            try:
                reader = csv.reader(lines[:10], delimiter=delimiter)
                field_counts = [len(row) for row in reader if row]
                
                if len(field_counts) >= 2:
                    avg_fields = sum(field_counts) / len(field_counts)
                    consistency = 1.0 / (1.0 + (max(field_counts) - min(field_counts)))
                    score = consistency * 0.7 + min(avg_fields / 10.0, 1.0) * 0.3
                    
                    if score > best_score and avg_fields > 1:
                        best_score = score
                        best_delimiter = delimiter
            except:
                continue
        
        return best_delimiter