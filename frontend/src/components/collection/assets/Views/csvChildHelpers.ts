/**
 * Matches `csv_processor._stream_process_csv`: rows where every cell is whitespace-only are skipped
 * and never get a `csv_row` child (`if not any(cell.strip() for cell in row if cell): continue`).
 */
export function isBackendNonEmptyCsvGridRow(row: Record<string, unknown>): boolean {
  return Object.entries(row).some(
    ([key, val]) => key !== 'rowNum' && String(val ?? '').trim() !== ''
  );
}

/** `part_index` of the backend csv_row for this grid data row, or null if the row is “empty” (no child). */
export function gridDataRowIndexToPartIndex(
  rows: Record<string, unknown>[],
  dataRowIdx: number
): number | null {
  if (dataRowIdx < 0 || dataRowIdx >= rows.length) return null;
  if (!isBackendNonEmptyCsvGridRow(rows[dataRowIdx])) return null;
  let count = 0;
  for (let j = 0; j < dataRowIdx; j++) {
    if (isBackendNonEmptyCsvGridRow(rows[j])) count++;
  }
  return count;
}

/** Grid data row index for a backend `part_index` (only non-empty rows count). */
export function partIndexToGridDataRowIndex(
  rows: Record<string, unknown>[],
  partIndex: number
): number | null {
  if (!Number.isFinite(partIndex) || partIndex < 0) return null;
  let p = 0;
  for (let i = 0; i < rows.length; i++) {
    if (!isBackendNonEmptyCsvGridRow(rows[i])) continue;
    if (p === partIndex) return i;
    p++;
  }
  return null;
}
