import * as React from "react"

const MOBILE_BREAKPOINT = 768

/**
 * useIsMobile — true below 768px.
 *
 * Caveat worth knowing before you reach for this: the measurement can only
 * happen after mount, so the first render always reports `false`. A component
 * that forks its tree on this value therefore renders the desktop branch once
 * and then swaps, which costs a hydration flash and unmounts whatever state
 * the desktop branch was holding.
 *
 * That makes it the wrong tool for choosing a *layout*. Prefer CSS — container
 * queries where the question is "how wide is this panel" (which is nearly
 * always the real question in HQ, since panels get resized independently of
 * the window), media queries where it genuinely is the viewport. Keep this for
 * decisions CSS cannot express, such as which component to mount.
 */
export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}
