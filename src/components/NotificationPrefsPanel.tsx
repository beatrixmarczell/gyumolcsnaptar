import { useCallback, useEffect, useState } from 'react'
import { updateNotificationPrefs, type NotificationPrefs } from '../lib/swapWorkflow'
import {
  detectLikelyPrivateMode,
  getCurrentPushSubscription,
  isPushSupported,
  isVapidConfigured,
  requestNotificationPermission,
  subscribeToPush,
  unsubscribeFromPush,
  extractSubscriptionKeys,
} from '../lib/pushNotifications'
import { registerPushSubscription, unregisterPushSubscription } from '../lib/swapWorkflow'
import { loadLocalNotificationPrefs, saveLocalNotificationPrefs } from '../lib/notificationPrefsStorage'

type Props = {
  accessToken: string | null
  userEmail: string | null
  userProfileId: string | null
  initialPrefs: NotificationPrefs | null
}

type NotificationRow = {
  id: 'swap' | 'calendar'
  title: string
  subtitle: string
  emailKey: 'notify_email_swap' | 'notify_email_calendar'
  pushKey: 'notify_push_swap' | 'notify_push_calendar'
}

const NOTIFICATION_ROWS: NotificationRow[] = [
  {
    id: 'swap',
    title: 'Cserékhez',
    subtitle: 'Kérés, ajánlat, lezárás',
    emailKey: 'notify_email_swap',
    pushKey: 'notify_push_swap',
  },
  {
    id: 'calendar',
    title: 'Gyümölcsnap-emlékeztető',
    subtitle: 'Reggel, 1 nappal előre',
    emailKey: 'notify_email_calendar',
    pushKey: 'notify_push_calendar',
  },
]

const DENIED_HELP =
  'Chrome: Beállítások → Adatvédelem és biztonság → Webhelybeállítások → Értesítések – engedélyezd ezt az oldalt, majd frissítsd.'

function Toggle({
  checked,
  onChange,
  disabled,
  ariaLabel,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  ariaLabel: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      className={`notif-prefs-toggle ${checked ? 'is-on' : ''}`}
      onClick={() => !disabled && onChange(!checked)}
    >
      <span className="notif-prefs-toggle-knob" />
    </button>
  )
}

function mergeNotificationPrefs(
  localPrefs: NotificationPrefs | null,
  serverPrefs: NotificationPrefs | null,
): NotificationPrefs {
  const defaults: NotificationPrefs = {
    notification_email: null,
    notify_email_calendar: true,
    notify_push_calendar: true,
    notify_email_swap: true,
    notify_push_swap: true,
  }
  const serverEmail = serverPrefs?.notification_email?.trim() || null
  const localEmail = localPrefs?.notification_email?.trim() || null
  return {
    ...defaults,
    ...localPrefs,
    ...serverPrefs,
    notification_email: serverEmail ?? localEmail ?? null,
  }
}

/** Megjelenítéshez: mentett értesítési cím, különben bejelentkezési email. */
export function effectiveNotificationEmail(
  prefs: NotificationPrefs | null | undefined,
  loginEmail: string | null,
): string {
  const custom = prefs?.notification_email?.trim()
  if (custom) {
    return custom
  }
  return loginEmail?.trim() ?? ''
}

function wantsAnyPush(prefs: NotificationPrefs): boolean {
  return Boolean(prefs.notify_push_swap ?? true) || Boolean(prefs.notify_push_calendar ?? true)
}

export function NotificationPrefsPanel({ accessToken, userEmail, userProfileId, initialPrefs }: Props) {
  const initialMerged = () =>
    mergeNotificationPrefs(loadLocalNotificationPrefs(userProfileId, userEmail), initialPrefs)

  const [prefs, setPrefs] = useState<NotificationPrefs>(initialMerged)
  const [notifEmail, setNotifEmail] = useState(() => effectiveNotificationEmail(initialMerged(), userEmail))
  const [savedEmail, setSavedEmail] = useState(() => effectiveNotificationEmail(initialMerged(), userEmail))
  const [emailSaving, setEmailSaving] = useState(false)
  const [emailSavedFlash, setEmailSavedFlash] = useState(false)
  const [toggleSaving, setToggleSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pushSupported] = useState(isPushSupported)
  const [pushBusy, setPushBusy] = useState(false)
  const [pushPermission, setPushPermission] = useState<NotificationPermission>(() =>
    typeof Notification !== 'undefined' ? Notification.permission : 'default',
  )
  const [privateMode, setPrivateMode] = useState(false)

  useEffect(() => {
    const merged = mergeNotificationPrefs(
      loadLocalNotificationPrefs(userProfileId, userEmail),
      initialPrefs,
    )
    const displayEmail = effectiveNotificationEmail(merged, userEmail)
    setPrefs(merged)
    setNotifEmail(displayEmail)
    setSavedEmail(displayEmail)
  }, [initialPrefs, userProfileId, userEmail])

  const normalizeEmailInput = (value: string) => value.trim()

  const emailDirty = normalizeEmailInput(notifEmail) !== normalizeEmailInput(savedEmail)

  const resolveNotificationEmailForSave = useCallback(
    (draftInput: string): string | null => {
      const trimmed = normalizeEmailInput(draftInput)
      const login = userEmail?.trim() ?? ''
      if (!trimmed || (login && trimmed.toLowerCase() === login.toLowerCase())) {
        return null
      }
      return trimmed
    },
    [userEmail],
  )

  const persistPrefs = useCallback(
    async (nextPrefs: NotificationPrefs) => {
      const finalPrefs: NotificationPrefs = {
        ...nextPrefs,
        notification_email: nextPrefs.notification_email ?? null,
      }
      saveLocalNotificationPrefs(userProfileId, userEmail, finalPrefs)
      setPrefs(finalPrefs)
      setToggleSaving(true)
      setError(null)
      try {
        await updateNotificationPrefs({ accessToken, prefs: finalPrefs })
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Mentési hiba.')
      } finally {
        setToggleSaving(false)
      }
    },
    [accessToken, userEmail, userProfileId],
  )

  useEffect(() => {
    if (!pushSupported) return
    setPushPermission(Notification.permission)
    void detectLikelyPrivateMode().then(setPrivateMode)
  }, [pushSupported])

  const ensurePushSubscription = useCallback(async (): Promise<boolean> => {
    if (!pushSupported || !isVapidConfigured()) {
      setError('A push értesítés nem elérhető ezen a környezeten.')
      return false
    }
    if (Notification.permission === 'denied') {
      setPushPermission('denied')
      setError(
        privateMode
          ? `Inkognitó módban az értesítések gyakran tiltottak. Normál ablakban próbáld, vagy: ${DENIED_HELP}`
          : `Az értesítések tiltva vannak. ${DENIED_HELP}`,
      )
      return false
    }
    if (Notification.permission === 'default') {
      const next = await requestNotificationPermission()
      setPushPermission(next)
      if (next !== 'granted') {
        setError('Az értesítési engedély szükséges a push bekapcsolásához.')
        return false
      }
    }
    let sub = await getCurrentPushSubscription()
    if (!sub) {
      sub = await subscribeToPush()
      if (!sub) {
        setError('Nem sikerült push feliratkozást létrehozni.')
        return false
      }
    }
    const keys = extractSubscriptionKeys(sub)
    try {
      await registerPushSubscription({ accessToken, ...keys })
    } catch (registerError) {
      await unsubscribeFromPush()
      setError(registerError instanceof Error ? registerError.message : 'Push regisztráció sikertelen.')
      return false
    }
    setPushPermission('granted')
    setError(null)
    return true
  }, [accessToken, privateMode, pushSupported])

  const cleanupPushIfUnused = useCallback(
    async (nextPrefs: NotificationPrefs) => {
      if (wantsAnyPush(nextPrefs)) {
        return
      }
      const sub = await getCurrentPushSubscription()
      if (!sub) {
        return
      }
      try {
        await unregisterPushSubscription({ accessToken, endpoint: sub.endpoint })
      } catch {
        // ignore – a pref kikapcsolása a lényeg
      }
      await unsubscribeFromPush()
    },
    [accessToken],
  )

  useEffect(() => {
    if (!pushSupported || Notification.permission !== 'granted' || !wantsAnyPush(prefs)) {
      return
    }
    void ensurePushSubscription()
  }, [ensurePushSubscription, prefs, pushSupported])

  const notificationEmailForPersist = (): string | null => {
    const draft = normalizeEmailInput(notifEmail)
    const saved = normalizeEmailInput(savedEmail)
    const source = emailDirty ? draft : saved || draft
    return resolveNotificationEmailForSave(source)
  }

  const handleEmailToggle = (emailKey: NotificationRow['emailKey'], enabled: boolean) => {
    const next = { ...prefs, [emailKey]: enabled, notification_email: notificationEmailForPersist() }
    void persistPrefs(next)
  }

  const handlePushToggle = async (pushKey: NotificationRow['pushKey'], enabled: boolean) => {
    if (pushBusy) {
      return
    }
    setPushBusy(true)
    setError(null)
    try {
      if (enabled) {
        const ok = await ensurePushSubscription()
        if (!ok) {
          return
        }
        const next = { ...prefs, [pushKey]: true, notification_email: notificationEmailForPersist() }
        await persistPrefs(next)
      } else {
        const next = { ...prefs, [pushKey]: false, notification_email: notificationEmailForPersist() }
        await cleanupPushIfUnused(next)
        await persistPrefs(next)
      }
    } finally {
      setPushBusy(false)
    }
  }

  const handleSaveEmail = async () => {
    if (!emailDirty || emailSaving) {
      return
    }
    const trimmed = normalizeEmailInput(notifEmail)
    const storedEmail = resolveNotificationEmailForSave(trimmed)
    const next = { ...prefs, notification_email: storedEmail }
    const displayAfterSave = effectiveNotificationEmail(next, userEmail)
    setEmailSaving(true)
    setError(null)
    setEmailSavedFlash(false)
    saveLocalNotificationPrefs(userProfileId, userEmail, next)
    setPrefs(next)
    try {
      await updateNotificationPrefs({ accessToken, prefs: next })
      setNotifEmail(displayAfterSave)
      setSavedEmail(displayAfterSave)
      setEmailSavedFlash(true)
      setTimeout(() => setEmailSavedFlash(false), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Email mentési hiba.')
    } finally {
      setEmailSaving(false)
    }
  }

  const pushBlocked = pushPermission === 'denied'
  const controlsBusy = toggleSaving || pushBusy

  return (
    <div className="notif-prefs-panel">
      <header className="notif-prefs-header">
        <span className="notif-prefs-header-icon" aria-hidden="true">
          🔔
        </span>
        <div className="notif-prefs-header-text">
          <h3 className="notif-prefs-title">Értesítési beállítások</h3>
          <p className="notif-prefs-lead">Kapcsold be az email vagy push csatornát eseményenként – mentés automatikus.</p>
        </div>
      </header>

      <section className="notif-prefs-block">
        <label className="notif-prefs-block-label" htmlFor="notif-prefs-email">
          Értesítési email-cím
        </label>
        <input
          id="notif-prefs-email"
          type="email"
          className="notif-prefs-email-input"
          value={notifEmail}
          onChange={(e) => setNotifEmail(e.target.value)}
          placeholder="pl. sajat@gmail.com"
          autoComplete="email"
        />
        <div className="notif-prefs-email-save-row">
          <button
            type="button"
            className="notif-prefs-email-save-btn"
            onClick={() => { void handleSaveEmail() }}
            disabled={!emailDirty || emailSaving || controlsBusy}
          >
            {emailSaving ? 'Mentés…' : 'Mentés'}
          </button>
          {emailSavedFlash && <span className="notif-prefs-email-saved">✓ Mentve</span>}
        </div>
        <p className="notif-prefs-hint">
          {prefs.notification_email?.trim() ? (
            <>Aktív értesítési cím (mentve a szerveren).</>
          ) : (
            <>
              Ha a bejelentkezési címet hagyod meg, azt használjuk
              {userEmail ? `: ${userEmail}` : ''}. Más címhez írd át, majd kattints a Mentésre.
            </>
          )}
        </p>
      </section>

      <section className="notif-prefs-block">
        <h4 className="notif-prefs-block-title">Események és csatornák</h4>
        {pushSupported && pushBlocked && (
          <p className="notif-prefs-inline-warning">
            Push tiltva a böngészőben – csak email érhető el, amíg nem engedélyezed. {DENIED_HELP}
          </p>
        )}
        <ul className="notif-prefs-event-list">
          {NOTIFICATION_ROWS.map((row) => (
            <li key={row.id} className="notif-prefs-event-card">
              <div className="notif-prefs-event-info">
                <span className="notif-prefs-event-title">{row.title}</span>
                <span className="notif-prefs-event-subtitle">{row.subtitle}</span>
              </div>
              <div className="notif-prefs-channel-grid">
                <div className="notif-prefs-channel">
                  <span className="notif-prefs-channel-label">Email</span>
                  <Toggle
                    checked={prefs[row.emailKey] ?? true}
                    onChange={(v) => handleEmailToggle(row.emailKey, v)}
                    disabled={controlsBusy || emailSaving}
                    ariaLabel={`${row.title} – email értesítés`}
                  />
                </div>
                <div className={`notif-prefs-channel ${pushSupported && !pushBlocked ? '' : 'is-disabled'}`}>
                  <span className="notif-prefs-channel-label">Push</span>
                  <Toggle
                    checked={prefs[row.pushKey] ?? true}
                    onChange={(v) => {
                      void handlePushToggle(row.pushKey, v)
                    }}
                    disabled={!pushSupported || pushBlocked || controlsBusy || emailSaving}
                    ariaLabel={`${row.title} – push értesítés`}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {error && <div className="notif-prefs-error">{error}</div>}
      {controlsBusy && <p className="notif-prefs-hint notif-prefs-busy-hint">Beállítások mentése…</p>}
    </div>
  )
}
