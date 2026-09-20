"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { useScrollEdges } from "@/hooks/useScrollEdges"

/**
 * ScrollArea — a region that scrolls, with no scrollbar and a fade at whichever
 * edge has more content behind it.
 *
 * This used to wrap Radix's ScrollArea, and that wrapper stopped scrolling
 * entirely the moment its scrollbar was removed. Radix sets the viewport's
 * overflow from whether a scrollbar component is *mounted* —
 * `overflowY: scrollbarYEnabled ? "scroll" : "hidden"` — so a Radix ScrollArea
 * with no scrollbar is `overflow: hidden`. The scrollbar was the only thing
 * Radix contributed, HQ never shows one, and without it the wrapper had nothing
 * left to do except break. This is what it was pretending to be: two divs and
 * native overflow.
 *
 * Kept compatible on purpose:
 * - Same shape. A root that takes `ref` and `className`, around a viewport.
 * - The viewport still carries `data-radix-scroll-area-viewport`. Six call sites
 *   query that attribute to scroll a focused row into view; the attribute names
 *   a role, and keeping it means none of them had to change.
 * - `max-h-[inherit]` on the viewport, so a root sized only by `max-h-*`
 *   scrolls instead of clipping. The old viewport's `h-full` resolved to `auto`
 *   against a max-height parent and quietly never scrolled at all.
 */
const ScrollArea = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<"div"> & {
    /** The axis that scrolls and fades. `false` keeps vertical scrolling and
     *  drops the fade — for regions with their own edge treatment, or content
     *  that has to escape the box. */
    edges?: "y" | "x" | false
  }
>(({ className, children, edges = "y", ...props }, ref) => {
  const horizontal = edges === "x"
  const viewportRef = useScrollEdges<HTMLDivElement>(horizontal ? "x" : "y")

  return (
    <div ref={ref} className={cn("relative overflow-hidden", className)} {...props}>
      <div
        ref={edges === false ? undefined : viewportRef}
        data-radix-scroll-area-viewport=""
        className={cn(
          "h-full max-h-[inherit] w-full rounded-[inherit]",
          horizontal ? "overflow-x-auto overflow-y-hidden" : "overflow-y-auto overflow-x-hidden",
          edges === "y" && "scroll-edges",
          horizontal && "scroll-edges-x",
        )}
      >
        {children}
      </div>
    </div>
  )
})
ScrollArea.displayName = "ScrollArea"

export { ScrollArea }
