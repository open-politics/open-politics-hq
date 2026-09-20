"use client";

/**
 * BottomRail — primary navigation on a phone.
 *
 * The sidebar sheet is a fine place to keep twenty things and a poor place to
 * keep the four you use constantly: every switch costs a tap to open, a read to
 * find, and a tap to choose, and it buries the screen you are leaving while you
 * decide. The rail takes the handful of destinations that carry the daily work
 * and puts them one tap away, in the part of the screen a thumb actually
 * reaches. Everything else — settings, schemas, packages, links, theme — stays
 * in the sheet behind "More", which is what a sheet is good at.
 *
 * It sits **in the layout column**, not over it, so the content area shrinks by
 * exactly the rail's height and nothing has to reserve padding or guess. The
 * only things that need to know the rail exists are the handful of
 * `position: fixed` overlays, which read `--app-rail` (set in `globals.css`).
 *
 * Below `md` only, by CSS rather than by a JS breakpoint check — a rail that
 * appears a frame after hydration is a rail that moves the page under the
 * thumb already travelling toward it.
 */
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileText, Home, Menu, Search, Terminal, type LucideIcon } from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

type Destination = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Exact match only — otherwise `/hq` would light up on every child route. */
  exact?: boolean;
};

/**
 * Four, deliberately. A fifth slot is taken by "More", and past five the targets
 * get narrower than a fingertip. These are the surfaces the work runs through:
 * where you land, where you look, where you analyse, where the material lives.
 */
const DESTINATIONS: Destination[] = [
  { href: "/hq", label: "Home", icon: Home, exact: true },
  { href: "/hq/infospaces/explore", label: "Explore", icon: Search },
  { href: "/hq/infospaces/annotation-runner", label: "Analysis", icon: Terminal },
  { href: "/hq/infospaces/asset-manager", label: "Assets", icon: FileText },
];

export function BottomRail({ className }: { className?: string }) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();

  return (
    <nav
      aria-label="Primary"
      className={cn(
        "flex-none border-t bg-card/95 backdrop-blur-xl md:hidden",
        // The home indicator sits inside the rail's own padding rather than
        // under its buttons, so the targets stay clear of it on a notched
        // device and the bar still paints to the physical bottom edge.
        "pb-safe",
        className,
      )}
    >
      <div className="flex h-14 items-stretch">
        {DESTINATIONS.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group relative flex flex-1 flex-col items-center justify-center gap-0.5",
                "transition-colors",
                active ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {/* The chosen one is marked with a rule at the edge it belongs to,
                  not a filled pill. A fill on a bar this size reads as a button
                  that has been pressed and stuck; a rule reads as position. */}
              <span
                aria-hidden
                className={cn(
                  "absolute inset-x-3 top-0 h-0.5 rounded-full transition-colors",
                  active ? "bg-foreground" : "bg-transparent",
                )}
              />
              <Icon className={cn("h-5 w-5 shrink-0", active && "stroke-[2.25]")} />
              <span className="text-[10px] font-medium leading-none">{label}</span>
            </Link>
          );
        })}

        <button
          type="button"
          onClick={() => setOpenMobile(true)}
          className="flex flex-1 flex-col items-center justify-center gap-0.5 text-muted-foreground transition-colors"
        >
          <Menu className="h-5 w-5 shrink-0" />
          <span className="text-[10px] font-medium leading-none">More</span>
        </button>
      </div>
    </nav>
  );
}

export default BottomRail;
