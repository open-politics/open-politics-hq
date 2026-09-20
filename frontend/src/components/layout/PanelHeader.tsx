"use client";

/**
 * PanelHeader — the title bar every panel in HQ wears.
 *
 * The same object was spelled five different ways: the dashboard panel frame
 * (`annotation/PanelRenderer`), the run header hoisted into the app bar
 * (`annotation/AnnotationRunnerHeader`), the graph pane (`graph/panes/Pane`),
 * the HUD region (`graph/hud/HudPane`), and the graph toolbar
 * (`graph/GraphView`). Every one of them is: something to identify the panel on
 * the left, something to act on it on the right, and a squeeze between them.
 * None of them agreed on padding, type size, or what gives way first — and all
 * of them are the first thing to break when a panel gets narrow.
 *
 * **What this owns: geometry and priority. What it does not own: skin.**
 *
 * That split is deliberate. The graph chrome (`ui/chrome.tsx`) is a real,
 * argued design language and the dashboard panels are plain shadcn; collapsing
 * them into one look is a separate decision from collapsing them into one
 * layout, and only the layout is broken. So callers keep passing their own
 * buttons, in their own vocabulary, and this decides how much room each region
 * gets and what disappears first.
 *
 * ## The squeeze
 *
 * Priority runs: actions > title > count > hint. The title truncates rather
 * than pushing the actions off the edge; the count and the hint leave entirely
 * before the title gets unreadable.
 *
 * The thresholds are **container** queries, not viewport ones, because a panel
 * is not a window. A dashboard panel two columns wide on a 1440px monitor is
 * narrower than the whole screen on a phone, and the old `hidden lg:inline`
 * spelling of this — 47 of them across the app — showed full labels in a
 * 300px-wide panel simply because the browser window was large. Everything
 * here measures the header itself, so one rule covers both cases.
 *
 * ## Tuning
 *
 * `DENSITY` below is the whole geometry system. Row height, padding, gap and
 * type for every panel header in the app are those six lines; the collapse
 * points are `HINT_AT` and `META_AT`. Changing panel density app-wide is an
 * edit here and nowhere else — which is the entire reason this exists rather
 * than a `className` cookbook.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Geometry per surface. `hud` matches the graph chrome's `sm` control size so a
 * header sits flush with the controls inside it; `panel` is the roomier
 * dashboard frame.
 *
 * The coarse-pointer tier lives here too: one `[@media(pointer:coarse)]` step
 * per row, plus a minimum hit size on every button in `actions`. Asking the
 * input device rather than the width is deliberate — a touch laptop needs the
 * bigger targets at 1440px, a desktop mouse does not need them at 390px.
 */
const DENSITY = {
  hud: {
    row: "min-h-7 gap-1 px-1.5 [@media(pointer:coarse)]:min-h-10",
    title: "text-[11px] font-medium",
    meta: "text-[10px] tabular-nums",
    hint: "text-[10px]",
  },
  panel: {
    row: "min-h-8 gap-1.5 px-2 py-1 [@media(pointer:coarse)]:min-h-11",
    title: "text-xs font-semibold",
    meta: "text-[11px] tabular-nums",
    hint: "text-[10px]",
  },
} as const;

export type PanelDensity = keyof typeof DENSITY;

/** Header width at which the description earns its space back. */
const HINT_AT = "@sm:block";
/** …and the count. Lower, because a number costs almost nothing to show. */
const META_AT = "@3xs:block";

export interface PanelHeaderProps extends Omit<React.ComponentPropsWithoutRef<"div">, "title"> {
  density?: PanelDensity;
  /** Ahead of the title: a collapse chevron, a kind icon. Never collapses. */
  lead?: React.ReactNode;
  /** The panel's identity. Truncates; never disappears. */
  title?: React.ReactNode;
  /** A count or short readout beside the title. Hidden on a very narrow panel. */
  meta?: React.ReactNode;
  /** A description. First thing to go, because it is the only part that is
   *  explanation rather than identity. */
  hint?: React.ReactNode;
  /** Interactive bits that belong inline with the title — scope badges, chips.
   *  Kept in the shrinking group, so they compete with the title, not the
   *  actions. */
  extras?: React.ReactNode;
  /** The action cluster. Wins the squeeze against the title — a control you
   *  cannot reach is worse than a name you cannot finish reading.
   *
   *  When the cluster itself is wider than the whole bar, wrap it in
   *  `ActionOverflow`, which moves it into a sheet. The horizontal scroll below
   *  is only a floor, so that a caller who has not done that yet gets something
   *  reachable rather than something silently cut off. */
  actions?: React.ReactNode;
}

export const PanelHeader = React.forwardRef<HTMLDivElement, PanelHeaderProps>(
  function PanelHeader(
    { density = "panel", lead, title, meta, hint, extras, actions, className, children, ...props },
    ref,
  ) {
    const d = DENSITY[density];

    return (
      <div
        ref={ref}
        // `@container/panelheader`: the header measures itself, so the squeeze
        // below AND any `@md:inline` label a caller puts in `actions` resolve
        // against this bar's real width.
        className={cn(
          "@container/panelheader flex shrink-0 items-center",
          d.row,
          className,
        )}
        {...props}
      >
        {lead}

        {/* The yielding group. `min-w-0` is what permits truncation at all —
            without it a flex item refuses to shrink below its content and the
            actions get pushed out of the box instead. */}
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {title != null && (
            // `has-[input]` covers the rename case: a panel whose title is being
            // edited needs the width, where a title being read only needs enough
            // to truncate against. Expressed here rather than as a prop, because
            // "there is an input in it" is the actual condition — a flag would
            // just be the caller restating what the markup already says.
            <span className={cn("min-w-0 truncate has-[input]:flex-1", d.title)}>
              {title}
            </span>
          )}
          {meta != null && (
            <span className={cn("hidden shrink-0 text-muted-foreground", d.meta, META_AT)}>
              {meta}
            </span>
          )}
          {/* Truthy, not null-checked: an empty description is not a description,
              and rendering the span for one leaves a stray gap. `meta` above is
              the opposite case — a count of 0 is a real answer. */}
          {hint ? (
            <span
              className={cn("hidden min-w-0 truncate text-muted-foreground", d.hint, HINT_AT)}
              title={typeof hint === "string" ? hint : undefined}
            >
              {hint}
            </span>
          ) : null}
          {extras}
        </div>

        {/* Callers gate these with `{!focusMode && …}`, which passes `false`
            rather than `undefined` — so this has to be a truthiness check or
            focus mode leaves an empty action well sitting in the bar. */}
        {actions ? (
          // `min-w-0` + `overflow-x-auto` is the floor described above. Without
          // it a cluster wider than the bar simply extended past it and was
          // clipped by an ancestor's `overflow-hidden`: the controls rendered,
          // and there was no gesture on any device that could reach them.
          <div className="flex min-w-0 shrink-0 items-center gap-1 overflow-x-auto [@media(pointer:coarse)]:[&_button]:min-h-8 [@media(pointer:coarse)]:[&_button]:min-w-8">
            {actions}
          </div>
        ) : null}

        {children}
      </div>
    );
  },
);

export default PanelHeader;
