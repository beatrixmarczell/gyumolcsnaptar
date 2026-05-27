import type { NotificationPrefs } from './swapWorkflow'

const STORAGE_KEY = 'fruit-calendar-notification-prefs-v1'

type StoredPrefsByUser = Record<string, NotificationPrefs>

function readAll(): StoredPrefsByUser {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return {}
    }
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }
    return parsed as StoredPrefsByUser
  } catch {
    return {}
  }
}

function writeAll(data: StoredPrefsByUser): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // ignore quota / private mode
  }
}

export function notificationPrefsStorageKey(userProfileId: string | null, userEmail: string | null): string {
  const profile = userProfileId?.trim()
  if (profile) {
    return `profile:${profile}`
  }
  const email = userEmail?.trim().toLowerCase()
  if (email) {
    return `email:${email}`
  }
  return 'anonymous'
}

export function loadLocalNotificationPrefs(
  userProfileId: string | null,
  userEmail: string | null,
): NotificationPrefs | null {
  const key = notificationPrefsStorageKey(userProfileId, userEmail)
  const stored = readAll()[key]
  if (!stored || typeof stored !== 'object') {
    return null
  }
  return stored
}

export function saveLocalNotificationPrefs(
  userProfileId: string | null,
  userEmail: string | null,
  prefs: NotificationPrefs,
): void {
  const key = notificationPrefsStorageKey(userProfileId, userEmail)
  const all = readAll()
  all[key] = prefs
  writeAll(all)
}

export function clearAllLocalNotificationPrefs(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}
