import {
  buildEdgeFunctionHeaders,
  getDefaultGroupId,
  getDesktopAccessToken,
  getFunctionUrl,
  isKeycloakAuthEnabled,
} from './supabaseClient'
import { getAccessToken } from './auth/keycloakAuth'
import type { AppStatePayload, AppUserRole } from './cloudTypes'

export type SwapOffer = {
  id: string
  request_id: string
  offer_user_id: string
  offer_child_name: string
  offer_date_key: string
  note: string | null
  status: string
  created_at: string
  updated_at: string
}

export type SwapRequest = {
  id: string
  group_id: string
  requester_user_id: string
  requester_child_name: string
  requester_date_key: string
  note: string | null
  status: string
  resolved_offer_id: string | null
  created_at: string
  updated_at: string
  offers: SwapOffer[]
}

export type SwapEventRow = {
  id: string
  group_id: string
  request_id: string | null
  offer_id: string | null
  actor_user_id: string | null
  event_type: string
  visibility: string
  payload: Record<string, unknown>
  created_at: string
}

async function resolveSwapBearer(passed: string | null | undefined): Promise<string> {
  const desktop = getDesktopAccessToken()
  if (desktop) {
    return desktop
  }
  if (isKeycloakAuthEnabled()) {
    const fresh = await getAccessToken()
    if (fresh) {
      return fresh
    }
  }
  const t = passed?.trim()
  if (t) {
    return t
  }
  throw new Error('Hiányzó token.')
}

async function callGateway<T>(accessToken: string | null | undefined, body: Record<string, unknown>): Promise<T> {
  const token = await resolveSwapBearer(accessToken)
  const endpoint = getFunctionUrl('keycloak-gateway')
  const groupId = getDefaultGroupId()
  if (!endpoint || !groupId) {
    throw new Error('A keycloak-gateway endpoint nincs konfigurálva.')
  }
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: buildEdgeFunctionHeaders(token),
    body: JSON.stringify({ ...body, groupId }),
  })
  const json = (await response.json().catch(() => ({}))) as T & { error?: string; message?: string }
  if (!response.ok) {
    const serverMsg = json.error ?? json.message
    throw new Error(serverMsg ?? `Swap gateway hiba (${response.status}).`)
  }
  return json
}

export async function loadSwapRequests(params: { accessToken?: string | null; role: AppUserRole }): Promise<SwapRequest[]> {
  if (params.role === 'viewer') {
    return []
  }
  const json = await callGateway<{ requests?: SwapRequest[] }>(params.accessToken, { action: 'swap_list' })
  return json.requests ?? []
}

export async function createSwapRequest(params: {
  accessToken?: string | null
  requesterChildName: string
  requesterDateKey: string
  note?: string
}): Promise<void> {
  await callGateway(params.accessToken, {
    action: 'swap_request_create',
    requesterChildName: params.requesterChildName,
    requesterDateKey: params.requesterDateKey,
    note: params.note ?? '',
  })
}

export async function createSwapOffer(params: {
  accessToken?: string | null
  requestId: string
  offerChildName: string
  offerDateKey: string
  note?: string
}): Promise<void> {
  await callGateway(params.accessToken, {
    action: 'swap_offer_create',
    requestId: params.requestId,
    offerChildName: params.offerChildName,
    offerDateKey: params.offerDateKey,
    note: params.note ?? '',
  })
}

export async function withdrawSwapOffer(params: { accessToken?: string | null; offerId: string }): Promise<void> {
  await callGateway(params.accessToken, {
    action: 'swap_offer_withdraw',
    offerId: params.offerId,
  })
}

export async function withdrawSwapRequest(params: { accessToken?: string | null; requestId: string }): Promise<void> {
  await callGateway(params.accessToken, {
    action: 'swap_request_withdraw',
    requestId: params.requestId,
  })
}

export async function approveSwapOffer(params: {
  accessToken?: string | null
  requestId: string
  offerId: string
}): Promise<{ payload: AppStatePayload | null }> {
  const json = await callGateway<{ ok?: boolean; payload?: AppStatePayload | null }>(params.accessToken, {
    action: 'swap_request_approve',
    requestId: params.requestId,
    offerId: params.offerId,
  })
  return { payload: json.payload ?? null }
}

export async function deleteSwapRequest(params: { accessToken?: string | null; requestId: string }): Promise<void> {
  await callGateway(params.accessToken, {
    action: 'swap_request_delete',
    requestId: params.requestId,
  })
}

export async function clearClosedSwapRequests(params: { accessToken?: string | null }): Promise<void> {
  await callGateway(params.accessToken, {
    action: 'swap_requests_clear_closed',
  })
}

// ── Értesítések ──────────────────────────────────────────────────────────────

export type SwapNotification = {
  id: string
  group_id: string
  user_id: string
  request_id: string | null
  offer_id: string | null
  event_type: string
  title: string
  body: string | null
  payload: Record<string, unknown>
  read_at: string | null
  created_at: string
}

export async function loadNotifications(params: { accessToken?: string | null }): Promise<SwapNotification[]> {
  const json = await callGateway<{ notifications?: SwapNotification[] }>(params.accessToken, {
    action: 'notifications_list',
  })
  return json.notifications ?? []
}

export async function markNotificationsRead(params: {
  accessToken?: string | null
  notificationId?: string
}): Promise<void> {
  await callGateway(params.accessToken, {
    action: 'notifications_mark_read',
    notificationId: params.notificationId,
  })
}

// ── Push feliratkozás ─────────────────────────────────────────────────────────

export async function registerPushSubscription(params: {
  accessToken?: string | null
  endpoint: string
  p256dh: string
  authKey: string
}): Promise<void> {
  await callGateway(params.accessToken, {
    action: 'push_subscribe',
    endpoint: params.endpoint,
    p256dh: params.p256dh,
    authKey: params.authKey,
  })
}

export async function unregisterPushSubscription(params: {
  accessToken?: string | null
  endpoint: string
}): Promise<void> {
  await callGateway(params.accessToken, {
    action: 'push_unsubscribe',
    endpoint: params.endpoint,
  })
}

// ── Értesítési preferenciák ───────────────────────────────────────────────────

export type NotificationPrefs = {
  notification_email?: string | null
  notify_email_calendar?: boolean
  notify_push_calendar?: boolean
  notify_email_swap?: boolean
  notify_push_swap?: boolean
}

export async function updateNotificationPrefs(params: {
  accessToken?: string | null
  prefs: NotificationPrefs
}): Promise<void> {
  await callGateway(params.accessToken, {
    action: 'update_notification_prefs',
    notificationEmail: params.prefs.notification_email,
    notifyEmailCalendar: params.prefs.notify_email_calendar,
    notifyPushCalendar: params.prefs.notify_push_calendar,
    notifyEmailSwap: params.prefs.notify_email_swap,
    notifyPushSwap: params.prefs.notify_push_swap,
  })
}

// ── Admin szülő-gyerek hozzárendelés ─────────────────────────────────────────

export type ParentLinkRow = {
  child_name: string
  user_id: string
  user_profiles: { id: string; display_name: string | null; email: string | null } | null
}

export type MemberRow = {
  user_id: string
  role: string
  user_profiles: { id: string; display_name: string | null; email: string | null } | null
}

export async function loadParentLinks(params: { accessToken?: string | null }): Promise<{
  links: ParentLinkRow[]
  members: MemberRow[]
}> {
  const json = await callGateway<{ links?: ParentLinkRow[]; members?: MemberRow[] }>(params.accessToken, {
    action: 'parent_links_list',
  })
  return { links: json.links ?? [], members: json.members ?? [] }
}

export async function setParentLinks(params: {
  accessToken?: string | null
  childName: string
  userIds: string[]
}): Promise<void> {
  await callGateway(params.accessToken, {
    action: 'parent_links_set',
    childName: params.childName,
    userIds: params.userIds,
  })
}
