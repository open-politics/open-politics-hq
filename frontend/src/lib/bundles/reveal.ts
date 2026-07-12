/**
 * Scroll a folder row into view inside the tree's own scroll container.
 *
 * The row is found by the `data-bundle-id` attribute the AssetSelector renders
 * on every folder. We wait `delayMs` for the reveal effect (`openBundleIds` →
 * ancestor chain + the bundle itself) to unfold and mount the row, then sit it a
 * third of the way down so its just-opened children have room below — `'nearest'`
 * would only nudge a bottom bundle to the edge and clip them.
 *
 * Shared by AssetManager's source→bundle reveal and folder search-hit reveal so
 * the scroll behaviour lives in exactly one place.
 */
export function scrollBundleIntoView(bundleId: number, delayMs = 350): void {
  setTimeout(() => {
    const el = document.querySelector(`[data-bundle-id="${bundleId}"]`);
    if (!el) return;
    // Closest scrollable ancestor = the tree's scroll container.
    let scroller = el.parentElement;
    while (scroller && scroller.scrollHeight <= scroller.clientHeight) {
      scroller = scroller.parentElement;
    }
    if (!scroller) {
      el.scrollIntoView({ block: 'start', behavior: 'smooth' });
      return;
    }
    const scRect = scroller.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    // Target scrollTop that lands the row a third down (the browser clamps to
    // max, so a bottom bundle rises as far as the content allows).
    const target = scroller.scrollTop + (elRect.top - scRect.top) - scRect.height / 3;
    scroller.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }, delayMs);
}
