"use client"

/**
 * ResponsivePopover — a popover where a floating panel fits, a bottom sheet
 * where it does not.
 *
 * A popover is a promise that the thing it opens is small enough to float
 * beside its trigger. On a phone most of ours break that promise: the panel
 * config is 560px wide with three sections, and anchored under a 24px button it
 * either collides off the edge or runs past the bottom of the screen with no
 * way to scroll to the rest. The same content in a bottom sheet is full width,
 * bounded, scrollable and under the thumb.
 *
 * Drop-in for `Popover` / `PopoverTrigger` / `PopoverContent`: same open state,
 * same `asChild` trigger. Content takes a `title` because a sheet is a
 * dialog and must be named; on a wide screen the title is not rendered.
 *
 * Wide popovers also gain a height bound from Radix's measured available space,
 * so the desktop version stops running off-screen too.
 */
import * as React from "react"

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"

const NarrowContext = React.createContext(false)

export function ResponsivePopover({
  open,
  onOpenChange,
  defaultOpen,
  children,
}: {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const narrow = useIsMobile()
  const Root = narrow ? Sheet : Popover
  return (
    <NarrowContext.Provider value={narrow}>
      <Root open={open} onOpenChange={onOpenChange} defaultOpen={defaultOpen}>
        {children}
      </Root>
    </NarrowContext.Provider>
  )
}

export function ResponsivePopoverTrigger(
  props: React.ComponentProps<typeof PopoverTrigger>,
) {
  const narrow = React.useContext(NarrowContext)
  return narrow ? <SheetTrigger {...props} /> : <PopoverTrigger {...props} />
}

export function ResponsivePopoverContent({
  className,
  sheetClassName,
  title,
  description,
  children,
  ...popoverProps
}: React.ComponentPropsWithoutRef<typeof PopoverContent> & {
  /** Classes for the bottom-sheet presentation only. */
  sheetClassName?: string
  /** Names the sheet. Required: a dialog without a name is unannounced. */
  title: string
  description?: string
}) {
  const narrow = React.useContext(NarrowContext)

  if (narrow) {
    return (
      <SheetContent
        side="bottom"
        className={cn("max-h-[85dvh] gap-2 overflow-y-auto px-3 pb-safe", sheetClassName)}
      >
        <SheetHeader className="px-1 pb-0 pt-2 text-left">
          <SheetTitle className="text-sm">{title}</SheetTitle>
          <SheetDescription className={description ? "text-xs" : "sr-only"}>
            {description ?? title}
          </SheetDescription>
        </SheetHeader>
        {children}
      </SheetContent>
    )
  }

  return (
    <PopoverContent
      collisionPadding={8}
      {...popoverProps}
      className={cn(
        // Radix measures the space between the trigger and the viewport edge.
        // Bounding by it is what stops a tall popover running off the screen.
        "max-h-[var(--radix-popover-content-available-height)] overflow-y-auto",
        className,
      )}
    >
      {children}
    </PopoverContent>
  )
}
