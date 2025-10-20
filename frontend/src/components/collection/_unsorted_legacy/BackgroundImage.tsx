'use client'

import { useEffect, useState } from 'react'
import useAuth from '@/hooks/useAuth'
import { useUserPreferencesStore } from '@/zustand_stores/storeUserPreferences'
import { OpenAPI } from '@/client'

const BackgroundImage = () => {
  const [isMounted, setIsMounted] = useState(false)
  const [backgroundUrl, setBackgroundUrl] = useState<string>('/images/background.jpg')
  const { user } = useAuth()
  const { preferences, initializePreferences } = useUserPreferencesStore()

  useEffect(() => {
    setIsMounted(true)
  }, [])

  // Initialize preferences from user data
  useEffect(() => {
    if (user?.ui_preferences) {
      initializePreferences(user.ui_preferences)
    }
  }, [user, initializePreferences])

  // Fetch authenticated background image and create blob URL
  useEffect(() => {
    let blobUrl: string | null = null

    const loadBackgroundImage = async () => {
      console.log('BackgroundImage: Loading background, preferences:', preferences)
      const customUrl = preferences.custom_background_url
      
      console.log('BackgroundImage: custom_background_url =', customUrl)
      
      // If no custom background, don't set any background (transparent)
      if (!customUrl) {
        console.log('BackgroundImage: No custom background URL, clearing background')
        setBackgroundUrl('')
        return
      }

      // If it's a custom background, fetch it with authentication
      try {
        const token = localStorage.getItem('access_token')
        if (!token) {
          console.warn('BackgroundImage: No auth token, cannot load background')
          setBackgroundUrl('')
          return
        }

        const fullUrl = customUrl.startsWith('http') 
          ? customUrl 
          : `${OpenAPI.BASE}${customUrl}`

        console.log('BackgroundImage: Fetching from:', fullUrl)

        const response = await fetch(fullUrl, {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        })

        console.log('BackgroundImage: Fetch response:', response.status, response.statusText)

        if (!response.ok) {
          console.error('BackgroundImage: Failed to load image:', response.status, response.statusText)
          setBackgroundUrl('')
          return
        }

        const blob = await response.blob()
        blobUrl = URL.createObjectURL(blob)
        console.log('BackgroundImage: ✅ Image loaded successfully, blob URL:', blobUrl)
        setBackgroundUrl(blobUrl)
      } catch (error) {
        console.error('BackgroundImage: Error loading image:', error)
        setBackgroundUrl('')
      }
    }

    if (isMounted) {
      loadBackgroundImage()
    }

    // Cleanup blob URL on unmount or when dependencies change
    return () => {
      if (blobUrl && blobUrl.startsWith('blob:')) {
        console.log('BackgroundImage: Cleaning up blob URL:', blobUrl)
        URL.revokeObjectURL(blobUrl)
      }
    }
  }, [preferences.custom_background_url, isMounted, preferences])

  if (!isMounted || !backgroundUrl) return null

  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 z-[0] pointer-events-none"
      style={{
        backgroundImage: `url(${backgroundUrl})`,
        backgroundRepeat: 'no-repeat',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    />
  )
}

export default BackgroundImage


