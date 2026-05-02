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
  groupId?: string
  payload?: unknown
  requestId?: string
  offerId?: string
  requesterChildName?: string
  requesterDateKey?: string
  offerChildName?: string
  offerDateKey?: string
  note?: string
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const DEFAULT_GROUP_ID = Deno.env.get('DEFAULT_GROUP_ID') ?? ''

const KEYCLOAK_ISSUER = Deno.env.get('KEYCLOAK_ISSUER') ?? ''
const KEYCLOAK_AUDIENCE = Deno.env.get('KEYCLOAK_AUDIENCE') ?? ''
const KEYCLOAK_JWKS_URL = Deno.env.get('KEYCLOAK_JWKS_URL') ?? ''
const DESKTOP_ACCESS_TOKEN = Deno.env.get('DESKTOP_ACCESS_TOKEN') ?? ''

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
    if (inferred.some((name) => name.trim() === trimmed)) {
      return
    }
    if (editorChildMatchesIdentityTokens(trimmed, identity.displayName, identity.preferredUsername, identity.email)) {
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
        }
      }
      return json(200, {
        payload: data?.payload ?? null,
        role: access.role,
        displayName: identity.displayName,
        userProfileId: access.userId,
        linkedChildren,
      })
    }

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
      return json(200, { ok: true, request: data })
    }

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
      return json(200, { ok: true, offer: data })
    }

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
      return json(200, { ok: true })
    }

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
      return json(200, { ok: true })
    }

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
      return json(200, { ok: true, payload: swappedPayload })
    }

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

    return json(400, { error: 'Ismeretlen action.' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Ismeretlen hiba'
    return json(401, { error: message })
  }
})
