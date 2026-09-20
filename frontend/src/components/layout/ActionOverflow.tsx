"use client";

/**
 * ActionOverflow — the same actions, inline when there is room and behind one
 * button when there is not.
 *
 * A toolbar that does not fit has three possible fates: it overflows and gets
 * clipped, it shrinks until nothing is legible, or it moves. Only the third is
 * any good. Clipping is the worst of them, because the controls are still there
 * — they are simply unreachable, with nothing on screen to say so.
 *
 * The children are passed straight through in both cases, so this renders **one
 * instance** either way. That matters: these clusters are full of popovers,
 * dropdowns and buttons carrying their own state, and mounting a hidden second
 * copy to swap between would duplicate every one of them.
 *
 * The sheet comes up from the bottom on purpose. Actions belong under the thumb
 * on a phone, and a bottom sheet also lets the cluster wrap into rows with real
 * spacing instead of staying a cramped strip — which is usually a better way to
 * read a set of grouped commands than the strip was in the first place.
 */
import * as React from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export interface ActionOverflowProps {
  /** Whether there is room to show the cluster inline. */
  compact: boolean;
  /** Names the sheet for screen readers, e.g. "Run actions". */
  label: string;
  /** Optional sub-line in the sheet header. */
  description?: string;
  className?: string;
  children: React.ReactNode;
}

export function ActionOverflow({
  compact,
  label,
  description,
  className,
  children,
}: ActionOverflowProps) {
  if (!compact) return <>{children}</>;

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("h-7 shrink-0 gap-1 px-2 text-[11px]", className)}
          aria-label={label}
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="bottom"
        // Bounded and scrollable: a cluster this size will not fit a phone in
        // one screen, and the sheet must not become the new thing that clips.
        className="max-h-[80dvh] overflow-y-auto scroll-edges pb-safe"
      >
        <SheetHeader className="text-left">
          <SheetTitle className="text-sm">{label}</SheetTitle>
          {description ? (
            <SheetDescription className="text-xs">{description}</SheetDescription>
          ) : (
            <SheetDescription className="sr-only">
              Actions for the current view
            </SheetDescription>
          )}
        </SheetHeader>
        {/* Wrapping, with room to breathe. Grouped runs stay grouped — each
            ButtonGroup is `inline-flex`, so they wrap as whole units rather
            than breaking apart mid-run.

            `data-actions-overflow` is what brings the text labels back: the
            sheet portals out of the bar's container, so the container query
            that normally reveals them cannot match here. See `.control-label`
            in globals.css. */}
        <div
          data-actions-overflow
          className="flex flex-wrap items-center gap-2 py-4"
        >
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default ActionOverflow;
