'use server'

import webpush, { type PushSubscription } from 'web-push'

webpush.setVapidDetails(
  'mailto:jim@openpoliticshq.com',
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
)
 
let subscription: PushSubscription | null = null
 
export async function subscribeUser(sub: PushSubscription) {
  subscription = sub
  console.log('User subscribed:', sub)
  return { success: true }
}
 
export async function unsubscribeUser() {
  console.log('User unsubscribed:', subscription)
  subscription = null
  return { success: true }
}
 
export async function sendNotification(message: string) {
  if (!subscription) {
    console.error('No subscription available')
    throw new Error('No subscription available')
  }
 
  try {
    await webpush.sendNotification(
      subscription,
      JSON.stringify({
        title: 'Test Notification',
        body: message,
        icon: '/icon.png',
      })
    )
    console.log('Notification sent successfully.')
    return { success: true }
  } catch (error) {
    console.error('Error sending push notification:', error)
    if (error instanceof Error) {
        return { success: false, error: error.message }
    }
    return { success: false, error: 'Failed to send notification' }
  }
} 