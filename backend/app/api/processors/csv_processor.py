"""
CSV Processor
=============

Processes CSV files into row assets.
"""

import asyncio
import csv
import logging
from typing import List
from app.models import Asset, AssetKind, ProcessingStatus
from app.schemas import AssetCreate
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
        
        Args:
            asset: Parent CSV asset
            
        Returns:
            List of CSV_ROW child assets
        """
        if not self.can_process(asset):
            raise ProcessingError(f"Cannot process asset {asset.id} as CSV")
        
        # Get processing options
        delimiter = self.context.options.get('delimiter')
        encoding = self.context.options.get('encoding', 'utf-8')
        skip_rows = self.context.options.get('skip_rows', 0)
        max_rows = self.context.max_rows
        
        # Read file
        file_stream = await self.context.storage_provider.get_file(asset.blob_path)
        file_bytes = await asyncio.to_thread(file_stream.read)
        
        # Decode
        csv_text = self._decode_csv(file_bytes, encoding)
        
        # Auto-detect delimiter
        if not delimiter:
            delimiter = self._detect_delimiter(csv_text)
        
        # Parse CSV
        csv_lines = csv_text.split('\n')
        csv_reader = csv.reader(csv_lines, delimiter=delimiter)
        
        # Skip rows if requested
        for _ in range(skip_rows):
            try:
                next(csv_reader)
            except StopIteration:
                raise ProcessingError(f"CSV has fewer rows than skip_rows={skip_rows}")
        
        # Read header
        try:
            header = [h.strip() for h in next(csv_reader) if h.strip()]
        except StopIteration:
            raise ProcessingError("CSV is empty or has no header row")
        
        if not header:
            raise ProcessingError("CSV header row is empty")
        
        # Process rows
        child_assets = []
        full_text_parts = [f"CSV Headers: {' | '.join(header)}"]
        rows_processed = 0
        
        for idx, row in enumerate(csv_reader):
            if rows_processed >= max_rows:
                logger.warning(f"CSV processing stopped at {max_rows} rows limit")
                break
            
            if not any(cell.strip() for cell in row if cell):
                continue
            
            # Normalize row length
            while len(row) < len(header):
                row.append('')
            if len(row) > len(header):
                row = row[:len(header)]
            
            # Clean row data
            cleaned_row = [cell.replace('\x00', '').strip() for cell in row]
            row_data = {header[j]: cleaned_row[j] for j in range(len(header))}
            row_text = ' | '.join(cleaned_row)
            full_text_parts.append(row_text)
            
            # Generate title: {index} | {first_non_empty_cols[:25]}
            title_parts = [str(rows_processed + 1)]
            title_parts.extend(
                v[:25] + ('...' if len(v) > 25 else '')
                for v in cleaned_row[:3] if v.strip()
            )
            row_title = " | ".join(title_parts) if len(title_parts) > 1 else f"Row {rows_processed + 1}"
            
            # Create row asset
            child_asset_create = AssetCreate(
                title=row_title,
                kind=AssetKind.CSV_ROW,
                user_id=asset.user_id,
                infospace_id=asset.infospace_id,
                parent_asset_id=asset.id,
                part_index=rows_processed,
                text_content=row_text,
                source_metadata={
                    'row_number': skip_rows + rows_processed + 2,
                    'data_row_index': rows_processed,
                    'original_row_data': row_data
                }
            )
            child_assets.append(child_asset_create)
            rows_processed += 1
            
            # Yield periodically
            if rows_processed % 1000 == 0:
                await asyncio.sleep(0.01)
        
        # Update parent asset
        asset.text_content = "\n".join(full_text_parts)
        asset.source_metadata.update({
            'columns': header,
            'delimiter_used': delimiter,
            'encoding_used': encoding,
            'rows_processed': rows_processed,
            'column_count': len(header),
            'processing_options': self.context.options
        })
        
        # Save child assets
        saved_children = []
        for child_create in child_assets:
            child_asset = self.context.asset_service.create_asset(child_create)
            saved_children.append(child_asset)
        
        logger.info(f"Processed CSV: {rows_processed} rows, {len(header)} columns, created {len(saved_children)} child assets")
        return saved_children
    
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

