/**
 * Shared types for the intake subsystem.
 *
 * Intake content (useDiscover, useSourceForm, …) is container-agnostic: the same
 * component renders embedded in a flow (`inline`), docked in the right panel
 * (`panel`, the default summon target), or — for standalone hosts like the search
 * route and FlowCanvas — in a quick `popover` / centered `overlay`. All draft
 * state lives in the per-method hooks, so a re-host never resets it.
 */

export type SurfaceMode = 'inline' | 'popover' | 'overlay' | 'panel';

/**
 * Props every Surface content component receives, regardless of presentation.
 * Content stays container-agnostic — it never asks "am I in a popover?"; it only
 * reacts to `mode`/`fullscreen` for cosmetic density and calls back to close/escalate.
 */
export interface SurfaceContentProps<TInit = unknown> {
  init?: TInit;
  mode: SurfaceMode;
  fullscreen: boolean;
  close: () => void;
  /** Walk up the dock's drill stack (→ feed when empty). Present only in the dock (`mode === 'panel'`). */
  back?: () => void;
  /** popover → overlay, preserving the live hook state */
  escalate: () => void;
}
