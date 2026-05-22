/**
 * daily-fruit-reminder Edge Function
 *
 * Cron ütemezés: minden nap 05:00 UTC (= 07:00 nyári magyar idő)
 *   supabase/config.toml vagy Supabase Dashboard → Edge Functions → Schedules:
 *   cron: "0 5 * * *"
 *
 * Manuális teszt: POST + Authorization: Bearer <CRON_SECRET>
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DEFAULT_GROUP_ID,
 *      CRON_SECRET, RESEND_API_KEY, RESEND_FROM_EMAIL,
 *      VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const DEFAULT_GROUP_ID = Deno.env.get('DEFAULT_GROUP_ID') ?? ''
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? ''
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const RESEND_FROM_EMAIL = Deno.env.get('RESEND_FROM_EMAIL') ?? 'Gyümölcsnaptár <noreply@gyuminaptar.hu>'
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? ''

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

function jsonResp(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

// ── Naptár logika (calendar.ts egyszerűsített Deno másolata) ─────────────────

const HU_PUBLIC_HOLIDAYS: Record<string, boolean> = {
  '01-01': true, // Újév
  '03-15': true, // Nemzeti ünnep
  '05-01': true, // Munka ünnepe
  '08-20': true, // Államalapítás
  '10-23': true, // Forradalom
  '11-01': true, // Mindenszentek
  '12-25': true, // Karácsony
  '12-26': true, // Karácsony
}

function isPublicHoliday(year: number, month: number, day: number): boolean {
  // Húsvét és Pünkösd számítás (Gregorián)
  const easterOffset = getEasterOffset(year)
  const easterDate = new Date(year, 2, 21 + easterOffset) // március 21 + offset
  const pentecostDate = new Date(easterDate.getTime() + 49 * 86400000)
  const whitMondayDate = new Date(easterDate.getTime() + 50 * 86400000)
  const easterMondayDate = new Date(easterDate.getTime() + 86400000)

  const dateKey = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  if (HU_PUBLIC_HOLIDAYS[dateKey]) {
    return true
  }
  // Húsvét hétfő, Pünkösd vasárnap, Pünkösd hétfő
  for (const special of [easterMondayDate, pentecostDate, whitMondayDate]) {
    if (special.getFullYear() === year && special.getMonth() + 1 === month && special.getDate() === day) {
      return true
    }
  }
  return false
}

function getEasterOffset(year: number): number {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const day = h + l - 7 * m + 28
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  return day - (month === 3 ? 21 : 51)
}

function isWorkingDay(year: number, month: number, day: number, extraOffDays: Set<string>): boolean {
  const date = new Date(year, month - 1, day)
  const dow = date.getDay()
  if (dow === 0 || dow === 6) return false
  if (isPublicHoliday(year, month, day)) return false
  const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  if (extraOffDays.has(dateKey)) return false
  return true
}

/**
 * A payload-ból kiszámolja az adott dátumhoz rendelt gyerek nevét.
 * Ugyanaz a logika mint a React calendar.ts-ben.
 */
function computeAssignedChildForDate(payload: Record<string, unknown>, targetDateKey: string): string | null {
  const childrenText = typeof payload.childrenText === 'string' ? payload.childrenText : ''
  const children = childrenText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (children.length === 0) return null

  const startChildByMonth = (payload.startChildByMonth ?? {}) as Record<string, string>
  const monthOffDaysByMonth = (payload.monthOffDaysByMonth ?? {}) as Record<string, string>
  const manualOverridesByMonth = (payload.manualOverridesByMonth ?? {}) as Record<string, Record<string, string>>
  const excludedChildrenByMonth = (payload.excludedChildrenByMonth ?? {}) as Record<string, string[]>

  // Célhónap
  const [targetYear, targetMonth] = targetDateKey.split('-').map(Number)
  if (!targetYear || !targetMonth) return null
  const monthKey = `${targetYear}-${String(targetMonth).padStart(2, '0')}`

  // Az előző hónapok startChild értékeit végig kell futtatni a monthKey-ig
  // hogy megtudjuk az aktuális hónap startChild-ját.
  // Egyszerűsítés: a payload startChildByMonth[monthKey] ha elérhető, azt használjuk.
  const startChild = startChildByMonth[monthKey] ?? children[0]
  const extraOffText = monthOffDaysByMonth[monthKey] ?? ''
  const extraOffDays = new Set<string>(
    extraOffText.split('\n').map((l) => l.trim()).filter(Boolean),
  )
  const manualOverrides: Record<string, string> = manualOverridesByMonth[monthKey] ?? {}
  const excludedChildren: string[] = excludedChildrenByMonth[monthKey] ?? []
  const excluded = new Set(excludedChildren)

  const findNextAllowedIndex = (fromIndex: number, clean: string[]): number => {
    for (let step = 0; step < clean.length; step++) {
      const idx = (fromIndex + step) % clean.length
      if (!excluded.has(clean[idx])) return idx
    }
    return -1
  }

  // Hónap összes munkanapja sorrendben
  const daysInMonth = new Date(targetYear, targetMonth, 0).getDate()
  let currentIndex = Math.max(children.indexOf(startChild), 0)

  for (let d = 1; d <= daysInMonth; d++) {
    if (!isWorkingDay(targetYear, targetMonth, d, extraOffDays)) continue
    const dateKey = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const override = manualOverrides[dateKey]
    const overrideIdx = override ? children.indexOf(override) : -1
    const hasValidOverride = overrideIdx >= 0
    const allowedIdx = findNextAllowedIndex(currentIndex, children)
    const planned = allowedIdx >= 0 ? children[allowedIdx] : ''
    const assigned = hasValidOverride ? override : planned

    if (dateKey === targetDateKey) {
      return assigned || null
    }

    if (assigned) {
      currentIndex = (children.indexOf(assigned) + 1) % children.length
    } else {
      currentIndex = (currentIndex + 1) % children.length
    }
  }
  return null
}

// ── Web Push (VAPID) ─────────────────────────────────────────────────────────

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
  for (const byte of array) str += String.fromCharCode(byte)
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

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

async function sendWebPush(endpoint: string, p256dh: string, authKey: string, title: string, body: string): Promise<void> {
  if (!VAPID_PRIVATE_KEY || !VAPID_PUBLIC_KEY || !VAPID_SUBJECT) return
  const url = new URL(endpoint)
  const audience = `${url.protocol}//${url.hostname}`
  let vapidJwt: string
  try {
    vapidJwt = await buildVapidJwt(audience)
  } catch (e) {
    console.warn('[push] VAPID JWT hiba:', e)
    return
  }
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${vapidJwt},k=${VAPID_PUBLIC_KEY}`,
      'Content-Type': 'application/json',
      TTL: '86400',
    },
    body: JSON.stringify({ title, body }),
  })
  void p256dh
  void authKey
  if (!response.ok && response.status !== 201) {
    console.warn(`[push] Hiba (${response.status})`)
  }
}

// ── Email (Resend) ────────────────────────────────────────────────────────────

async function sendResendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!RESEND_API_KEY) return
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: RESEND_FROM_EMAIL, to: [to], subject, html }),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    console.warn(`[email] Resend hiba (${response.status}): ${text}`)
  }
}

function buildReminderHtml(childName: string, dateKey: string): string {
  return `<!DOCTYPE html>
<html lang="hu">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:sans-serif;color:#222;max-width:520px;margin:0 auto;padding:24px">
  <h2 style="color:#2d7a2d">Holnap gyümölcsnap</h2>
  <p>Holnap (${dateKey}) <strong>${childName}</strong> hozza a gyümölcsöt az óvodába.</p>
  <p style="margin-top:32px"><a href="https://next.gyuminaptar.hu" style="color:#2d7a2d">Megnyitás: Gyümölcsnaptár</a></p>
  <p style="color:#888;font-size:12px;margin-top:24px">Értesítési beállításaidat a saját profiloldaladon módosíthatod.</p>
</body>
</html>`
}

// ── Holnapi dátum Europe/Budapest időzónában ──────────────────────────────────

function getTomorrowDateKeyBudapest(): string {
  const now = new Date()
  // Europe/Budapest UTC+1 (téli) / UTC+2 (nyári) — Intl.DateTimeFormat-tal pontosan
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Budapest',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const todayBudapest = formatter.format(now) // yyyy-MM-dd
  const [y, m, d] = todayBudapest.split('-').map(Number)
  const tomorrow = new Date(y, m - 1, d + 1)
  const ty = tomorrow.getFullYear()
  const tm = String(tomorrow.getMonth() + 1).padStart(2, '0')
  const td = String(tomorrow.getDate()).padStart(2, '0')
  return `${ty}-${tm}-${td}`
}

// ── Fő logika ─────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  // CRON_SECRET ellenőrzés
  const authHeader = req.headers.get('authorization') ?? ''
  const providedSecret = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : ''
  if (!CRON_SECRET || providedSecret !== CRON_SECRET) {
    return jsonResp(401, { error: 'Hiányzó vagy érvénytelen CRON_SECRET.' })
  }

  const groupId = DEFAULT_GROUP_ID
  if (!groupId) {
    return jsonResp(500, { error: 'Hiányzó DEFAULT_GROUP_ID.' })
  }

  const tomorrowKey = getTomorrowDateKeyBudapest()
  const [ty, tm, td] = tomorrowKey.split('-').map(Number)

  // Dedup: már küldtünk-e erre a napra?
  const { data: logRow } = await supabase
    .from('fruit_reminder_log')
    .select('group_id')
    .eq('group_id', groupId)
    .eq('reminder_for_date', tomorrowKey)
    .maybeSingle()

  if (logRow) {
    return jsonResp(200, { skipped: true, reason: 'already_sent', date: tomorrowKey })
  }

  // Munkanap?
  const extraOffDays = new Set<string>() // payload-ból töltjük fel
  const { data: stateRow } = await supabase
    .from('group_calendar_state')
    .select('payload')
    .eq('group_id', groupId)
    .maybeSingle()

  const payload = (stateRow?.payload ?? {}) as Record<string, unknown>
  const monthKey = `${ty}-${String(tm).padStart(2, '0')}`
  const monthOffDaysText = (payload.monthOffDaysByMonth as Record<string, string> | undefined)?.[monthKey] ?? ''
  for (const line of monthOffDaysText.split('\n').map((l) => l.trim()).filter(Boolean)) {
    extraOffDays.add(line)
  }

  if (!isWorkingDay(ty, tm, td, extraOffDays)) {
    return jsonResp(200, { skipped: true, reason: 'not_working_day', date: tomorrowKey })
  }

  // Holnap kiosztott gyerek
  const assignedChild = computeAssignedChildForDate(payload, tomorrowKey)
  if (!assignedChild) {
    return jsonResp(200, { skipped: true, reason: 'no_child_assigned', date: tomorrowKey })
  }

  // Érintett szülők
  const { data: links, error: linksError } = await supabase
    .from('parent_child_links')
    .select('user_id')
    .eq('group_id', groupId)
    .eq('child_name', assignedChild)

  if (linksError) {
    return jsonResp(500, { error: `parent_child_links hiba: ${linksError.message}` })
  }

  const userIds = (links ?? []).map((l) => l.user_id as string)
  if (userIds.length === 0) {
    // Nincs hozzárendelt szülő → log + return
    await supabase.from('fruit_reminder_log').insert({ group_id: groupId, reminder_for_date: tomorrowKey })
    return jsonResp(200, { ok: true, childName: assignedChild, date: tomorrowKey, notified: 0, reason: 'no_parents_linked' })
  }

  // Szülők preferenciái
  const { data: profiles } = await supabase
    .from('user_profiles')
    .select('id, email, notification_email, notify_email_calendar, notify_push_calendar')
    .in('id', userIds)

  const subject = `Holnap gyümölcsnap: ${assignedChild}`
  const html = buildReminderHtml(assignedChild, tomorrowKey)
  const pushTitle = 'Holnap gyümölcsnap'
  const pushBody = `${assignedChild} hozza holnap (${tomorrowKey}) a gyümölcsöt.`
  let notified = 0

  const tasks: Promise<void>[] = []
  for (const profile of profiles ?? []) {
    const emailAddr = (profile.notification_email as string | null) ?? (profile.email as string | null)
    const doEmail = (profile.notify_email_calendar as boolean) ?? true
    const doPush = (profile.notify_push_calendar as boolean) ?? true

    if (doEmail && emailAddr) {
      tasks.push(sendResendEmail(emailAddr, subject, html).catch((e) => console.warn('[reminder] email hiba:', e)))
      notified++
    }
    if (doPush) {
      tasks.push(
        (async () => {
          const { data: subs } = await supabase
            .from('push_subscriptions')
            .select('endpoint, p256dh, auth_key')
            .eq('user_id', profile.id)
          for (const sub of subs ?? []) {
            await sendWebPush(
              sub.endpoint as string,
              sub.p256dh as string,
              sub.auth_key as string,
              pushTitle,
              pushBody,
            ).catch((e) => console.warn('[reminder] push hiba:', e))
          }
        })(),
      )
    }
  }
  await Promise.allSettled(tasks)

  // Dedup log commit
  await supabase.from('fruit_reminder_log').insert({ group_id: groupId, reminder_for_date: tomorrowKey })

  return jsonResp(200, { ok: true, childName: assignedChild, date: tomorrowKey, notified })
})
