/**
 * Service Worker – Web Push értesítések kezelése
 * Regisztrálva a main.tsx-ből.
 */

self.addEventListener('push', (event) => {
  let data = {}
  if (event.data) {
    try {
      data = event.data.json()
    } catch {
      data = { title: 'Gyümölcsnaptár', body: event.data.text() }
    }
  }
  const title = data.title || 'Gyümölcsnaptár'
  const options = {
    body: data.body || '',
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    data: data.data || data,
    requireInteraction: false,
    tag: data?.data?.event_type || 'gyumolcs',
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url && 'focus' in client) {
          return client.focus()
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/')
      }
    }),
  )
})
