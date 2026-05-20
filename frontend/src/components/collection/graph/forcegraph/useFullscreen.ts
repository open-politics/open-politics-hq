'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// =============================================================================
// useFullscreen — wraps the Fullscreen API around a target element ref, with a
// CSS-positioning fallback for browsers that don't expose element-level
// fullscreen.
//
// Browser-compat note (the reason this hook is more than a 6-line wrapper):
//   iOS Safari on iPhone has never implemented the standard Fullscreen API
//   for arbitrary HTML elements — only ``<video>.webkitEnterFullscreen()``
//   exists. ``HTMLDivElement.prototype.requestFullscreen`` is undefined, so
//   the obvious ``el.requestFullscreen?.()`` silently no-ops there. Recent
//   iPadOS implements the real API; older iPads need ``webkit*``-prefixed
//   variants. Desktop Safari uses unprefixed.
//
//   So: try the real API first (covers desktop, Android Chrome, iPadOS).
//   When it isn't available *or* rejects (sandboxed iframe, missing user
//   gesture), fall back to a CSS pseudo-fullscreen — pin the element to the
//   viewport with position:fixed + 100dvh, lock scroll, restore on exit.
//
// From the caller's POV ``isFullscreen`` and ``toggle()`` are identical
// across both paths — the hook hides the difference.
// =============================================================================

export interface UseFullscreenResult {
  isFullscreen: boolean;
  toggle: () => void;
  enter: () => void;
  exit: () => void;
}

interface StyleBackup {
  // Element styles
  position: string;
  top: string;
  left: string;
  right: string;
  bottom: string;
  width: string;
  height: string;
  zIndex: string;
  touchAction: string;
  overscrollBehavior: string;
  paddingTop: string;
  paddingBottom: string;
  paddingLeft: string;
  paddingRight: string;
  // Body styles (iOS-safe scroll lock — see enterPseudo for why)
  bodyPosition: string;
  bodyTop: string;
  bodyLeft: string;
  bodyRight: string;
  bodyWidth: string;
  bodyOverflow: string;
  htmlOverflow: string;
  // Scroll position to restore on exit
  scrollY: number;
  scrollX: number;
}

const EMPTY_BACKUP: StyleBackup = {
  position: '', top: '', left: '', right: '', bottom: '',
  width: '', height: '', zIndex: '', touchAction: '', overscrollBehavior: '',
  paddingTop: '', paddingBottom: '', paddingLeft: '', paddingRight: '',
  bodyPosition: '', bodyTop: '', bodyLeft: '', bodyRight: '', bodyWidth: '',
  bodyOverflow: '', htmlOverflow: '',
  scrollY: 0, scrollX: 0,
};

function realApiAvailable(): boolean {
  if (typeof document === 'undefined') return false;
  // ``fullscreenEnabled`` is the spec-blessed feature-test. It returns
  // ``false`` on iPhone Safari and on iframes that lack the ``allowfullscreen``
  // permission. Fall through to pseudo-fullscreen in either case.
  if (typeof document.fullscreenEnabled === 'boolean' && document.fullscreenEnabled) return true;
  const wk = (document as any).webkitFullscreenEnabled;
  return typeof wk === 'boolean' && wk;
}

export function useFullscreen<T extends HTMLElement>(targetRef: React.RefObject<T | null>): UseFullscreenResult {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const usingPseudoRef = useRef(false);
  const backupRef = useRef<StyleBackup>(EMPTY_BACKUP);

  // Real-API change observer — fires when desktop users hit Esc or when
  // ``exit()`` runs. Pseudo path manages its own state and ignores this.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onChange = () => {
      if (usingPseudoRef.current) return;
      const fsEl = document.fullscreenElement ?? (document as any).webkitFullscreenElement;
      const isOurs = !!targetRef.current && fsEl === targetRef.current;
      setIsFullscreen(isOurs);
    };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, [targetRef]);

  const enterPseudo = useCallback(() => {
    const el = targetRef.current;
    if (!el || usingPseudoRef.current) return;
    // Snapshot every style we're about to touch so exit fully restores.
    const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
    const scrollX = window.scrollX || document.documentElement.scrollLeft || 0;
    backupRef.current = {
      position: el.style.position,
      top: el.style.top,
      left: el.style.left,
      right: el.style.right,
      bottom: el.style.bottom,
      width: el.style.width,
      height: el.style.height,
      zIndex: el.style.zIndex,
      touchAction: el.style.touchAction,
      overscrollBehavior: el.style.overscrollBehavior,
      paddingTop: el.style.paddingTop,
      paddingBottom: el.style.paddingBottom,
      paddingLeft: el.style.paddingLeft,
      paddingRight: el.style.paddingRight,
      bodyPosition: document.body.style.position,
      bodyTop: document.body.style.top,
      bodyLeft: document.body.style.left,
      bodyRight: document.body.style.right,
      bodyWidth: document.body.style.width,
      bodyOverflow: document.body.style.overflow,
      htmlOverflow: document.documentElement.style.overflow,
      scrollY,
      scrollX,
    };

    // ----- Element styles (the visible "fullscreen" panel) -----
    el.style.position = 'fixed';
    el.style.top = '0';
    el.style.left = '0';
    el.style.right = '0';
    el.style.bottom = '0';
    el.style.width = '100vw';
    // ``100vh`` is universal but doesn't shrink as the iOS URL bar grows.
    // ``100dvh`` (iOS 15.4+) gives dynamic-viewport sizing; older browsers
    // silently reject the second assignment and keep ``100vh``.
    el.style.height = '100vh';
    el.style.height = '100dvh';
    el.style.zIndex = '9999';
    // Stop iOS Safari from interpreting touch gestures inside the panel as
    // page-level scroll/zoom. The graph's own pointer/touch handlers still
    // fire — ``touch-action: none`` only disables the browser default.
    el.style.touchAction = 'none';
    // Prevent overscroll rubber-banding from leaking out to the page.
    el.style.overscrollBehavior = 'contain';
    // Respect the notch / home-indicator. ``env(safe-area-inset-*)`` returns
    // 0 on devices without insets, so this is a no-op on desktop / Android.
    el.style.paddingTop = 'env(safe-area-inset-top)';
    el.style.paddingBottom = 'env(safe-area-inset-bottom)';
    el.style.paddingLeft = 'env(safe-area-inset-left)';
    el.style.paddingRight = 'env(safe-area-inset-right)';

    // ----- iOS-safe body scroll lock -----
    // ``overflow: hidden`` on body/html is unreliable on iOS Safari — the
    // page often still scrolls / rubber-bands underneath. The proven
    // pattern is to fix the body in place at its current scroll offset:
    // it can't scroll because it's no longer in normal flow, and we restore
    // the offset on exit so the user lands exactly where they were.
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = `-${scrollX}px`;
    document.body.style.right = '0';
    document.body.style.width = '100%';
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    usingPseudoRef.current = true;
    setIsFullscreen(true);
  }, [targetRef]);

  const exitPseudo = useCallback(() => {
    const el = targetRef.current;
    const b = backupRef.current;
    if (el) {
      el.style.position = b.position;
      el.style.top = b.top;
      el.style.left = b.left;
      el.style.right = b.right;
      el.style.bottom = b.bottom;
      el.style.width = b.width;
      el.style.height = b.height;
      el.style.zIndex = b.zIndex;
      el.style.touchAction = b.touchAction;
      el.style.overscrollBehavior = b.overscrollBehavior;
      el.style.paddingTop = b.paddingTop;
      el.style.paddingBottom = b.paddingBottom;
      el.style.paddingLeft = b.paddingLeft;
      el.style.paddingRight = b.paddingRight;
    }
    // Always restore body/html state even if the element ref is gone (a
    // parent unmounting mid-fullscreen would otherwise leave the body
    // pinned in place — the page would appear permanently frozen).
    if (typeof document !== 'undefined') {
      document.body.style.position = b.bodyPosition;
      document.body.style.top = b.bodyTop;
      document.body.style.left = b.bodyLeft;
      document.body.style.right = b.bodyRight;
      document.body.style.width = b.bodyWidth;
      document.body.style.overflow = b.bodyOverflow;
      document.documentElement.style.overflow = b.htmlOverflow;
      // Restore the user's scroll position. Without this, the body's
      // ``top: -Npx`` snap-jump leaves them at scroll y=0.
      window.scrollTo(b.scrollX, b.scrollY);
    }
    backupRef.current = EMPTY_BACKUP;
    usingPseudoRef.current = false;
    setIsFullscreen(false);
  }, [targetRef]);

  const enter = useCallback(() => {
    const el = targetRef.current;
    if (!el) return;
    if (usingPseudoRef.current) return;
    if (typeof document !== 'undefined' && document.fullscreenElement) return;

    if (!realApiAvailable()) {
      enterPseudo();
      return;
    }
    const req: undefined | (() => Promise<void>) = (el as any).requestFullscreen
      ?? (el as any).webkitRequestFullscreen;
    if (typeof req !== 'function') {
      enterPseudo();
      return;
    }
    Promise.resolve(req.call(el)).catch(() => {
      // Real API rejected — typical causes: missing user gesture, iframe
      // sandbox without ``allowfullscreen``, OS-level lock. Fall back to
      // pseudo so the user gets *something* fullscreen-shaped.
      enterPseudo();
    });
  }, [targetRef, enterPseudo]);

  const exit = useCallback(() => {
    if (usingPseudoRef.current) {
      exitPseudo();
      return;
    }
    if (typeof document === 'undefined') return;
    const exitFn: undefined | (() => Promise<void>) = (document as any).exitFullscreen
      ?? (document as any).webkitExitFullscreen;
    if (typeof exitFn === 'function') {
      Promise.resolve(exitFn.call(document)).catch(() => {});
    }
  }, [exitPseudo]);

  const toggle = useCallback(() => {
    if (isFullscreen) exit();
    else enter();
  }, [isFullscreen, enter, exit]);

  // Esc-to-exit for the pseudo path. Desktop browsers handle Esc themselves
  // for the real API; iOS has no Esc key, but this still helps keyboard
  // users who land on the pseudo path.
  useEffect(() => {
    if (!isFullscreen || !usingPseudoRef.current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exitPseudo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isFullscreen, exitPseudo]);

  // Unmount cleanup — if a parent unmounts us while pseudo-fullscreen is on,
  // body scroll would stay locked forever otherwise.
  useEffect(() => {
    return () => {
      if (usingPseudoRef.current) exitPseudo();
    };
  }, [exitPseudo]);

  return { isFullscreen, toggle, enter, exit };
}
