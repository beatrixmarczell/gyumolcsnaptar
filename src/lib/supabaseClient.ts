import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { AppStatePayload } from './cloudTypes'

export type GroupCalendarStateRow = {
  group_id: string
  payload: AppStatePayload
  updated_at: string
}

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

let client: SupabaseClient | null = null

export function isSupabaseConfigured(): boolean {
  return Boolean(url && anon && String(url).startsWith('http'))
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
