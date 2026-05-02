import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { AppStatePayload } from './cloudTypes'

export type GroupCalendarStateRow = {
  group_id: string
  payload: AppStatePayload
  updated_at: string
}

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
const authMode = (import.meta.env.VITE_AUTH_MODE as string | undefined)?.toLowerCase() ?? 'none'
const desktopAccessToken = import.meta.env.VITE_DESKTOP_ACCESS_TOKEN as string | undefined

let client: SupabaseClient | null = null

export function isSupabaseConfigured(): boolean {
  return Boolean(url && anon && String(url).startsWith('http'))
}

export function getSupabaseUrl(): string | null {
  return isSupabaseConfigured() && url ? url : null
}

export function getDefaultGroupId(): string | null {
  const id = import.meta.env.VITE_DEFAULT_GROUP_ID as string | undefined
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return null
  }
  return id
}

export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured() || !url || !anon) {
    return null
  }
  if (!client) {
    client = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return client
}

export function isCloudSyncAvailable(): boolean {
  return isSupabaseConfigured() && getDefaultGroupId() !== null
}

export function getAuthMode(): 'none' | 'keycloak' | 'desktop' {
  if (authMode === 'keycloak') {
    return 'keycloak'
  }
  if (authMode === 'desktop') {
    return 'desktop'
  }
  return 'none'
}

export function isKeycloakAuthEnabled(): boolean {
  return getAuthMode() === 'keycloak'
}

export function isDesktopAuthEnabled(): boolean {
  return getAuthMode() === 'desktop'
}

export function getDesktopAccessToken(): string | null {
  if (!isDesktopAuthEnabled()) {
    return null
  }
  const token = desktopAccessToken?.trim()
  return token ? token : null
}

export function getFunctionUrl(functionName: string): string | null {
  if (!url) {
    return null
  }
  return `${url}/functions/v1/${functionName}`
}

/** Edge Functions: publikus anon kulcs a `apikey` fejléchez. */
export function getSupabaseAnonKey(): string | null {
  const k = anon?.trim()
  return k || null
}

/** Böngészős fetch a Functions API felé: apikey + Authorization (Keycloak JWT). */
export function buildEdgeFunctionHeaders(bearerToken: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${bearerToken}`,
  }
  const anonKey = getSupabaseAnonKey()
  if (anonKey) {
    headers.apikey = anonKey
  }
  return headers
}
