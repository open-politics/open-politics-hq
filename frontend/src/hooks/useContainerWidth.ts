import * as React from "react";

/**
 * useContainerWidth — an element's own width, as a number.
 *
 * Container queries handle the common case: styling something by the space it
 * was given rather than by the size of the window. What they cannot do is
 * change *what is mounted* — and sometimes that is the only honest answer. A
 * strip of nineteen buttons does not become usable on a phone by getting
 * smaller; it becomes usable by turning into one button and a sheet.
 *
 * So this is the escape hatch for that case, and only that case. If the choice
 * can be expressed as CSS, express it as CSS: this costs a render on every
 * resize, where `@md:` costs nothing.
 *
 * Returns `null` until the element has been measured. Callers should decide
 * which way that unknown leans — for anything that collapses on narrow, lean
 * compact, so the first paint on a phone is already right.
 */
export function useContainerWidth<T extends HTMLElement>() {
  const [width, setWidth] = React.useState<number | null>(null);
  const observerRef = React.useRef<ResizeObserver | null>(null);

  // A callback ref rather than an object ref: this has to re-observe when the
  // element itself changes, and an object ref gives no signal that it has.
  const ref = React.useCallback((node: T | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;

    if (!node) return;

    setWidth(node.getBoundingClientRect().width);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    observerRef.current = observer;
  }, []);

  React.useEffect(() => () => observerRef.current?.disconnect(), []);

  return { ref, width };
}

export default useContainerWidth;
