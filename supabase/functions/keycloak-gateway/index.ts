import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'
import { createRemoteJWKSet, jwtVerify } from 'https://esm.sh/jose@5.9.6'

type AppRole = 'admin' | 'editor' | 'viewer'

type RequestBody = {
  action?:
    | 'load'
    | 'save'
    | 'swap_list'
    | 'swap_request_create'
    | 'swap_offer_create'
    | 'swap_offer_withdraw'
    | 'swap_request_withdraw'
    | 'swap_request_approve'
    | 'swap_request_delete'
    | 'swap_requests_clear_closed'
    | 'notifications_list'
    | 'notifications_mark_read'
    | 'push_subscribe'
    | 'push_unsubscribe'
    | 'update_notification_prefs'
    | 'parent_links_list'
    | 'parent_links_set'
  groupId?: string
  payload?: unknown
  requestId?: string
  offerId?: string
  requesterChildName?: string
  requesterDateKey?: string
  offerChildName?: string
  offerDateKey?: string
  note?: string
  // notifications_mark_read
  notificationId?: string
  // push_subscribe / push_unsubscribe
  endpoint?: string
  p256dh?: string
  authKey?: string
  // update_notification_prefs
  notificationEmail?: string | null
  notifyEmailCalendar?: boolean
  notifyPushCalendar?: boolean
  notifyEmailSwap?: boolean
  notifyPushSwap?: boolean
  // parent_links_set
  childName?: string
  userIds?: string[]
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const DEFAULT_GROUP_ID = Deno.env.get('DEFAULT_GROUP_ID') ?? ''

const KEYCLOAK_ISSUER = Deno.env.get('KEYCLOAK_ISSUER') ?? ''
const KEYCLOAK_AUDIENCE = Deno.env.get('KEYCLOAK_AUDIENCE') ?? ''
const KEYCLOAK_JWKS_URL = Deno.env.get('KEYCLOAK_JWKS_URL') ?? ''
const DESKTOP_ACCESS_TOKEN = Deno.env.get('DESKTOP_ACCESS_TOKEN') ?? ''

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const RESEND_FROM_EMAIL = Deno.env.get('RESEND_FROM_EMAIL') ?? 'Gyümölcsnaptár <noreply@gyuminaptar.hu>'
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function getBearerToken(req: Request): string | null {
  const authHeader = req.headers.get('authorization') ?? req.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }
  return authHeader.slice('Bearer '.length).trim()
}

async function verifyKeycloakJwt(token: string): Promise<{
  sub: string
  email: string | null
  displayName: string | null
  preferredUsername: string | null
  tokenRoles: AppRole[]
}> {
  const jwksCandidates = [
    KEYCLOAK_JWKS_URL,
    KEYCLOAK_ISSUER ? `${KEYCLOAK_ISSUER.replace(/\/+$/, '')}/protocol/openid-connect/certs` : '',
    'https://auth.gyuminaptar.hu/realms/gyumolcsnaptar/protocol/openid-connect/certs',
  ].filter((v, i, arr): v is string => Boolean(v) && arr.indexOf(v) === i)
  if (jwksCandidates.length === 0) {
    throw new Error('Hiányzó KEYCLOAK_JWKS_URL / KEYCLOAK_ISSUER.')
  }
  const strictVerifyOptions: {
    issuer?: string
    audience?: string
  } = {}
  if (KEYCLOAK_ISSUER) {
    strictVerifyOptions.issuer = KEYCLOAK_ISSUER
  }
  if (KEYCLOAK_AUDIENCE) {
    strictVerifyOptions.audience = KEYCLOAK_AUDIENCE
  }
  let payload: Awaited<ReturnType<typeof jwtVerify>>['payload'] | null = null
  let lastError: unknown = null
  for (const jwksUrl of jwksCandidates) {
    const jwks = createRemoteJWKSet(new URL(jwksUrl))
    try {
      ;({ payload } = await jwtVerify(token, jwks, strictVerifyOptions))
      break
    } catch (strictError) {
      lastError = strictError
      // Local Keycloak környezetben gyakori az issuer/audience mismatch (http/https, tunnel),
      // ezért második próbában csak az aláírást ellenőrizzük.
      try {
        ;({ payload } = await jwtVerify(token, jwks))
        break
      } catch (relaxedError) {
        lastError = relaxedError
      }
    }
  }
  if (!payload) {
    throw lastError instanceof Error ? lastError : new Error('JWT ellenőrzés sikertelen.')
  }
  const sub = typeof payload.sub === 'string' ? payload.sub : null
  if (!sub) {
    throw new Error('Hiányzó subject (sub) claim.')
  }
  const email = typeof payload.email === 'string' ? payload.email : null
  const preferredUsername = typeof payload.preferred_username === 'string' ? payload.preferred_username : null
  const displayName = typeof payload.name === 'string' ? payload.name : email
  const realmAccess = payload.realm_access
  const rolesRaw =
    realmAccess && typeof realmAccess === 'object' && Array.isArray((realmAccess as Record<string, unknown>).roles)
      ? ((realmAccess as Record<string, unknown>).roles as unknown[])
      : []
  const tokenRoles = rolesRaw
    .filter((role): role is string => typeof role === 'string')
    .filter((role): role is AppRole => role === 'admin' || role === 'editor' || role === 'viewer')

  return { sub, email, displayName, preferredUsername, tokenRoles }
}

async function resolveMembership(
  groupId: string,
  identity: {
    sub: string
    email: string | null
    displayName: string | null
    preferredUsername: string | null
    tokenRoles: AppRole[]
  },
): Promise<{
  role: AppRole
  userId: string
}> {
  const { data: profileRow, error: profileError } = await supabase
    .from('user_profiles')
    .upsert(
      {
        keycloak_sub: identity.sub,
        email: identity.email,
        display_name: identity.displayName,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'keycloak_sub' },
    )
    .select('id')
    .single()

  if (profileError || !profileRow?.id) {
    throw new Error(profileError?.message ?? 'Nem sikerült user profile-t létrehozni.')
  }

  let { data: membership, error: membershipError } = await supabase
    .from('group_memberships')
    .select('role')
    .eq('group_id', groupId)
    .eq('user_id', profileRow.id)
    .maybeSingle()

  if (membershipError) {
    throw new Error(membershipError.message)
  }
  const roleByEmail: Record<string, AppRole> = {
    'admin@example.com': 'admin',
    'editor@example.com': 'editor',
    'viewer@example.com': 'viewer',
  }
  const roleByUsername: Record<string, AppRole> = {
    'admin.demo': 'admin',
    'editor.demo': 'editor',
    'viewer.demo': 'viewer',
  }
  const roleFromToken =
    identity.tokenRoles.includes('admin')
      ? 'admin'
      : identity.tokenRoles.includes('editor')
        ? 'editor'
        : identity.tokenRoles.includes('viewer')
          ? 'viewer'
          : null
  const roleFromDisplayName =
    identity.displayName?.toLowerCase().includes('admin')
      ? 'admin'
      : identity.displayName?.toLowerCase().includes('editor')
        ? 'editor'
        : identity.displayName?.toLowerCase().includes('viewer')
          ? 'viewer'
          : null
  const fallbackRole =
    roleFromToken ??
    roleFromDisplayName ??
    (identity.email ? roleByEmail[identity.email.toLowerCase()] : undefined) ??
    (identity.preferredUsername ? roleByUsername[identity.preferredUsername.toLowerCase()] : undefined)

  if (!membership) {
    if (fallbackRole) {
      const { error: insertMembershipError } = await supabase.from('group_memberships').upsert(
        {
          group_id: groupId,
          user_id: profileRow.id,
          role: fallbackRole,
        },
        { onConflict: 'group_id,user_id' },
      )
      if (insertMembershipError) {
        throw new Error(insertMembershipError.message)
      }
      const membershipReload = await supabase
        .from('group_memberships')
        .select('role')
        .eq('group_id', groupId)
        .eq('user_id', profileRow.id)
        .maybeSingle()
      membership = membershipReload.data
      membershipError = membershipReload.error
      if (membershipError) {
        throw new Error(membershipError.message)
      }
    }
  }
  if (membership && fallbackRole && membership.role !== fallbackRole) {
    const { error: updateMembershipError } = await supabase
      .from('group_memberships')
      .update({ role: fallbackRole })
      .eq('group_id', groupId)
      .eq('user_id', profileRow.id)
    if (updateMembershipError) {
      throw new Error(updateMembershipError.message)
    }
    membership = { role: fallbackRole }
  }
  if (!membership) {
    throw new Error('Nincs jogosultság ehhez a csoporthoz.')
  }

  return {
    role: membership.role as AppRole,
    userId: profileRow.id,
  }
}

// ── Web Push (VAPID) ────────────────────────────────────────────────────────

/**
 * Alap URL-safe Base64 dekódolás Deno-ban (Web Crypto API-hoz szükséges).
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

function uint8ArrayToBase64Url(array: Uint8Array): string {
  let str = ''
  for (const byte of array) {
    str += String.fromCharCode(byte)
  }
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

/**
 * VAPID JWT aláírás Web Crypto API-val (Deno kompatibilis).
 * Ld. RFC 8292 + https://datatracker.ietf.org/doc/html/rfc7515
 */
async function buildVapidJwt(audience: string): Promise<string> {
  const header = { typ: 'JWT', alg: 'ES256' }
  const payload = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: VAPID_SUBJECT,
  }
  const encodedHeader = uint8ArrayToBase64Url(new TextEncoder().encode(JSON.stringify(header)))
  const encodedPayload = uint8ArrayToBase64Url(new TextEncoder().encode(JSON.stringify(payload)))
  const signingInput = `${encodedHeader}.${encodedPayload}`

  const privateKeyBytes = urlBase64ToUint8Array(VAPID_PRIVATE_KEY)
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    privateKeyBytes,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    cryptoKey,
    new TextEncoder().encode(signingInput),
  )
  const encodedSig = uint8ArrayToBase64Url(new Uint8Array(signature))
  return `${signingInput}.${encodedSig}`
}

type PushSubscriptionData = {
  endpoint: string
  p256dh: string
  auth_key: string
}

async function sendWebPush(sub: PushSubscriptionData, title: string, body: string, data?: Record<string, unknown>): Promise<void> {
  if (!VAPID_PRIVATE_KEY || !VAPID_PUBLIC_KEY || !VAPID_SUBJECT) {
    return
  }
  const url = new URL(sub.endpoint)
  const audience = `${url.protocol}//${url.hostname}`
  let vapidJwt: string
  try {
    vapidJwt = await buildVapidJwt(audience)
  } catch (e) {
    console.warn('[push] VAPID JWT hiba:', e)
    return
  }

  const notificationPayload = JSON.stringify({ title, body, data: data ?? {} })
  const response = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `vapid t=${vapidJwt},k=${VAPID_PUBLIC_KEY}`,
      'Content-Type': 'application/json',
      'TTL': '86400',
    },
    body: notificationPayload,
  })
  if (!response.ok && response.status !== 201) {
    const text = await response.text().catch(() => '')
    console.warn(`[push] Küldés sikertelen (${response.status}): ${text}`)
  }
}

// ── Email (Resend) ──────────────────────────────────────────────────────────

async function sendResendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!RESEND_API_KEY) {
    return
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: RESEND_FROM_EMAIL,
      to: [to],
      subject,
      html,
    }),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    console.warn(`[email] Resend hiba (${response.status}): ${text}`)
  }
}

function buildEmailHtml(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="hu">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:sans-serif;color:#222;max-width:520px;margin:0 auto;padding:24px">
  <h2 style="color:#2d7a2d">${title}</h2>
  <p>${body}</p>
  <p style="margin-top:32px"><a href="https://next.gyuminaptar.hu" style="color:#2d7a2d">Megnyitás: Gyümölcsnaptár</a></p>
  <p style="color:#888;font-size:12px;margin-top:24px">Értesítési beállításaidat a saját profiloldaladon módosíthatod.</p>
</body>
</html>`
}

// ── notifyUsers ─────────────────────────────────────────────────────────────

type NotifyRecipient = {
  userId: string
  email: string | null
  notifyEmailSwap: boolean
  notifyPushSwap: boolean
}

type NotifyEvent = {
  event_type: string
  title: string
  body: string
  payload?: Record<string, unknown>
  request_id?: string | null
  offer_id?: string | null
}

async function notifyUsers(
  groupId: string,
  recipients: NotifyRecipient[],
  event: NotifyEvent,
): Promise<void> {
  if (recipients.length === 0) {
    return
  }

  // 1. DB: swap_notifications insert
  const rows = recipients.map((r) => ({
    group_id: groupId,
    user_id: r.userId,
    request_id: event.request_id ?? null,
    offer_id: event.offer_id ?? null,
    event_type: event.event_type,
    title: event.title,
    body: event.body,
    payload: event.payload ?? {},
  }))
  const { error: insertError } = await supabase.from('swap_notifications').insert(rows)
  if (insertError) {
    console.warn('[notify] DB insert hiba:', insertError.message)
  }

  // 2. Email + Push párhuzamosan
  const tasks: Promise<void>[] = []
  for (const r of recipients) {
    // Email
    if (r.notifyEmailSwap && r.email) {
      tasks.push(
        sendResendEmail(r.email, event.title, buildEmailHtml(event.title, event.body)).catch((e) =>
          console.warn('[notify] email hiba:', e),
        ),
      )
    }
    // Web Push
    if (r.notifyPushSwap) {
      tasks.push(
        (async () => {
          const { data: subs } = await supabase
            .from('push_subscriptions')
            .select('endpoint,p256dh,auth_key')
            .eq('user_id', r.userId)
          for (const sub of subs ?? []) {
            await sendWebPush(
              sub as PushSubscriptionData,
              event.title,
              event.body,
              { event_type: event.event_type, request_id: event.request_id },
            ).catch((e) => console.warn('[notify] push hiba:', e))
          }
        })(),
      )
    }
  }
  await Promise.allSettled(tasks)
}

/**
 * Csoport editor+admin tagjainak preferenciáit lekéri (értesítés küldéshez).
 * actor_user_id kizárható (a cselekvő maga ne kapjon értesítést).
 */
async function loadGroupNotifyRecipients(
  groupId: string,
  excludeUserId: string | null,
): Promise<NotifyRecipient[]> {
  const { data, error } = await supabase
    .from('group_memberships')
    .select('user_id, role, user_profiles(email, notification_email, notify_email_swap, notify_push_swap)')
    .eq('group_id', groupId)
    .in('role', ['editor', 'admin'])

  if (error) {
    console.warn('[notify] loadGroupNotifyRecipients hiba:', error.message)
    return []
  }
  const out: NotifyRecipient[] = []
  for (const row of data ?? []) {
    if (!row.user_id || row.user_id === excludeUserId) {
      continue
    }
    const profile = Array.isArray(row.user_profiles) ? row.user_profiles[0] : row.user_profiles
    if (!profile) {
      continue
    }
    out.push({
      userId: row.user_id,
      email: (profile.notification_email as string | null) ?? (profile.email as string | null),
      notifyEmailSwap: (profile.notify_email_swap as boolean) ?? true,
      notifyPushSwap: (profile.notify_push_swap as boolean) ?? true,
    })
  }
  return out
}

/**
 * Egyetlen user preferenciáját tölti be értesítésküldéshez.
 */
async function loadUserNotifyRecipient(userId: string): Promise<NotifyRecipient | null> {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('email, notification_email, notify_email_swap, notify_push_swap')
    .eq('id', userId)
    .maybeSingle()
  if (error || !data) {
    return null
  }
  return {
    userId,
    email: (data.notification_email as string | null) ?? (data.email as string | null),
    notifyEmailSwap: (data.notify_email_swap as boolean) ?? true,
    notifyPushSwap: (data.notify_push_swap as boolean) ?? true,
  }
}

// ── Swap típusok ─────────────────────────────────────────────────────────────

type SwapRequestRow = {
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
}

type SwapOfferRow = {
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

function isDateKey(value: string): boolean {
  return /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)
}

/** A `group_calendar_state.payload` JSON-ból névsor (szerkesztő fallbackhez). */
function extractChildrenRosterFromPayload(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return []
  }
  const raw = (payload as Record<string, unknown>).childrenText
  if (typeof raw !== 'string') {
    return []
  }
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

/**
 * Megjelenített név, felhasználónév és e-mail lokális része (≥4 karakteres tokenek).
 */
function harvestEditorTokens(
  displayName: string | null,
  preferredUsername: string | null,
  email: string | null,
): Set<string> {
  const tokens = new Set<string>()
  const harvest = (source: string | null) => {
    if (!source) {
      return
    }
    for (const part of source.split(/[\s._-]+/)) {
      const t = part.trim()
      if (t.length >= 4) {
        tokens.add(t.toLowerCase())
      }
    }
  }
  harvest(displayName)
  harvest(preferredUsername)
  const raw = email?.trim()
  if (raw) {
    const local = raw.split('@')[0]?.split('+')[0]?.trim() ?? ''
    harvest(local)
  }
  return tokens
}

function editorChildMatchesIdentityTokens(
  childName: string,
  displayName: string | null,
  preferredUsername: string | null,
  email: string | null,
): boolean {
  const tokens = harvestEditorTokens(displayName, preferredUsername, email)
  if (tokens.size === 0) {
    return false
  }
  const childLower = childName.trim().toLowerCase()
  return [...tokens].some((t) => childLower.includes(t))
}

/**
 * Ha nincs parent_child_links sor a Keycloak userhez (más user_id mint a demó seed),
 * a tokenek alapján megkeresi a gyerek(ek)et a névsorban.
 */
function inferEditorChildrenFromIdentity(
  displayName: string | null,
  preferredUsername: string | null,
  email: string | null,
  roster: string[],
): string[] {
  const tokens = harvestEditorTokens(displayName, preferredUsername, email)
  if (tokens.size === 0 || roster.length === 0) {
    return []
  }
  const out = new Set<string>()
  for (const token of tokens) {
    for (const child of roster) {
      if (child.toLowerCase().includes(token)) {
        out.add(child)
      }
    }
  }
  return [...out]
}

const DEMO_PARENT_USERNAME_CHILD: Record<string, string> = {
  'szulo1.demo': 'Marczell Zsombor Dániel',
  'szulo2.demo': 'Baló Olívia',
  'szulo3.demo': 'Burik Bendegúz',
  'szulo4.demo': 'Czakó Adél Luca',
}
const DEMO_PARENT_EMAIL_CHILD: Record<string, string> = {
  'szulo1@example.com': 'Marczell Zsombor Dániel',
  'szulo2@example.com': 'Baló Olívia',
  'szulo3@example.com': 'Burik Bendegúz',
  'szulo4@example.com': 'Czakó Adél Luca',
}

/** Keycloak demó szülők: „Szülő 2" név nem tartalmazza a gyerek nevét — fix kulcs username/email alapján. */
function demoLinkedChildForIdentity(preferredUsername: string | null, email: string | null): string | null {
  const u = preferredUsername?.trim().toLowerCase().replace(/_/g, '.')
  if (u && DEMO_PARENT_USERNAME_CHILD[u]) {
    return DEMO_PARENT_USERNAME_CHILD[u]
  }
  const e = email?.trim().toLowerCase()
  if (e && DEMO_PARENT_EMAIL_CHILD[e]) {
    return DEMO_PARENT_EMAIL_CHILD[e]
  }
  return null
}

/** A `resolveMembership` upsert eltérő PK-t adhat, mint a seedelt `parent_child_links`; ugyanarra az e-mailre lévő profilokat egyesítjük. */
async function collectProfileIdsForParentLinks(userId: string, email: string | null): Promise<string[]> {
  const ids = new Set<string>([userId])
  const raw = email?.trim()
  if (raw) {
    const { data: rows, error } = await supabase.from('user_profiles').select('id').ilike('email', raw)
    if (error) {
      throw new Error(error.message)
    }
    for (const r of rows ?? []) {
      if (r && typeof r.id === 'string') {
        ids.add(r.id)
      }
    }
  }
  return [...ids]
}

async function loadLinkedChildNames(
  groupId: string,
  role: AppRole,
  userId: string,
  identity: { email: string | null },
): Promise<string[] | null> {
  if (role === 'admin') {
    return null
  }
  if (role === 'viewer') {
    return []
  }
  const profileIds = await collectProfileIdsForParentLinks(userId, identity.email)
  const { data, error } = await supabase
    .from('parent_child_links')
    .select('child_name')
    .eq('group_id', groupId)
    .in('user_id', profileIds)
  if (error) {
    throw new Error(error.message)
  }
  const names = (data ?? [])
    .map((row) => (row && typeof (row as { child_name?: unknown }).child_name === 'string'
      ? (row as { child_name: string }).child_name.trim()
      : ''))
    .filter(Boolean)
  return [...new Set(names)]
}

async function ensureChildLinked(
  groupId: string,
  userId: string,
  childName: string,
  identity: { email: string | null; displayName: string | null; preferredUsername: string | null },
): Promise<void> {
  const profileIds = await collectProfileIdsForParentLinks(userId, identity.email)
  const { data, error } = await supabase
    .from('parent_child_links')
    .select('child_name')
    .eq('group_id', groupId)
    .in('user_id', profileIds)
    .eq('child_name', childName.trim())
    .limit(1)
    .maybeSingle()
  if (error) {
    throw new Error(error.message)
  }
  if (!data) {
    const { data: stateRow, error: stateErr } = await supabase
      .from('group_calendar_state')
      .select('payload')
      .eq('group_id', groupId)
      .maybeSingle()
    if (stateErr) {
      throw new Error(stateErr.message)
    }
    const roster = extractChildrenRosterFromPayload(stateRow?.payload ?? null)
    const inferred = inferEditorChildrenFromIdentity(
      identity.displayName,
      identity.preferredUsername,
      identity.email,
      roster,
    )
    const trimmed = childName.trim()
    const allowPersist = async (): Promise<void> => {
      const { error: upErr } = await supabase.from('parent_child_links').upsert(
        { group_id: groupId, user_id: userId, child_name: trimmed },
        { onConflict: 'group_id,user_id,child_name' },
      )
      if (upErr) {
        throw new Error(upErr.message)
      }
    }
    if (inferred.some((name) => name.trim() === trimmed)) {
      await allowPersist()
      return
    }
    if (editorChildMatchesIdentityTokens(trimmed, identity.displayName, identity.preferredUsername, identity.email)) {
      await allowPersist()
      return
    }
    const demoExpect = demoLinkedChildForIdentity(identity.preferredUsername, identity.email)
    if (demoExpect && trimmed === demoExpect) {
      await allowPersist()
      return
    }
    throw new Error(`Nincs parent-child mapping ehhez a gyerekhez: ${childName}`)
  }
}

async function loadSwapBoard(groupId: string): Promise<{ requests: Array<SwapRequestRow & { offers: SwapOfferRow[] }> }> {
  const { data: requests, error: requestsError } = await supabase
    .from('swap_requests')
    .select('*')
    .eq('group_id', groupId)
    .order('created_at', { ascending: false })
  if (requestsError) {
    throw new Error(requestsError.message)
  }
  const requestRows = (requests ?? []) as SwapRequestRow[]
  const requestIds = requestRows.map((r) => r.id)
  const offersByRequest = new Map<string, SwapOfferRow[]>()
  if (requestIds.length > 0) {
    const { data: offers, error: offersError } = await supabase
      .from('swap_offers')
      .select('*')
      .in('request_id', requestIds)
      .order('created_at', { ascending: true })
    if (offersError) {
      throw new Error(offersError.message)
    }
    for (const offer of (offers ?? []) as SwapOfferRow[]) {
      const list = offersByRequest.get(offer.request_id)
      if (list) {
        list.push(offer)
      } else {
        offersByRequest.set(offer.request_id, [offer])
      }
    }
  }
  return {
    requests: requestRows.map((request) => ({
      ...request,
      offers: offersByRequest.get(request.id) ?? [],
    })),
  }
}

// ── Fő handler ───────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(500, { error: 'Hiányzó Edge Function környezeti változók.' })
    }

    const token = getBearerToken(req)
    if (!token) {
      return json(401, { error: 'Hiányzó Bearer token.' })
    }

    const body = (await req.json()) as RequestBody
    const action = body.action ?? 'load'
    const groupId = body.groupId ?? DEFAULT_GROUP_ID
    if (!groupId) {
      return json(400, { error: 'Hiányzó groupId.' })
    }

    const desktopMode = Boolean(DESKTOP_ACCESS_TOKEN) && token === DESKTOP_ACCESS_TOKEN
    const identity = desktopMode
      ? {
          sub: 'demo-admin-sub',
          email: 'admin@example.com',
          displayName: 'admin.demo',
          preferredUsername: 'admin.demo',
          tokenRoles: ['admin'] as AppRole[],
        }
      : await verifyKeycloakJwt(token)
    const access = await resolveMembership(groupId, identity)

    // ── load ──────────────────────────────────────────────────────────────────

    if (action === 'load') {
      const { data, error } = await supabase
        .from('group_calendar_state')
        .select('payload')
        .eq('group_id', groupId)
        .maybeSingle()

      if (error) {
        return json(500, { error: `Lekérés sikertelen: ${error.message}` })
      }
      let linkedChildren: string[] | null
      try {
        linkedChildren = await loadLinkedChildNames(groupId, access.role, access.userId, {
          email: identity.email,
        })
      } catch (e) {
        const message = e instanceof Error ? e.message : 'linkedChildren lekérés sikertelen.'
        return json(500, { error: message })
      }
      if (
        access.role === 'editor' &&
        Array.isArray(linkedChildren) &&
        linkedChildren.length === 0
      ) {
        const roster = extractChildrenRosterFromPayload(data?.payload ?? null)
        const inferred = inferEditorChildrenFromIdentity(
          identity.displayName,
          identity.preferredUsername,
          identity.email,
          roster,
        )
        if (inferred.length > 0) {
          linkedChildren = inferred
        } else {
          const demo = demoLinkedChildForIdentity(identity.preferredUsername, identity.email)
          if (demo) {
            linkedChildren = [demo]
          }
        }
      }

      // Notification prefs visszaadása
      const { data: profilePrefs } = await supabase
        .from('user_profiles')
        .select('notification_email, notify_email_calendar, notify_push_calendar, notify_email_swap, notify_push_swap')
        .eq('id', access.userId)
        .maybeSingle()

      return json(200, {
        payload: data?.payload ?? null,
        role: access.role,
        displayName: identity.displayName,
        userProfileId: access.userId,
        linkedChildren,
        notificationPrefs: profilePrefs ?? null,
      })
    }

    // ── save ──────────────────────────────────────────────────────────────────

    if (action === 'save') {
      if (access.role === 'viewer') {
        return json(403, { error: 'Viewer szerepkörrel az írás tiltott.' })
      }
      const payload = body.payload
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return json(400, { error: 'Hiányzó vagy hibás payload.' })
      }
      const { error } = await supabase.from('group_calendar_state').upsert(
        {
          group_id: groupId,
          payload,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'group_id' },
      )
      if (error) {
        return json(500, { error: `Mentés sikertelen: ${error.message}` })
      }
      return json(200, { ok: true, role: access.role })
    }

    // ── swap_list ─────────────────────────────────────────────────────────────

    if (action === 'swap_list') {
      const board = await loadSwapBoard(groupId)
      if (access.role === 'admin') {
        return json(200, { ...board, role: access.role, userProfileId: access.userId })
      }
      if (access.role === 'viewer') {
        return json(200, { requests: [], role: access.role, userProfileId: access.userId })
      }
      const uid = access.userId
      const filtered = board.requests.filter(
        (r) =>
          r.requester_user_id === uid ||
          (r.status === 'requested' && r.requester_user_id !== uid),
      )
      return json(200, { requests: filtered, role: access.role, userProfileId: access.userId })
    }

    // ── swap_request_create ────────────────────────────────────────────────────

    if (action === 'swap_request_create') {
      if (access.role === 'viewer') {
        return json(403, { error: 'Viewer szerepkörrel csere kérés nem indítható.' })
      }
      const requesterChildName = body.requesterChildName?.trim() ?? ''
      const requesterDateKey = body.requesterDateKey?.trim() ?? ''
      if (!requesterChildName || !isDateKey(requesterDateKey)) {
        return json(400, { error: 'Hiányzó vagy hibás requesterChildName / requesterDateKey.' })
      }
      if (access.role !== 'admin') {
        await ensureChildLinked(groupId, access.userId, requesterChildName, {
          email: identity.email,
          displayName: identity.displayName,
          preferredUsername: identity.preferredUsername,
        })
      }
      const { data: openSameDate, error: openCheckErr } = await supabase
        .from('swap_requests')
        .select('id')
        .eq('group_id', groupId)
        .eq('requester_date_key', requesterDateKey)
        .eq('status', 'requested')
        .maybeSingle()
      if (openCheckErr) {
        return json(500, { error: `Csere kérés ellenőrzés sikertelen: ${openCheckErr.message}` })
      }
      if (openSameDate) {
        return json(409, {
          error: 'Erre a dátumra már van nyitott csere kérés. Vondd vissza vagy válassz másik napot.',
        })
      }
      const { data, error } = await supabase
        .from('swap_requests')
        .insert({
          group_id: groupId,
          requester_user_id: access.userId,
          requester_child_name: requesterChildName,
          requester_date_key: requesterDateKey,
          note: body.note?.trim() || null,
          status: 'requested',
        })
        .select('*')
        .single()
      if (error) {
        if (error.code === '23505') {
          return json(409, {
            error: 'Erre a dátumra már van nyitott csere kérés. Vondd vissza vagy válassz másik napot.',
          })
        }
        return json(500, { error: `Csere kérés mentése sikertelen: ${error.message}` })
      }
      await supabase.from('swap_events').insert({
        group_id: groupId,
        request_id: data.id,
        actor_user_id: access.userId,
        event_type: 'swap_request_created',
        payload: { requesterChildName, requesterDateKey },
      })
      // Értesítés: csoport összes editor+admin, kivéve a kérvényező
      const recipients = await loadGroupNotifyRecipients(groupId, access.userId)
      await notifyUsers(groupId, recipients, {
        event_type: 'swap_request_created',
        title: 'Új csere kérés',
        body: `${requesterChildName} (${requesterDateKey}) napjára cserét kért valaki.`,
        payload: { requesterChildName, requesterDateKey },
        request_id: data.id,
      })
      return json(200, { ok: true, request: data })
    }

    // ── swap_offer_create ─────────────────────────────────────────────────────

    if (action === 'swap_offer_create') {
      if (access.role === 'viewer') {
        return json(403, { error: 'Viewer szerepkörrel csere ajánlat nem adható.' })
      }
      const requestId = body.requestId?.trim() ?? ''
      const offerChildName = body.offerChildName?.trim() ?? ''
      const offerDateKey = body.offerDateKey?.trim() ?? ''
      if (!requestId || !offerChildName || !isDateKey(offerDateKey)) {
        return json(400, { error: 'Hiányzó vagy hibás requestId / offerChildName / offerDateKey.' })
      }
      if (access.role !== 'admin') {
        await ensureChildLinked(groupId, access.userId, offerChildName, {
          email: identity.email,
          displayName: identity.displayName,
          preferredUsername: identity.preferredUsername,
        })
      }
      const { data: requestRow, error: requestError } = await supabase
        .from('swap_requests')
        .select('*')
        .eq('id', requestId)
        .eq('group_id', groupId)
        .single()
      if (requestError || !requestRow) {
        return json(404, { error: 'Swap request nem található.' })
      }
      if ((requestRow as SwapRequestRow).status !== 'requested') {
        return json(409, { error: 'A swap request már nem aktív.' })
      }
      if ((requestRow as SwapRequestRow).requester_date_key === offerDateKey) {
        return json(409, { error: 'Ugyanarra a dátumra nem adhatsz csereajánlatot.' })
      }
      if ((requestRow as SwapRequestRow).requester_child_name.trim() === offerChildName.trim()) {
        return json(409, { error: 'Ugyanarra a gyerekre nem adhatsz csereajánlatot.' })
      }
      if ((requestRow as SwapRequestRow).requester_user_id === access.userId && access.role !== 'admin') {
        return json(400, { error: 'Saját kérésre nem adhatsz ajánlatot.' })
      }
      const { data: existingOffer, error: existingOfferError } = await supabase
        .from('swap_offers')
        .select('*')
        .eq('request_id', requestId)
        .eq('offer_user_id', access.userId)
        .eq('offer_date_key', offerDateKey)
        .maybeSingle()
      if (existingOfferError) {
        return json(500, { error: `Korábbi ajánlat lekérése sikertelen: ${existingOfferError.message}` })
      }
      if (existingOffer) {
        const existingStatus = (existingOffer as SwapOfferRow).status
        if (existingStatus === 'pending') {
          return json(409, { error: 'Ehhez a kéréshez erre a dátumra már adtál ajánlatot.' })
        }
        if (existingStatus === 'accepted') {
          return json(409, { error: 'Ez az ajánlat már elfogadott, nem nyitható újra.' })
        }
        const { data: reopenedOffer, error: reopenError } = await supabase
          .from('swap_offers')
          .update({
            offer_child_name: offerChildName,
            note: body.note?.trim() || null,
            status: 'pending',
            updated_at: new Date().toISOString(),
          })
          .eq('id', (existingOffer as SwapOfferRow).id)
          .select('*')
          .single()
        if (reopenError || !reopenedOffer) {
          return json(500, { error: `Visszavont ajánlat újranyitása sikertelen: ${reopenError?.message ?? 'ismeretlen hiba'}` })
        }
        await supabase.from('swap_events').insert({
          group_id: groupId,
          request_id: requestId,
          offer_id: reopenedOffer.id,
          actor_user_id: access.userId,
          event_type: 'swap_offer_created',
          payload: { offerChildName, offerDateKey, reopened: true },
        })
        // Értesítés: a kérés tulajdonosa + adminok
        const requesterRecipient = await loadUserNotifyRecipient((requestRow as SwapRequestRow).requester_user_id)
        const adminRecipients = await loadGroupNotifyRecipients(groupId, access.userId)
        const offerRecipients = [
          ...(requesterRecipient ? [requesterRecipient] : []),
          ...adminRecipients.filter((r) => r.userId !== (requestRow as SwapRequestRow).requester_user_id),
        ]
        await notifyUsers(groupId, offerRecipients, {
          event_type: 'swap_offer_created',
          title: 'Csereajánlat érkezett',
          body: `${offerChildName} (${offerDateKey}) napjára ajánlatot kaptál.`,
          payload: { offerChildName, offerDateKey },
          request_id: requestId,
          offer_id: reopenedOffer.id,
        })
        return json(200, { ok: true, offer: reopenedOffer })
      }
      const { data, error } = await supabase
        .from('swap_offers')
        .insert({
          request_id: requestId,
          offer_user_id: access.userId,
          offer_child_name: offerChildName,
          offer_date_key: offerDateKey,
          note: body.note?.trim() || null,
          status: 'pending',
          updated_at: new Date().toISOString(),
        })
        .select('*')
        .single()
      if (error) {
        if (error.code === '23505') {
          return json(409, { error: 'Ehhez a kéréshez erre a dátumra már van aktív ajánlatod.' })
        }
        return json(500, { error: `Csere ajánlat mentése sikertelen: ${error.message}` })
      }
      await supabase.from('swap_events').insert({
        group_id: groupId,
        request_id: requestId,
        offer_id: data.id,
        actor_user_id: access.userId,
        event_type: 'swap_offer_created',
        payload: { offerChildName, offerDateKey },
      })
      // Értesítés: a kérés tulajdonosa + adminok
      const requesterRecipient = await loadUserNotifyRecipient((requestRow as SwapRequestRow).requester_user_id)
      const adminRecipients = await loadGroupNotifyRecipients(groupId, access.userId)
      const offerRecipients = [
        ...(requesterRecipient ? [requesterRecipient] : []),
        ...adminRecipients.filter((r) => r.userId !== (requestRow as SwapRequestRow).requester_user_id),
      ]
      await notifyUsers(groupId, offerRecipients, {
        event_type: 'swap_offer_created',
        title: 'Csereajánlat érkezett',
        body: `${offerChildName} (${offerDateKey}) napjára ajánlatot kaptál.`,
        payload: { offerChildName, offerDateKey },
        request_id: requestId,
        offer_id: data.id,
      })
      return json(200, { ok: true, offer: data })
    }

    // ── swap_offer_withdraw ────────────────────────────────────────────────────

    if (action === 'swap_offer_withdraw') {
      const offerId = body.offerId?.trim() ?? ''
      if (!offerId) {
        return json(400, { error: 'Hiányzó offerId.' })
      }
      const { data: offer, error: offerReadError } = await supabase
        .from('swap_offers')
        .select('id,request_id,offer_user_id,status')
        .eq('id', offerId)
        .single()
      if (offerReadError || !offer) {
        return json(404, { error: 'Swap offer nem található.' })
      }
      if (offer.offer_user_id !== access.userId && access.role !== 'admin') {
        return json(403, { error: 'Csak a létrehozó vagy admin vonhatja vissza.' })
      }
      if (offer.status !== 'pending') {
        return json(409, { error: 'Csak pending ajánlat vonható vissza.' })
      }
      const { error } = await supabase
        .from('swap_offers')
        .update({ status: 'withdrawn', updated_at: new Date().toISOString() })
        .eq('id', offerId)
      if (error) {
        return json(500, { error: `Ajánlat visszavonás sikertelen: ${error.message}` })
      }
      await supabase.from('swap_events').insert({
        group_id: groupId,
        request_id: offer.request_id,
        offer_id: offerId,
        actor_user_id: access.userId,
        event_type: 'swap_offer_withdrawn',
        payload: {},
      })
      // Értesítés: a kérés tulajdonosa
      const { data: reqRow } = await supabase
        .from('swap_requests')
        .select('requester_user_id')
        .eq('id', offer.request_id)
        .maybeSingle()
      if (reqRow?.requester_user_id && reqRow.requester_user_id !== access.userId) {
        const recipient = await loadUserNotifyRecipient(reqRow.requester_user_id)
        if (recipient) {
          await notifyUsers(groupId, [recipient], {
            event_type: 'swap_offer_withdrawn',
            title: 'Csereajánlat visszavonva',
            body: 'Egy csereajánlatot visszavontak a kérésedről.',
            request_id: offer.request_id,
            offer_id: offerId,
          })
        }
      }
      return json(200, { ok: true })
    }

    // ── swap_request_withdraw ─────────────────────────────────────────────────

    if (action === 'swap_request_withdraw') {
      const requestId = body.requestId?.trim() ?? ''
      if (!requestId) {
        return json(400, { error: 'Hiányzó requestId.' })
      }
      const { data: requestRow, error: requestError } = await supabase
        .from('swap_requests')
        .select('*')
        .eq('id', requestId)
        .eq('group_id', groupId)
        .single()
      if (requestError || !requestRow) {
        return json(404, { error: 'Swap request nem található.' })
      }
      if ((requestRow as SwapRequestRow).requester_user_id !== access.userId && access.role !== 'admin') {
        return json(403, { error: 'Csak a kérvényező vagy admin vonhatja vissza a kérést.' })
      }
      if ((requestRow as SwapRequestRow).status !== 'requested') {
        return json(409, { error: 'Csak requested státuszú kérés vonható vissza.' })
      }
      // Ajánlattevők listája értesítéshez (visszavonás előtt)
      const { data: pendingOffers } = await supabase
        .from('swap_offers')
        .select('offer_user_id')
        .eq('request_id', requestId)
        .eq('status', 'pending')
      const offerUserIds = [...new Set((pendingOffers ?? []).map((o) => o.offer_user_id as string))]

      const { error: withdrawError } = await supabase.rpc('withdraw_swap_request', {
        p_group_id: groupId,
        p_request_id: requestId,
      })
      if (withdrawError) {
        return json(500, { error: `Kérés visszavonás sikertelen: ${withdrawError.message}` })
      }
      await supabase.from('swap_events').insert({
        group_id: groupId,
        request_id: requestId,
        actor_user_id: access.userId,
        event_type: 'swap_request_withdrawn',
        payload: {},
      })
      // Értesítés: mindenki a csoportban kivéve a visszavonó
      const withdrawRecipients = await loadGroupNotifyRecipients(groupId, access.userId)
      await notifyUsers(groupId, withdrawRecipients, {
        event_type: 'swap_request_withdrawn',
        title: 'Csere kérés visszavonva',
        body: `${(requestRow as SwapRequestRow).requester_child_name} (${(requestRow as SwapRequestRow).requester_date_key}) napjára visszavontak egy csere kérést.`,
        request_id: requestId,
      })
      void offerUserIds
      return json(200, { ok: true })
    }

    // ── swap_request_approve ──────────────────────────────────────────────────

    if (action === 'swap_request_approve') {
      const requestId = body.requestId?.trim() ?? ''
      const offerId = body.offerId?.trim() ?? ''
      if (!requestId || !offerId) {
        return json(400, { error: 'Hiányzó requestId/offerId.' })
      }
      const { data: requestRow, error: requestError } = await supabase
        .from('swap_requests')
        .select('*')
        .eq('id', requestId)
        .eq('group_id', groupId)
        .single()
      if (requestError || !requestRow) {
        return json(404, { error: 'Swap request nem található.' })
      }
      if ((requestRow as SwapRequestRow).requester_user_id !== access.userId && access.role !== 'admin') {
        return json(403, { error: 'Csak a kérvényező vagy admin hagyhat jóvá.' })
      }
      const { data: offerRow, error: offerErr } = await supabase
        .from('swap_offers')
        .select('offer_user_id, offer_child_name, offer_date_key')
        .eq('id', offerId)
        .maybeSingle()
      const offerUserId = offerRow?.offer_user_id as string | undefined
      const offerChildName = offerRow?.offer_child_name as string | undefined
      const offerDateKey = offerRow?.offer_date_key as string | undefined
      if (offerErr || !offerRow) {
        return json(404, { error: 'Swap offer nem található.' })
      }
      // Többi ajánlattevő lekérdezése az RPC előtt, amíg még 'pending' státuszban vannak
      const { data: otherOfferRows } = await supabase
        .from('swap_offers')
        .select('offer_user_id')
        .eq('request_id', requestId)
        .eq('status', 'pending')
        .neq('id', offerId)
      const otherOfferUserIds = [...new Set((otherOfferRows ?? []).map((o) => o.offer_user_id as string))]

      const { data: swappedPayload, error: swapError } = await supabase.rpc('apply_swap_offer', {
        p_group_id: groupId,
        p_request_id: requestId,
        p_offer_id: offerId,
      })
      if (swapError) {
        return json(500, { error: `Csere tranzakció hiba: ${swapError.message}` })
      }
      await supabase.from('swap_events').insert([
        {
          group_id: groupId,
          request_id: requestId,
          offer_id: offerId,
          actor_user_id: access.userId,
          event_type: 'swap_offer_accepted',
          payload: {},
        },
        {
          group_id: groupId,
          request_id: requestId,
          offer_id: offerId,
          actor_user_id: access.userId,
          event_type: 'swap_request_resolved',
          payload: {},
        },
      ])
      const req = requestRow as SwapRequestRow
      const notifyBodySuccess = `${req.requester_child_name} (${req.requester_date_key}) ↔ ${offerChildName ?? ''} (${offerDateKey ?? ''}) csere végrehajtva.`

      // Értesítés 1: igénylő + elfogadott ajánlattevő + adminok
      const allMembers = await loadGroupNotifyRecipients(groupId, null)
      const primaryRecipients = allMembers.filter((r) => !otherOfferUserIds.includes(r.userId))
      await notifyUsers(groupId, primaryRecipients, {
        event_type: 'swap_request_resolved',
        title: 'Csere lezárult',
        body: notifyBodySuccess,
        payload: { requesterChildName: req.requester_child_name, offerChildName, offerDateKey },
        request_id: requestId,
        offer_id: offerId,
      })

      // Értesítés 2: többi ajánlattevő — ajánlatuk nem lett kiválasztva
      if (otherOfferUserIds.length > 0) {
        const rejectedRecipients: NotifyRecipient[] = []
        for (const uid of otherOfferUserIds) {
          const r = await loadUserNotifyRecipient(uid)
          if (r) rejectedRecipients.push(r)
        }
        if (rejectedRecipients.length > 0) {
          await notifyUsers(groupId, rejectedRecipients, {
            event_type: 'swap_offer_rejected',
            title: 'Csere kérés lezárult',
            body: `${req.requester_child_name} (${req.requester_date_key}) napjára érkező csere kérést elfogadták, ajánlatod nem lett kiválasztva.`,
            request_id: requestId,
          })
        }
      }

      void offerUserId
      return json(200, { ok: true, payload: swappedPayload })
    }

    // ── swap_request_delete ────────────────────────────────────────────────────

    if (action === 'swap_request_delete') {
      if (access.role === 'viewer') {
        return json(403, { error: 'Viewer szerepkörrel kérés törlés nem engedélyezett.' })
      }
      const requestId = body.requestId?.trim() ?? ''
      if (!requestId) {
        return json(400, { error: 'Hiányzó requestId.' })
      }
      const { data: requestRow, error: requestError } = await supabase
        .from('swap_requests')
        .select('id,status,requester_user_id')
        .eq('id', requestId)
        .eq('group_id', groupId)
        .maybeSingle()
      if (requestError) {
        return json(500, { error: `Kérés lekérése sikertelen: ${requestError.message}` })
      }
      if (!requestRow) {
        return json(404, { error: 'Swap request nem található.' })
      }
      if (requestRow.status === 'requested') {
        return json(409, { error: 'Nyitott kérés nem törölhető. Előbb zárd le vagy vond vissza.' })
      }
      if (access.role !== 'admin' && requestRow.requester_user_id !== access.userId) {
        return json(403, { error: 'Csak a kérés létrehozója vagy admin törölheti.' })
      }
      const { error } = await supabase.from('swap_requests').delete().eq('id', requestId).eq('group_id', groupId)
      if (error) {
        return json(500, { error: `Kérés törlése: ${error.message}` })
      }
      return json(200, { ok: true })
    }

    // ── swap_requests_clear_closed ─────────────────────────────────────────────

    if (action === 'swap_requests_clear_closed') {
      if (access.role === 'viewer') {
        return json(403, { error: 'Viewer szerepkörrel törlés nem engedélyezett.' })
      }
      const { error } = await supabase
        .from('swap_requests')
        .delete()
        .eq('group_id', groupId)
        .in('status', ['resolved', 'withdrawn'])
      if (error) {
        return json(500, { error: `Lezárt/visszavont kérések törlése: ${error.message}` })
      }
      return json(200, { ok: true })
    }

    // ── notifications_list ────────────────────────────────────────────────────

    if (action === 'notifications_list') {
      const { data, error } = await supabase
        .from('swap_notifications')
        .select('*')
        .eq('user_id', access.userId)
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) {
        return json(500, { error: `Értesítések lekérése sikertelen: ${error.message}` })
      }
      return json(200, { notifications: data ?? [] })
    }

    // ── notifications_mark_read ───────────────────────────────────────────────

    if (action === 'notifications_mark_read') {
      const notifId = body.notificationId?.trim()
      let updateQuery = supabase
        .from('swap_notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('user_id', access.userId)
        .is('read_at', null)
      if (notifId) {
        updateQuery = updateQuery.eq('id', notifId)
      }
      const { error } = await updateQuery
      if (error) {
        return json(500, { error: `Olvasott jelölés sikertelen: ${error.message}` })
      }
      return json(200, { ok: true })
    }

    // ── push_subscribe ────────────────────────────────────────────────────────

    if (action === 'push_subscribe') {
      const endpoint = body.endpoint?.trim()
      const p256dh = body.p256dh?.trim()
      const authKey = body.authKey?.trim()
      if (!endpoint || !p256dh || !authKey) {
        return json(400, { error: 'Hiányzó endpoint/p256dh/authKey.' })
      }
      const { error } = await supabase
        .from('push_subscriptions')
        .upsert(
          { user_id: access.userId, endpoint, p256dh, auth_key: authKey },
          { onConflict: 'user_id,endpoint' },
        )
      if (error) {
        return json(500, { error: `Push feliratkozás mentése sikertelen: ${error.message}` })
      }
      return json(200, { ok: true })
    }

    // ── push_unsubscribe ──────────────────────────────────────────────────────

    if (action === 'push_unsubscribe') {
      const endpoint = body.endpoint?.trim()
      if (!endpoint) {
        return json(400, { error: 'Hiányzó endpoint.' })
      }
      const { error } = await supabase
        .from('push_subscriptions')
        .delete()
        .eq('user_id', access.userId)
        .eq('endpoint', endpoint)
      if (error) {
        return json(500, { error: `Push leiratkozás sikertelen: ${error.message}` })
      }
      return json(200, { ok: true })
    }

    // ── update_notification_prefs ─────────────────────────────────────────────

    if (action === 'update_notification_prefs') {
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
      // null szándékos: visszaállítás default (keycloak email) értékre
      if ('notificationEmail' in body) {
        updates.notification_email = body.notificationEmail ?? null
      }
      if (typeof body.notifyEmailCalendar === 'boolean') {
        updates.notify_email_calendar = body.notifyEmailCalendar
      }
      if (typeof body.notifyPushCalendar === 'boolean') {
        updates.notify_push_calendar = body.notifyPushCalendar
      }
      if (typeof body.notifyEmailSwap === 'boolean') {
        updates.notify_email_swap = body.notifyEmailSwap
      }
      if (typeof body.notifyPushSwap === 'boolean') {
        updates.notify_push_swap = body.notifyPushSwap
      }
      const { data: updatedRow, error } = await supabase
        .from('user_profiles')
        .update(updates)
        .eq('id', access.userId)
        .select('id, notification_email, notify_email_calendar, notify_push_calendar, notify_email_swap, notify_push_swap')
        .maybeSingle()
      if (error) {
        return json(500, { error: `Beállítások mentése sikertelen: ${error.message}` })
      }
      if (!updatedRow) {
        return json(404, {
          error: 'Profil nem található ehhez a bejelentkezéshez. Jelentkezz ki és újra be, vagy kérd az admin segítségét.',
        })
      }
      return json(200, { ok: true, notificationPrefs: updatedRow })
    }

    // ── parent_links_list (admin) ─────────────────────────────────────────────

    if (action === 'parent_links_list') {
      if (access.role !== 'admin') {
        return json(403, { error: 'Csak admin érheti el.' })
      }
      const { data: links, error: linksError } = await supabase
        .from('parent_child_links')
        .select('child_name, user_id, user_profiles(id, display_name, email)')
        .eq('group_id', groupId)
        .order('child_name', { ascending: true })
      if (linksError) {
        return json(500, { error: `Parent links lekérése sikertelen: ${linksError.message}` })
      }
      const { data: members, error: membersError } = await supabase
        .from('group_memberships')
        .select('user_id, role, user_profiles(id, display_name, email)')
        .eq('group_id', groupId)
        .in('role', ['editor', 'admin'])
      if (membersError) {
        return json(500, { error: `Tagok lekérése sikertelen: ${membersError.message}` })
      }
      return json(200, { links: links ?? [], members: members ?? [] })
    }

    // ── parent_links_set (admin) ──────────────────────────────────────────────

    if (action === 'parent_links_set') {
      if (access.role !== 'admin') {
        return json(403, { error: 'Csak admin érheti el.' })
      }
      const childName = body.childName?.trim()
      const userIds = body.userIds
      if (!childName || !Array.isArray(userIds)) {
        return json(400, { error: 'Hiányzó childName vagy userIds.' })
      }
      // Atomi replace: törlés + insert
      const { error: deleteError } = await supabase
        .from('parent_child_links')
        .delete()
        .eq('group_id', groupId)
        .eq('child_name', childName)
      if (deleteError) {
        return json(500, { error: `Hozzárendelés törlése sikertelen: ${deleteError.message}` })
      }
      if (userIds.length > 0) {
        const insertRows = userIds.map((uid: string) => ({
          group_id: groupId,
          user_id: uid,
          child_name: childName,
        }))
        const { error: insertError } = await supabase.from('parent_child_links').insert(insertRows)
        if (insertError) {
          return json(500, { error: `Hozzárendelés mentése sikertelen: ${insertError.message}` })
        }
      }
      return json(200, { ok: true })
    }

    return json(400, { error: 'Ismeretlen action.' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Ismeretlen hiba'
    console.error('[keycloak-gateway]', message)
    return json(500, { error: message })
  }
})
