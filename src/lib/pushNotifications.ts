/**
 * Web Push feliratkozás kezelése (VAPID + Service Worker).
 * A Service Worker regisztrációt a main.tsx végzi.
 */

export const PUSH_SW_PATH = '/sw.js'

const VAPID_PUBLIC_KEY = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? ''


export function isPushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export async function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!isPushSupported()) {
    return null
  }
  try {
    return await navigator.serviceWorker.ready
  } catch {
    return null
  }
}

/**
 * Lekéri az aktuális push feliratkozást (ha van).
 */
export async function getCurrentPushSubscription(): Promise<PushSubscription | null> {
  const reg = await getServiceWorkerRegistration()
  if (!reg) return null
  return reg.pushManager.getSubscription()
}

/**
 * Feliratkoz a push értesítésekre.
 * Ha a felhasználó megtagadja az engedélyt, null-t ad vissza.
 */
export async function subscribeToPush(): Promise<PushSubscription | null> {
  if (!isPushSupported()) {
    throw new Error('A böngésző nem támogatja a push értesítéseket.')
  }
  if (!VAPID_PUBLIC_KEY) {
    throw new Error('Hiányzó VITE_VAPID_PUBLIC_KEY konfiguráció.')
  }
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    return null
  }
  const reg = await getServiceWorkerRegistration()
  if (!reg) {
    throw new Error('Service Worker nem elérhető.')
  }
  const existing = await reg.pushManager.getSubscription()
  if (existing) {
    return existing
  }
  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: VAPID_PUBLIC_KEY,
  })
  return subscription
}

/**
 * Leiratkozik a push értesítésekről.
 */
export async function unsubscribeFromPush(): Promise<void> {
  const sub = await getCurrentPushSubscription()
  if (sub) {
    await sub.unsubscribe()
  }
}

/**
 * A PushSubscription objektumból kiemeli az endpoint/p256dh/auth adatokat
 * a gateway `push_subscribe` action-höz.
 */
export function extractSubscriptionKeys(sub: PushSubscription): {
  endpoint: string
  p256dh: string
  authKey: string
} {
  const rawKey = sub.getKey('p256dh')
  const rawAuth = sub.getKey('auth')
  if (!rawKey || !rawAuth) {
    throw new Error('Hiányzó push subscription kulcsok.')
  }
  const p256dh = btoa(String.fromCharCode(...new Uint8Array(rawKey)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
  const authKey = btoa(String.fromCharCode(...new Uint8Array(rawAuth)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
  return { endpoint: sub.endpoint, p256dh, authKey }
}
