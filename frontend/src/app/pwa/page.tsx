'use client'

import { useState, useEffect } from 'react'
import { subscribeUser, unsubscribeUser, sendNotification } from '../actions/pwa'

function urlBase64ToUint8Array(base64String: string | undefined) {
  if (!base64String) {
    throw new Error('VAPID public key is not configured. Please check your environment variables.')
  }
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')

  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

function PushNotificationManager() {
  const [isSupported, setIsSupported] = useState(false)
  const [subscription, setSubscription] = useState<PushSubscription | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      setIsSupported(true)
      registerServiceWorker()
    }
  }, [])

  async function registerServiceWorker() {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/',
        updateViaCache: 'none',
      })
      const sub = await registration.pushManager.getSubscription()
      setSubscription(sub)
    } catch (err) {
      console.error('Service Worker registration failed:', err)
      setError('Failed to register service worker')
    }
  }

  async function subscribeToPush() {
    try {
      if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
        throw new Error('VAPID public key is not configured')
      }

      const registration = await navigator.serviceWorker.ready
      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY),
      })
      setSubscription(sub)
      const serializedSub = JSON.parse(JSON.stringify(sub))
      await subscribeUser(serializedSub)
      setError(null)
    } catch (err) {
      console.error('Failed to subscribe:', err)
      setError(err instanceof Error ? err.message : 'Failed to subscribe to push notifications')
    }
  }

  async function unsubscribeFromPush() {
    if (subscription) {
      try {
        await subscription.unsubscribe()
        setSubscription(null)
        await unsubscribeUser()
        setError(null)
      } catch (err) {
        console.error('Failed to unsubscribe:', err)
        setError('Failed to unsubscribe from push notifications')
      }
    }
  }

  async function sendTestNotification() {
    if (subscription) {
      try {
        await sendNotification(message)
        setMessage('')
        setError(null)
      } catch (err) {
        console.error('Failed to send notification:', err)
        setError('Failed to send test notification')
      }
    }
  }

  if (!isSupported) {
    return <p>Push notifications are not supported in this browser.</p>
  }

  return (
    <div className="space-y-4 p-4 pt-16">
      <h3 className="text-lg font-semibold">Push Notifications</h3>
      {error && (
        <div className="text-red-500 bg-red-50 p-2 rounded">
          Error: {error}
        </div>
      )}
      {subscription ? (
        <div className="space-y-2">
          <p className="text-green-600">You are subscribed to push notifications.</p>
          <button 
            onClick={unsubscribeFromPush}
            className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600"
          >
            Unsubscribe
          </button>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Enter notification message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="border p-2 rounded flex-1"
            />
            <button 
              onClick={sendTestNotification}
              className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
            >
              Send Test
            </button>
          </div>
        </div>
      ) : (
        <div>
          <p>You are not subscribed to push notifications.</p>
          <button 
            onClick={subscribeToPush}
            className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600 mt-2"
          >
            Subscribe
          </button>
        </div>
      )}
    </div>
  )
}

function InstallPrompt() {
  const [isIOS, setIsIOS] = useState(false)
  const [isStandalone, setIsStandalone] = useState(false)
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null)
  const [isInstallable, setIsInstallable] = useState(false)

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      // Prevent Chrome 67 and earlier from automatically showing the prompt
      e.preventDefault()
      // Stash the event so it can be triggered later
      setDeferredPrompt(e)
      setIsInstallable(true)
    }

    setIsIOS(
      /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream
    )

    setIsStandalone(window.matchMedia('(display-mode: standalone)').matches)

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    }
  }, [])

  const handleInstallClick = async () => {
    if (!deferredPrompt) return

    // Show the install prompt
    deferredPrompt.prompt()

    // Wait for the user to respond to the prompt
    const { outcome } = await deferredPrompt.userChoice
    console.log(`User response to the install prompt: ${outcome}`)

    // Clear the deferredPrompt variable
    setDeferredPrompt(null)
    setIsInstallable(false)
  }

  if (isStandalone) {
    return <p className="text-green-600 p-4">App is already installed!</p>
  }

  return (
    <div className="p-4 space-y-4">
      <h3 className="text-lg font-semibold">Install App</h3>
      {isInstallable && (
        <button 
          onClick={handleInstallClick}
          className="bg-purple-500 text-white px-4 py-2 rounded hover:bg-purple-600"
        >
          Install App
        </button>
      )}
      {isIOS && (
        <p className="text-sm text-gray-600">
          To install this app on your iOS device, tap the share button
          <span role="img" aria-label="share icon"> ⎋ </span>
          and then "Add to Home Screen"
          <span role="img" aria-label="plus icon"> ➕ </span>
        </p>
      )}
    </div>
  )
}

export default function Page() {
  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-center my-8">Progressive Web App Features</h1>
      <div className="space-y-8">
        <PushNotificationManager />
        <InstallPrompt />
      </div>
    </div>
  )
} 