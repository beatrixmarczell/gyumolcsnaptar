import { useCallback, useEffect, useRef, useState } from 'react'
import {
  loadNotifications,
  markNotificationsRead,
  type SwapNotification,
} from '../lib/swapWorkflow'

type Props = {
  accessToken: string | null
  isAuthenticated: boolean
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'most'
  if (minutes < 60) return `${minutes} perce`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} órája`
  const days = Math.floor(hours / 24)
  return `${days} napja`
}

function eventTypeIcon(eventType: string): string {
  if (eventType.includes('created')) return '📋'
  if (eventType.includes('offer')) return '🤝'
  if (eventType.includes('resolved')) return '✅'
  if (eventType.includes('withdrawn')) return '↩️'
  if (eventType.includes('fruit') || eventType.includes('reminder')) return '🍎'
  return '🔔'
}

const POLL_INTERVAL_MS = 15_000

export function NotificationBell({ accessToken, isAuthenticated }: Props) {
  const [notifications, setNotifications] = useState<SwapNotification[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const unreadCount = notifications.filter((n) => !n.read_at).length

  const fetchNotifications = useCallback(async () => {
    if (!isAuthenticated) return
    try {
      const data = await loadNotifications({ accessToken })
      setNotifications(data)
    } catch {
      // Csendes hiba – nem szakítjuk meg az UX-et
    }
  }, [accessToken, isAuthenticated])

  useEffect(() => {
    if (!isAuthenticated) {
      setNotifications([])
      return
    }
    void fetchNotifications()
    intervalRef.current = setInterval(() => { void fetchNotifications() }, POLL_INTERVAL_MS)
    const onFocus = () => { void fetchNotifications() }
    window.addEventListener('focus', onFocus)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      window.removeEventListener('focus', onFocus)
    }
  }, [fetchNotifications, isAuthenticated])

  // Kattintás kívülre → bezárás
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleOpen = async () => {
    setOpen((prev) => !prev)
    if (!open && unreadCount > 0) {
      // Megnyitáskor azonnal megjelöljük olvasottnak
      try {
        setLoading(true)
        await markNotificationsRead({ accessToken })
        setNotifications((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })))
      } catch {
        // Csendes hiba
      } finally {
        setLoading(false)
      }
    }
  }

  const handleMarkAllRead = async () => {
    try {
      setLoading(true)
      await markNotificationsRead({ accessToken })
      setNotifications((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })))
    } catch {
      // Csendes hiba
    } finally {
      setLoading(false)
    }
  }

  if (!isAuthenticated) return null

  return (
    <div ref={dropdownRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => { void handleOpen() }}
        aria-label={`Értesítések${unreadCount > 0 ? ` (${unreadCount} olvasatlan)` : ''}`}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '4px 8px',
          borderRadius: '8px',
          fontSize: '1.25rem',
          lineHeight: 1,
          position: 'relative',
          color: 'var(--text-primary)',
          transition: 'background 0.15s',
        }}
        title="Értesítések"
      >
        🔔
        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              background: '#e53e3e',
              color: '#fff',
              borderRadius: '999px',
              fontSize: '0.65rem',
              fontWeight: 700,
              minWidth: '16px',
              height: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 3px',
              lineHeight: 1,
              pointerEvents: 'none',
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 6px)',
            width: 'min(340px, 90vw)',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: '12px',
            boxShadow: 'var(--shadow)',
            zIndex: 1000,
            overflow: 'hidden',
          }}
        >
          {/* Fejléc */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 14px',
              borderBottom: '1px solid var(--border)',
              background: 'var(--bg-surface-soft)',
            }}
          >
            <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
              Értesítések
            </span>
            {unreadCount > 0 && (
              <button
                onClick={() => { void handleMarkAllRead() }}
                disabled={loading}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '0.75rem',
                  color: 'var(--text-secondary)',
                  padding: '2px 6px',
                  borderRadius: '6px',
                  textDecoration: 'underline',
                }}
              >
                Összes olvasott
              </button>
            )}
          </div>

          {/* Lista */}
          <div style={{ maxHeight: '320px', overflowY: 'auto' }}>
            {notifications.length === 0 ? (
              <div
                style={{
                  padding: '24px 16px',
                  textAlign: 'center',
                  color: 'var(--text-secondary)',
                  fontSize: '0.85rem',
                }}
              >
                Nincs értesítés
              </div>
            ) : (
              notifications.slice(0, 20).map((n) => (
                <div
                  key={n.id}
                  style={{
                    padding: '10px 14px',
                    borderBottom: '1px solid var(--border)',
                    background: n.read_at ? 'transparent' : 'var(--accent-a)',
                    cursor: 'default',
                    transition: 'background 0.1s',
                  }}
                >
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                    <span style={{ fontSize: '1rem', flexShrink: 0, marginTop: '1px' }}>
                      {eventTypeIcon(n.event_type)}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: n.read_at ? 400 : 600,
                          fontSize: '0.82rem',
                          color: 'var(--text-primary)',
                          marginBottom: '2px',
                        }}
                      >
                        {n.title}
                      </div>
                      {n.body && (
                        <div
                          style={{
                            fontSize: '0.78rem',
                            color: 'var(--text-secondary)',
                            marginBottom: '3px',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                          }}
                        >
                          {n.body}
                        </div>
                      )}
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                        {formatRelativeTime(n.created_at)}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
