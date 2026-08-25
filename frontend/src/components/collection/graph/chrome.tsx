'use client';

/**
 * The graph panel's chrome — the instrument the graph is read through.
 *
 * The panel used to dress itself in stock shadcn: `variant="outline"` on
 * every control, which is `border bg-background shadow-xs`. Three properties,
 * and each one is the opposite of what an instrument wants:
 *
 * ```
 *   shadcn outline           chrome                  because
 *   ──────────────────────   ─────────────────────   ────────────────────────
 *   shadow-xs                nothing casts           a shadow implies a light
 *                                                    source and a plane; an
 *                                                    instrument has neither
 *   bg-background (opaque)   transparent by default  you read the graph
 *                                                    THROUGH the chrome
 *   h-6 px-1.5 (cramped)     h-7 px-2.5 (roomy)      bulk should come from
 *                                                    space, not substance
 * ```
 *
 * The state system is one rule: **transparent is the default, fill means
 * chosen, and fill appears once per group.** No tints, no rings, no
 * `variant="secondary"`. A control is either the selected one — solid, with
 * inverted text — or it is a hairline outline. That is legible across a whole
 * wrapping row at a glance, which is the property a tinted background does not
 * have.
 *
 * These are components rather than a class-name cookbook on purpose. The rules
 * above are *subtractive* — no shadow, no fill, no tint — and a subtraction
 * does not survive in a codebase unless there is somewhere for it to live.
 * Nothing here takes a `shadow` or a `variant`, so the clunky version is not
 * reachable without leaving the module.
 *
 * Colour is spent, never decorated. `tone` exists for the two things in the
 * panel that genuinely carry meaning in hue — a warning the run could not
 * resolve, and a destructive act — and for nothing else.
 */
import React from 'react';
import { cn } from '@/lib/utils';

// ─── Type scale ──────────────────────────────────────────────────────────────
//
// Two roles, and keeping them apart is most of the look. A machine label — a
// control, a section heading, a unit — is caps and tracked, because it names a
// slot rather than saying something. Prose is sentence case and untracked,
// because it is meant to be read. The panel previously had one role at
// `text-[11px]` doing both jobs, which is why nothing in it led and nothing
// receded.

/** Machine label: a control, a section, a unit. */
export const HUD_LABEL = 'text-[10px] font-medium uppercase tracking-[0.09em]';
/** Prose: a hint, a description, an explanation. */
export const HUD_PROSE = 'text-[11px] leading-snug tracking-normal normal-case';
/** A number that will be compared against another number. */
export const HUD_NUM = 'text-[10px] tabular-nums tracking-tight';

// ─── Control geometry ────────────────────────────────────────────────────────

export type HudSize = 'sm' | 'md';

const SIZE: Record<HudSize, { h: string; px: string; icon: string; r: string }> = {
  sm: { h: 'h-6', px: 'px-2', icon: 'h-3 w-3', r: 'rounded-md' },
  md: { h: 'h-7', px: 'px-2.5', icon: 'h-3.5 w-3.5', r: 'rounded-lg' },
};

/** The resting state of every control in the panel: a hairline around
 *  nothing. Hover firms the line and lifts the text; it does not introduce a
 *  fill, because a fill is reserved. */
const REST =
  'border border-hud-line bg-transparent text-hud-dim ' +
  'hover:border-hud-line-strong hover:text-hud-fg';

/** The one filled thing in a group. */
const CHOSEN = 'border border-transparent bg-hud-fill text-hud-fill-fg';

/** Semantically loaded, and only these two. Still unfilled — a warning is a
 *  warning whether or not it is the selected item, so it cannot borrow the
 *  channel that means "chosen". */
const TONE = {
  neutral: '',
  warn: 'border-amber-500/35 text-amber-600 dark:text-amber-400 hover:border-amber-500/60 hover:text-amber-600 dark:hover:text-amber-300',
  danger: 'border-rose-500/35 text-rose-600 dark:text-rose-400 hover:border-rose-500/60 hover:text-rose-600 dark:hover:text-rose-300',
} as const;

export type HudTone = keyof typeof TONE;

const BASE =
  'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap ' +
  'transition-[color,border-color,background-color] duration-150 ' +
  'outline-none focus-visible:border-hud-line-strong focus-visible:text-hud-fg ' +
  'disabled:pointer-events-none disabled:opacity-35';

export interface HudButtonProps
  extends Omit<React.ComponentProps<'button'>, 'children'> {
  icon?: React.ElementType;
  /** Absent ⇒ a square icon-only control. */
  children?: React.ReactNode;
  /** The one filled state. */
  active?: boolean;
  size?: HudSize;
  tone?: HudTone;
  /** A tabular figure trailing the label — a count, a budget, a degree.
   *  Rendered inside the control rather than as a `Badge`, so it inherits the
   *  inversion when the control is chosen instead of stacking a second
   *  background on top of the first. */
  count?: React.ReactNode;
  /** Set by `HudGroup`. Not part of the public shape. */
  inGroup?: boolean;
}

/** Forwards its ref — half the buttons here are Radix `PopoverTrigger asChild`
 *  targets, and a trigger that swallows the ref gets no anchor to position
 *  against and no `aria-expanded` wired to anything. */
export const HudButton = React.forwardRef<HTMLButtonElement, HudButtonProps>(
  function HudButton({
    icon: Icon, children, active, size = 'md', tone = 'neutral',
    count, inGroup, className, ...rest
  }, ref) {
    const s = SIZE[size];
    const iconOnly = children == null;
    return (
      <button
        ref={ref}
        type="button"
        data-active={active || undefined}
        className={cn(
          BASE, s.h,
          iconOnly ? (size === 'sm' ? 'w-6' : 'w-7') : s.px,
          HUD_LABEL,
          active ? CHOSEN : cn(REST, TONE[tone]),
          // In a group the container owns the ring and the corners; the child
          // owns only its own fill. Without this every button draws its own box
          // and the run reads as a fence rather than one instrument.
          inGroup ? 'rounded-none border-0' : s.r,
          className,
        )}
        {...rest}
      >
        {Icon && <Icon className={cn(s.icon, 'shrink-0 stroke-[1.5]')} />}
        {children}
        {count != null && (
          <span className={cn(HUD_NUM, active ? 'opacity-70' : 'text-hud-dimmer')}>
            {count}
          </span>
        )}
      </button>
    );
  },
);

/**
 * A run of controls reading as one object.
 *
 * `ButtonGroup` gave each child its own border, so five related actions drew
 * five boxes with touching edges. Here the group draws one hairline and the
 * children are separated by a single internal line — which is what makes a run
 * of five read as one control with five positions.
 */
export function HudGroup({
  children, size = 'md', className,
}: { children: React.ReactNode; size?: HudSize; className?: string }) {
  return (
    <div
      className={cn(
        'inline-flex shrink-0 items-stretch overflow-hidden',
        'divide-x divide-hud-line border border-hud-line',
        SIZE[size].r, className,
      )}
    >
      {React.Children.map(children, child =>
        React.isValidElement(child)
          ? React.cloneElement(child as React.ReactElement<HudButtonProps>,
                               { inGroup: true, size })
          : child)}
    </div>
  );
}

/**
 * Pick one of a few. The same object as `HudGroup` — deliberately, because a
 * segmented control IS a run of buttons where exactly one is chosen, and
 * giving it separate chrome would be inventing a second grammar for the same
 * gesture.
 */
export function HudSegmented<T extends string>({
  value, onChange, options, size = 'md', className,
}: {
  value: T;
  onChange: (next: T) => void;
  options: Array<{ value: T; label: string; icon?: React.ElementType; title?: string }>;
  size?: HudSize;
  className?: string;
}) {
  return (
    <HudGroup size={size} className={className}>
      {options.map(o => (
        <HudButton
          key={o.value}
          icon={o.icon}
          active={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </HudButton>
      ))}
    </HudGroup>
  );
}

/**
 * A wrapping option — the reference's chip. Same state rule as `HudButton`,
 * different shape: chips live in a row that wraps, so every option is visible
 * at once rather than hidden behind a select. Use where the option set is
 * small and stable enough to show whole.
 */
export const HudChip = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<'button'> & { active?: boolean }
>(function HudChip({ active, children, className, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      data-active={active || undefined}
      className={cn(
        BASE, 'h-6 gap-1 rounded-md px-2', HUD_LABEL,
        active ? CHOSEN : REST,
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

// ─── Readouts ────────────────────────────────────────────────────────────────

/**
 * State, stated. Not a control — it has no hover, no border and no click,
 * because the thing it reports is changed somewhere else. Distinguishing a
 * readout from a chip by *material* is what stops a panel of chips from
 * reading as ten equally-pressable buttons.
 */
export function HudReadout({
  children, className,
}: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('shrink-0 text-hud-dimmer', HUD_NUM, className)}>
      {children}
    </span>
  );
}

/**
 * A section heading: caps, tracked, and followed by a hairline that runs to
 * the edge and stops. The rule is the cheapest structural device there is and
 * the panel had none — every popover was a stack of rows with no grouping
 * anyone could see.
 */
export function HudOverline({
  children, rule = true, className, trailing,
}: {
  children: React.ReactNode;
  /** The hairline. Off when the heading sits inside something already bounded. */
  rule?: boolean;
  trailing?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <span className={cn(HUD_LABEL, 'shrink-0 text-hud-dimmer')}>{children}</span>
      {rule && <span className="h-px min-w-2 flex-1 bg-hud-line" />}
      {trailing}
    </div>
  );
}

/** A hairline. Horizontal by default; `vertical` separates groups in a bar. */
export function HudRule({
  vertical, className,
}: { vertical?: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'shrink-0 bg-hud-line',
        vertical ? 'mx-0.5 h-4 w-px self-center' : 'h-px w-full',
        className,
      )}
    />
  );
}

// ─── Containers ──────────────────────────────────────────────────────────────

/**
 * The bar the controls sit in. No fill and no shadow — it is a region, not a
 * tray. A single hairline underneath is enough to say where it ends, and
 * anything more competes with the graph it is supposed to be serving.
 */
export function HudBar({
  children, className,
}: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-1.5 border-b border-hud-line px-2 py-1.5',
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * The material a floating surface is made of: a hairline, a translucent
 * ground, and a real blur behind it. No shadow — the blur is what separates it
 * from the canvas, and it separates it *honestly*, by showing you that there
 * is something underneath.
 *
 * `shadow-none` is not redundant. Radix's `PopoverContent` ships `shadow-md`,
 * and a `className` that only adds classes loses to it.
 */
export const HUD_SURFACE =
  'rounded-xl border border-hud-line bg-hud-surface shadow-none ' +
  'backdrop-blur-xl backdrop-saturate-150';

/**
 * A text field wearing the chrome.
 *
 * shadcn's `Input` is `border-input dark:bg-input/30` with a 3px focus ring —
 * a filled box that grows a halo. Here it is a slot: no fill, a hairline that
 * firms on focus, and nothing that moves. A control which changes size or
 * grows a ring when you touch it reads as eager; an instrument should not.
 */
export const HUD_INPUT =
  'border-hud-line bg-transparent text-hud-fg placeholder:text-hud-dimmer ' +
  'rounded-lg shadow-none transition-colors ' +
  'hover:border-hud-line-strong focus-visible:border-hud-line-strong ' +
  'focus-visible:ring-0 dark:bg-transparent';

/**
 * A row inside a popover: chosen or not, a label, an optional hint.
 *
 * The panel had four spellings of this row across four popovers — a `Check`
 * with `opacity-0`, a `bg-accent`, a `border-primary`, an icon that changed
 * colour. One row, one rule: the chosen one is marked on the left edge, which
 * scans down a column in a way a background tint does not.
 */
export function HudOption({
  active, label, hint, disabled, trailing, onClick, className,
}: {
  active?: boolean;
  label: React.ReactNode;
  hint?: React.ReactNode;
  disabled?: boolean;
  trailing?: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-active={active || undefined}
      className={cn(
        'group relative flex w-full items-start gap-2 rounded-md py-1 pl-3 pr-1.5 text-left',
        'transition-colors hover:bg-hud-sunken disabled:pointer-events-none disabled:opacity-35',
        className,
      )}
    >
      {/* The mark. A 2px stub on the leading edge rather than a tick in a
          reserved column — it costs no width, and a column of stubs shows you
          what is on without you having to read anything. */}
      <span
        aria-hidden
        className={cn(
          'absolute inset-y-1 left-0 w-0.5 rounded-full transition-colors',
          active ? 'bg-hud-fg' : 'bg-transparent',
        )}
      />
      <span className="min-w-0 flex-1">
        <span className={cn(
          'block truncate text-[11px]',
          active ? 'font-medium text-hud-fg' : 'text-hud-dim',
        )}>
          {label}
        </span>
        {hint && (
          <span className={cn('mt-0.5 block text-hud-dimmer', HUD_PROSE, 'text-[10px]')}>
            {hint}
          </span>
        )}
      </span>
      {trailing && <span className="shrink-0 pt-0.5">{trailing}</span>}
    </button>
  );
}

/**
 * A labelled value — the reference's `LEVEL ················ 100%`. Pairs a
 * caps label with a right-aligned readout so a column of settings has one
 * edge to scan down for values and another for names.
 */
export function HudField({
  label, value, children, className,
}: {
  label: React.ReactNode;
  value?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className={cn(HUD_LABEL, 'text-hud-dim')}>{label}</span>
        {value != null && <HudReadout>{value}</HudReadout>}
      </div>
      {children}
    </div>
  );
}

/**
 * A meter. Ten cells, filled left to right — a quantity you can read at a
 * glance without a number, which is the job the `●●●○○○○○○○` string in the
 * axes popover was already doing in a font that never lined up. Cells rather
 * than a bar because a discrete readout looks measured and a smooth one looks
 * animated.
 */
export function HudMeter({
  value, className,
}: { value: number; className?: string }) {
  const filled = Math.round(Math.max(0, Math.min(1, value)) * 10);
  return (
    <span className={cn('flex shrink-0 items-center gap-px', className)} aria-hidden>
      {Array.from({ length: 10 }, (_, i) => (
        <span
          key={i}
          className={cn(
            'h-2 w-0.5 rounded-full',
            i < filled ? 'bg-hud-fg/70' : 'bg-hud-line-strong',
          )}
        />
      ))}
    </span>
  );
}
