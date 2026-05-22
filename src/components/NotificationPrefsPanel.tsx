import { useEffect, useState } from 'react'
import { updateNotificationPrefs, type NotificationPrefs } from '../lib/swapWorkflow'
import {
  getCurrentPushSubscription,
  isPushSupported,
  subscribeToPush,
  unsubscribeFromPush,
  extractSubscriptionKeys,
} from '../lib/pushNotifications'
import { registerPushSubscription, unregisterPushSubscription } from '../lib/swapWorkflow'

type Props = {
  accessToken: string | null
  userEmail: string | null
  initialPrefs: NotificationPrefs | null
}

function Toggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        padding: '8px 0',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span style={{ fontSize: '0.88rem', color: 'var(--text-primary)' }}>{label}</span>
      <div
        onClick={() => !disabled && onChange(!checked)}
        style={{
          width: '40px',
          height: '22px',
          borderRadius: '11px',
          background: checked ? '#2d7a2d' : 'var(--border)',
          position: 'relative',
          transition: 'background 0.2s',
          cursor: disabled ? 'not-allowed' : 'pointer',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: '3px',
            left: checked ? '21px' : '3px',
            width: '16px',
            height: '16px',
            borderRadius: '50%',
            background: '#fff',
            transition: 'left 0.2s',
            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          }}
        />
      </div>
    </label>
  )
}

export function NotificationPrefsPanel({ accessToken, userEmail, initialPrefs }: Props) {
  const [prefs, setPrefs] = useState<NotificationPrefs>({
    notification_email: null,
    notify_email_calendar: true,
    notify_push_calendar: true,
    notify_email_swap: true,
    notify_push_swap: true,
    ...initialPrefs,
  })
  const [notifEmail, setNotifEmail] = useState(initialPrefs?.notification_email ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pushSubscribed, setPushSubscribed] = useState(false)
  const [pushSupported] = useState(isPushSupported)
  const [pushBusy, setPushBusy] = useState(false)
  const [pushPermission, setPushPermission] = useState<NotificationPermission>('default')

  useEffect(() => {
    if (initialPrefs) {
      setPrefs({
        notify_email_calendar: true,
        notify_push_calendar: true,
        notify_email_swap: true,
        notify_push_swap: true,
        ...initialPrefs,
      })
      setNotifEmail(initialPrefs.notification_email ?? '')
    }
  }, [initialPrefs])

  useEffect(() => {
    if (!pushSupported) return
    setPushPermission(Notification.permission)
    getCurrentPushSubscription().then((sub) => {
      setPushSubscribed(Boolean(sub))
    }).catch(() => {})
  }, [pushSupported])

  const handlePushToggle = async (enable: boolean) => {
    if (!pushSupported) return
    setPushBusy(true)
    setError(null)
    try {
      if (enable) {
        const sub = await subscribeToPush()
        if (!sub) {
          setError('Az értesítési engedélyt megtagadtad. Böngésző beállításokban engedélyezheted.')
          setPushBusy(false)
          return
        }
        const keys = extractSubscriptionKeys(sub)
        await registerPushSubscription({ accessToken, ...keys })
        setPushSubscribed(true)
        setPushPermission(Notification.permission)
      } else {
        const sub = await getCurrentPushSubscription()
        if (sub) {
          await unregisterPushSubscription({ accessToken, endpoint: sub.endpoint })
        }
        await unsubscribeFromPush()
        setPushSubscribed(false)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Push hiba.')
    } finally {
      setPushBusy(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const finalPrefs: NotificationPrefs = {
        ...prefs,
        notification_email: notifEmail.trim() || null,
      }
      await updateNotificationPrefs({ accessToken, prefs: finalPrefs })
      setPrefs(finalPrefs)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Mentési hiba.')
    } finally {
      setSaving(false)
    }
  }

  const sectionStyle: React.CSSProperties = {
    background: 'var(--bg-surface-soft)',
    border: '1px solid var(--border)',
    borderRadius: '10px',
    padding: '12px 16px',
    marginBottom: '10px',
  }

  return (
    <div>
      <h3
        style={{
          margin: '0 0 14px 0',
          fontSize: '1rem',
          fontWeight: 600,
          color: 'var(--text-primary)',
        }}
      >
        🔔 Értesítési beállítások
      </h3>

      {/* Email cím */}
      <div style={sectionStyle}>
        <div
          style={{
            fontSize: '0.82rem',
            fontWeight: 600,
            color: 'var(--text-secondary)',
            marginBottom: '8px',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          Értesítési email-cím
        </div>
        <input
          type="email"
          value={notifEmail}
          onChange={(e) => setNotifEmail(e.target.value)}
          placeholder={userEmail ?? 'Alapértelmezett (bejelentkezési email)'}
          style={{
            width: '100%',
            padding: '7px 10px',
            borderRadius: '8px',
            border: '1px solid var(--border)',
            background: 'var(--bg-surface)',
            color: 'var(--text-primary)',
            fontSize: '0.85rem',
            boxSizing: 'border-box',
          }}
        />
        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '5px' }}>
          Ha üres, a bejelentkezési email-cím lesz használva
          {userEmail ? ` (${userEmail})` : ''}.
        </div>
      </div>

      {/* Email értesítések */}
      <div style={sectionStyle}>
        <div
          style={{
            fontSize: '0.82rem',
            fontWeight: 600,
            color: 'var(--text-secondary)',
            marginBottom: '4px',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          📧 Email értesítések
        </div>
        <Toggle
          label="Cserékhez (kérés, ajánlat, lezárás)"
          checked={prefs.notify_email_swap ?? true}
          onChange={(v) => setPrefs((p) => ({ ...p, notify_email_swap: v }))}
        />
        <Toggle
          label="Gyümölcsnap-emlékeztető (reggel, 1 nappal előre)"
          checked={prefs.notify_email_calendar ?? true}
          onChange={(v) => setPrefs((p) => ({ ...p, notify_email_calendar: v }))}
        />
      </div>

      {/* Push értesítések */}
      <div style={sectionStyle}>
        <div
          style={{
            fontSize: '0.82rem',
            fontWeight: 600,
            color: 'var(--text-secondary)',
            marginBottom: '4px',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          📲 Push értesítések (böngésző / mobiltelefon)
        </div>
        {!pushSupported && (
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', padding: '6px 0' }}>
            A böngésződ nem támogatja a push értesítéseket.
          </div>
        )}
        {pushSupported && pushPermission === 'denied' && (
          <div style={{ fontSize: '0.8rem', color: '#c05300', padding: '6px 0' }}>
            Push értesítések tiltva a böngészőben. Engedélyezd a webhely beállításaiban, majd frissítsd az oldalt.
          </div>
        )}
        {pushSupported && pushPermission !== 'denied' && (
          <>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 0',
              }}
            >
              <span style={{ fontSize: '0.88rem', color: 'var(--text-primary)' }}>
                Push értesítések ezen az eszközön
              </span>
              <button
                onClick={() => { void handlePushToggle(!pushSubscribed) }}
                disabled={pushBusy}
                style={{
                  padding: '5px 14px',
                  borderRadius: '8px',
                  border: '1px solid var(--border)',
                  background: pushSubscribed ? '#fee2e2' : 'var(--accent-b)',
                  color: pushSubscribed ? '#991b1b' : 'var(--text-primary)',
                  cursor: pushBusy ? 'not-allowed' : 'pointer',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  transition: 'background 0.15s',
                }}
              >
                {pushBusy ? '...' : pushSubscribed ? 'Leiratkozás' : 'Feliratkozás'}
              </button>
            </div>
            {pushSubscribed && (
              <>
                <Toggle
                  label="Cserékhez (kérés, ajánlat, lezárás)"
                  checked={prefs.notify_push_swap ?? true}
                  onChange={(v) => setPrefs((p) => ({ ...p, notify_push_swap: v }))}
                />
                <Toggle
                  label="Gyümölcsnap-emlékeztető"
                  checked={prefs.notify_push_calendar ?? true}
                  onChange={(v) => setPrefs((p) => ({ ...p, notify_push_calendar: v }))}
                />
              </>
            )}
          </>
        )}
      </div>

      {error && (
        <div
          style={{
            background: '#fee2e2',
            color: '#991b1b',
            borderRadius: '8px',
            padding: '8px 12px',
            fontSize: '0.82rem',
            marginBottom: '10px',
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button
          onClick={() => { void handleSave() }}
          disabled={saving}
          style={{
            padding: '8px 20px',
            borderRadius: '8px',
            border: 'none',
            background: '#2d7a2d',
            color: '#fff',
            fontWeight: 600,
            fontSize: '0.88rem',
            cursor: saving ? 'not-allowed' : 'pointer',
            opacity: saving ? 0.7 : 1,
            transition: 'opacity 0.15s',
          }}
        >
          {saving ? 'Mentés...' : 'Mentés'}
        </button>
        {saved && (
          <span style={{ fontSize: '0.82rem', color: '#2d7a2d', fontWeight: 600 }}>
            ✓ Mentve
          </span>
        )}
      </div>
    </div>
  )
}
