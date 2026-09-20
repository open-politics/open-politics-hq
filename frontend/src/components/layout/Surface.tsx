"use client";

/**
 * Surface — the root of a page inside the app shell.
 *
 * A page's job is to fill the space the shell hands it. It used to be to
 * *guess* that space: every route opened with the same hand-tuned string,
 *
 *     min-h-[91svh] md:min-h-[92.75svh] max-h-[92.75svh] w-full max-w-full
 *
 * copy-pasted into eleven files. The `7.25svh` in there is the top bar's 64px
 * expressed as a percentage of one particular window, so the page was correct
 * at exactly one viewport height and wrong everywhere else — including on
 * every phone, where it declared itself taller than the box it sits in and had
 * the overflow clipped away with no way to scroll to it.
 *
 * Nothing here measures the viewport. `h-full min-h-0` inherits whatever the
 * shell has, and the shell is the only thing that names a viewport unit. Move
 * the top bar, add a banner, change the browser chrome — pages do not care and
 * do not need editing.
 *
 * `min-h-0` is the load-bearing half. A flex item's default `min-height:auto`
 * refuses to shrink below its content, so without it a long page pushes its
 * own container taller than the shell and the bottom goes under the fold —
 * the same failure the `svh` math produced, arrived at from the other side.
 *
 * The other half of the job is being a **container-query root**. HQ is a panel
 * app: the same chrome renders at 390px on a phone and at 380px inside a dock
 * split on a 1440px desktop, and only one of those is a "mobile viewport".
 * Declaring the container here means everything inside can size itself against
 * the space it was actually given, with one code path instead of two.
 */
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";
import { useScrollEdges } from "@/hooks/useScrollEdges";

export interface SurfaceProps extends React.ComponentPropsWithoutRef<"div"> {
  /**
   * Whether this element is the page's scroll container.
   *
   * `false` (the default) means the page lays out inside the given box and
   * some descendant owns scrolling — the right choice for anything with its
   * own panes, tables or split views, because a scroll container wrapping
   * another scroll container is how you get two scrollbars' worth of
   * confusion and no way to reach the bottom of either.
   */
  scroll?: boolean;
  /**
   * Render as the child element instead of a `div`. For pages whose root is
   * already something specific — a `motion.div` orchestrating a stagger, say —
   * so the shell contract lands on that element rather than adding a wrapper
   * between it and its children.
   */
  asChild?: boolean;
}

export const Surface = React.forwardRef<HTMLDivElement, SurfaceProps>(
  function Surface({ scroll = false, asChild = false, className, children, ...props }, ref) {
    // Always called — hooks cannot be conditional — but only attached when this
    // element actually scrolls. An unattached ref simply never measures.
    const edgesRef = useScrollEdges<HTMLDivElement>("y");
    const Comp = asChild ? Slot : "div";

    // Memoised: an inline callback ref is a new function every render, which
    // makes React detach and reattach it each time — pointless churn on an
    // element that never changes identity.
    const setRef = React.useMemo(
      () => (scroll ? mergeRefs(ref, edgesRef) : ref),
      [scroll, ref, edgesRef],
    );

    return (
      <Comp
        ref={setRef}
        className={cn(
          // Named so it can be addressed explicitly (`@md/page:`), while plain
          // `@md:` inside a panel still resolves to that panel's own container.
          // Naming is additive; it takes nothing away from nested queries.
          "@container/page",
          "flex h-full min-h-0 w-full min-w-0 flex-col",
          scroll
            ? "scroll-edges overflow-y-auto overscroll-contain"
            : "overflow-hidden",
          className,
        )}
        {...props}
      >
        {children}
      </Comp>
    );
  },
);

/** Two refs, one element. Kept local — this is the only place that needs it. */
function mergeRefs<T>(...refs: Array<React.Ref<T> | undefined>): React.RefCallback<T> {
  return (value) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(value);
      else if (ref) (ref as React.MutableRefObject<T | null>).current = value;
    }
  };
}

export default Surface;
