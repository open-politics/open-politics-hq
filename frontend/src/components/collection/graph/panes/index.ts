/**
 * The panel spine.
 *
 * Five components where there were twelve:
 *
 * ```
 *   <QueryBar>    draft · tier pills · ✨ · amber validation
 *   <Pane>        name · link toggle · own bar when unlinked
 *   <Surface>     router on (fold arity, key kinds) → 5 pure renderers
 *   <Value>       a value WITH the justification that produced it
 *   <PaneLayout>  regions; n panes as data
 * ```
 *
 * Replaces `GraphHUD` · `HudPane` · `InterestPane` · `ItemsPane` ·
 * `RegionPane` · `EvidencePane` · `LanesPane` · `TimeScrubber` ·
 * `GraphQueryBar` and `HudConfig`'s four named slots.
 */
export { Pane, type PaneProps } from './Pane';
export { PaneLayout, type PaneLayoutProps } from './PaneLayout';
export { QueryBar, type QueryBarProps, type QueryWarning } from './QueryBar';
export { Surface, type SurfaceProps } from './Surface';
export { Value, type ValueProps, type ValueProvenance, type AxisKind } from './Value';
export { NodeDetail, type NodeDetailProps } from './NodeDetail';
export {
  REGION_AXIS, REGION_DEFAULT, REGION_MAX, REGION_MIN,
  clampRegion, defaultPaneLayout, inferKind, paneId,
  type PaneFollow, type PaneLayoutConfig, type PaneRegion, type PaneSpec,
  type RegionSize, type Surface as SurfaceData, type SurfaceKind, type SurfaceRow,
} from './paneTypes';
export { ResizeHandle, type ResizeHandleProps } from './ResizeHandle';
export { RowTable, type RowTableProps } from './RowTable';
export { DocsTable, type DocsTableProps } from './DocsTable';
export {
  EMPTY_INDEX, applyCompletion, completions, tokenAt,
  type Completion, type GraphIndex,
} from './complete';
export {
  SELF_COLUMN, nodeIdsOf, refsOf, scalarsOf,
  type RowColumn, type RowItem, type RowRef, type SectionRows,
} from './rowTypes';
export { fold, foldEvidence, foldKeys, selectNodes, type FoldInput } from './fold';
export {
  derivePanes, makePane, paneQuery, panelNames, reconcileDerived,
  type InferredPane,
} from './derive';
