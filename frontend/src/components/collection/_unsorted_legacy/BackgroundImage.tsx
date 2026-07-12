'use client'

import { useEffect } from 'react'
import useAuth from '@/hooks/useAuth'
import { useUserPreferencesStore } from '@/zustand_stores/storeUserPreferences'
import { OpenAPI } from '@/client'

/**
 * Renders the user's custom background image as a fixed, full-viewport layer
 * behind the app. It only becomes *visible* where the surfaces stacked above it
 * are translucent — see the frosted `SidebarInset` in `app/hq/layout.tsx`, which
 * goes semi-transparent + blurred when a custom background is set. With no custom
 * background this renders nothing and the app keeps its solid `bg-background`.
 *
 * The serve endpoint is public (like profile pictures), so we point a plain CSS
 * `url()` straight at it — no access-token fetch / blob-URL dance required.
 */
const BackgroundImage = () => {
  const { user } = useAuth()
  const { preferences, initializePreferences } = useUserPreferencesStore()

  // Keep the preferences store seeded from the authenticated user.
  useEffect(() => {
    if (user?.ui_preferences) {
      initializePreferences(user.ui_preferences)
    }
  }, [user, initializePreferences])

  // Per-theme wallpapers. Once either theme slot is set it's authoritative;
  // otherwise fall back to the legacy single url (shown in both themes).
  const lightSlot = preferences.custom_background_url_light
  const darkSlot = preferences.custom_background_url_dark
  const hasSlots = !!(lightSlot || darkSlot)
  const legacy = preferences.custom_background_url
  const lightUrl = lightSlot ?? (hasSlots ? null : legacy)
  const darkUrl = darkSlot ?? (hasSlots ? null : legacy)

  if (!lightUrl && !darkUrl) return null

  const toFull = (u: string) => (u.startsWith('http') ? u : `${OpenAPI.BASE}${u}`)
  const bgStyle = (u: string) => ({
    backgroundImage: `url("${toFull(u)}")`,
    backgroundRepeat: 'no-repeat' as const,
    backgroundSize: 'cover' as const,
    backgroundPosition: 'center' as const,
  })

  return (
    <div aria-hidden="true" className="fixed inset-0 -z-10 pointer-events-none">
      {/* light-mode wallpaper (hidden when <html> has .dark) */}
      {lightUrl && <div className="absolute inset-0 dark:hidden" style={bgStyle(lightUrl)} />}
      {/* dark-mode wallpaper */}
      {darkUrl && <div className="absolute inset-0 hidden dark:block" style={bgStyle(darkUrl)} />}
      {/* scrim — tones the wallpaper down uniformly on every page so it never
          overpowers content. Pages outside /hq have no frosted inset of their
          own, so this is what keeps the image from overlaying everything there.
          Opacity here is the global "how present is the wallpaper" knob. */}
      <div className="absolute inset-0 dark:bg-background/70" />
    </div>
  )
}

export default BackgroundImage
