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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
}> {
  if (!KEYCLOAK_JWKS_URL) {
    throw new Error('Hiányzó KEYCLOAK_JWKS_URL.')
  }
  const jwks = createRemoteJWKSet(new URL(KEYCLOAK_JWKS_URL))
  const { payload } = await jwtVerify(token, jwks, {
    issuer: KEYCLOAK_ISSUER,
    audience: KEYCLOAK_AUDIENCE,
  })
  const sub = typeof payload.sub === 'string' ? payload.sub : null
  if (!sub) {
    throw new Error('Hiányzó subject (sub) claim.')
  }
  const email = typeof payload.email === 'string' ? payload.email : null
  const displayName = typeof payload.name === 'string' ? payload.name : email
  return { sub, email, displayName }
}

async function resolveMembership(
  groupId: string,
  identity: { sub: string; email: string | null; displayName: string | null },
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

  const { data: membership, error: membershipError } = await supabase
    .from('group_memberships')
    .select('role')
    .eq('group_id', groupId)
    .eq('user_id', profileRow.id)
    .maybeSingle()

  if (membershipError) {
    throw new Error(membershipError.message)
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
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !KEYCLOAK_JWKS_URL || !KEYCLOAK_ISSUER || !KEYCLOAK_AUDIENCE) {
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

    const identity = await verifyKeycloakJwt(token)
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
      return json(200, {
        payload: data?.payload ?? null,
        role: access.role,
        displayName: identity.displayName,
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
