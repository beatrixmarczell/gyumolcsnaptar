import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'
import { createRemoteJWKSet, jwtVerify } from 'https://esm.sh/jose@5.9.6'

type AppRole = 'admin' | 'editor' | 'viewer'

type RequestBody = {
  action?: 'load' | 'save'
  groupId?: string
  payload?: unknown
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
          sub: 'desktop-local',
          email: null,
          displayName: 'Desktop User',
          preferredUsername: 'desktop.local',
          tokenRoles: ['admin'] as AppRole[],
        }
      : await verifyKeycloakJwt(token)
    const access = desktopMode
      ? { role: 'admin' as AppRole, userId: 'desktop-local' }
      : await resolveMembership(groupId, identity)

    if (action === 'load') {
      const { data, error } = await supabase
        .from('group_calendar_state')
        .select('payload')
        .eq('group_id', groupId)
        .maybeSingle()

      if (error) {
        return json(500, { error: `Lekérés sikertelen: ${error.message}` })
      }
      return json(200, {
        payload: data?.payload ?? null,
        role: access.role,
        displayName: identity.displayName,
        userProfileId: access.userId,
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

    return json(400, { error: 'Ismeretlen action.' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Ismeretlen hiba'
    return json(401, { error: message })
  }
})
