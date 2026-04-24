import {
  APP_STATE_SCHEMA_VERSION,
  type AppStatePayload,
  type AppUserRole,
  type CloudLoadResult,
  type HeaderImageState,
} from './cloudTypes'
import {
  getDefaultGroupId,
  getDesktopAccessToken,
  getFunctionUrl,
  getSupabase,
  isDesktopAuthEnabled,
  isKeycloakAuthEnabled,
} from './supabaseClient'

const HEADER_KEY = 'fruit-calendar-header-image'

function isHeaderImageState(v: unknown): v is HeaderImageState {
  if (!v || typeof v !== 'object') {
    return false
  }
  const o = v as Record<string, unknown>
  return (
    typeof o.dataUrl === 'string' &&
    typeof o.width === 'number' &&
    typeof o.height === 'number' &&
    typeof o.updatedAt === 'number'
  )
}

function isValidUiTheme(s: string): s is AppStatePayload['uiTheme'] {
  return s === 'elegant' || s === 'pastel' || s === 'minimal'
}

function parseStartChildByMonth(
  o: unknown,
  fallback: Record<string, string>,
): Record<string, string> {
  if (!o || typeof o !== 'object') {
    return fallback
  }
  return { ...fallback, ...o } as Record<string, string>
}

/**
 * A Supabase `jsonb` mezőből érkezett adatot ellenőrzi, és visszaadja, vagy null, ha hibás.
 */
export function parseAppStatePayload(raw: unknown): AppStatePayload | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return null
  }
  const p = raw as Record<string, unknown>
  if (p.schemaVersion !== 1) {
    return null
  }
  if (
    typeof p.startChildByMonth !== 'object' ||
    p.startChildByMonth == null ||
    Array.isArray(p.startChildByMonth)
  ) {
    return null
  }
  if (typeof p.childrenText !== 'string' || typeof p.monthValue !== 'string') {
    return null
  }
  if (!isValidUiTheme(p.uiTheme as string)) {
    return null
  }
  if (typeof p.darkMode !== 'boolean' || typeof p.settingsPanelOpen !== 'boolean') {
    return null
  }
  if (p.headerImage != null && !isHeaderImageState(p.headerImage)) {
    return null
  }
  if (
    typeof p.monthOffDaysByMonth !== 'object' ||
    p.monthOffDaysByMonth == null ||
    Array.isArray(p.monthOffDaysByMonth)
  ) {
    return null
  }
  if (
    typeof p.manualOverridesByMonth !== 'object' ||
    p.manualOverridesByMonth == null ||
    Array.isArray(p.manualOverridesByMonth)
  ) {
    return null
  }
  const excludedChildrenByMonth =
    p.excludedChildrenByMonth && typeof p.excludedChildrenByMonth === 'object' && !Array.isArray(p.excludedChildrenByMonth)
      ? (p.excludedChildrenByMonth as Record<string, unknown>)
      : {}

  return {
    schemaVersion: APP_STATE_SCHEMA_VERSION,
    childrenText: p.childrenText,
    monthValue: p.monthValue,
    startChildByMonth: parseStartChildByMonth(p.startChildByMonth, { '2026-02': 'Petrilla Ádám' }),
    monthOffDaysByMonth: p.monthOffDaysByMonth as Record<string, string>,
    manualOverridesByMonth: p.manualOverridesByMonth as Record<string, Record<string, string>>,
    excludedChildrenByMonth: Object.fromEntries(
      Object.entries(excludedChildrenByMonth).map(([month, value]) => [
        month,
        Array.isArray(value) ? value.filter((name): name is string => typeof name === 'string') : [],
      ]),
    ),
    headerImage: p.headerImage == null || !isHeaderImageState(p.headerImage) ? null : p.headerImage,
    uiTheme: p.uiTheme as AppStatePayload['uiTheme'],
    darkMode: p.darkMode,
    settingsPanelOpen: p.settingsPanelOpen,
  }
}

async function fetchViaKeycloakGateway(accessToken: string): Promise<CloudLoadResult> {
  const endpoint = getFunctionUrl('keycloak-gateway')
  const groupId = getDefaultGroupId()
  if (!endpoint || !groupId) {
    throw new Error('A keycloak-gateway endpoint nincs konfigurálva.')
  }
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ action: 'load', groupId }),
  })
  const json = (await response.json()) as {
    payload?: unknown
    role?: AppUserRole
    displayName?: string | null
    userProfileId?: string | null
    error?: string
  }

  if (!response.ok) {
    throw new Error(json.error ?? 'Sikertelen felhő lekérés.')
  }
  const payload = json.payload ? parseAppStatePayload(json.payload) : null
  return {
    payload,
    role: json.role ?? 'viewer',
    displayName: json.displayName ?? null,
    userProfileId: json.userProfileId ?? null,
  }
}

async function fetchPublicReadOnlyState(): Promise<CloudLoadResult> {
  const supabase = getSupabase()
  const groupId = getDefaultGroupId()
  if (!supabase || !groupId) {
    return { payload: null, role: 'viewer', displayName: null, userProfileId: null }
  }
  const { data, error } = await supabase
    .from('group_calendar_state')
    .select('payload')
    .eq('group_id', groupId)
    .maybeSingle()

  if (error) {
    throw new Error(`Publikus felhő lekérés: ${error.message}`)
  }
  return {
    payload: data?.payload ? parseAppStatePayload(data.payload) : null,
    role: 'viewer',
    displayName: null,
    userProfileId: null,
  }
}

export async function fetchGroupState(params?: {
  accessToken?: string | null
}): Promise<CloudLoadResult> {
  const gatewayMode = isKeycloakAuthEnabled() || isDesktopAuthEnabled()
  if (gatewayMode) {
    const token = params?.accessToken ?? getDesktopAccessToken()
    if (!token) {
      return fetchPublicReadOnlyState()
    }
    return fetchViaKeycloakGateway(token)
  }

  const supabase = getSupabase()
  const groupId = getDefaultGroupId()
  if (!supabase || !groupId) {
    return { payload: null, role: 'admin', displayName: null }
  }
  const { data, error } = await supabase
    .from('group_calendar_state')
    .select('payload')
    .eq('group_id', groupId)
    .maybeSingle()

  if (error) {
    throw new Error(`Supabase lekérés: ${error.message}`)
  }
  return {
    payload: data?.payload ? parseAppStatePayload(data.payload) : null,
    role: 'admin',
    displayName: null,
    userProfileId: null,
  }
}

export async function saveGroupState(
  payload: AppStatePayload,
  params?: { accessToken?: string | null; role?: AppUserRole },
): Promise<void> {
  const gatewayMode = isKeycloakAuthEnabled() || isDesktopAuthEnabled()
  if (gatewayMode) {
    const token = params?.accessToken ?? getDesktopAccessToken()
    if (!token) {
      return
    }
    if (params?.role === 'viewer') {
      return
    }
    const endpoint = getFunctionUrl('keycloak-gateway')
    const groupId = getDefaultGroupId()
    if (!endpoint || !groupId) {
      return
    }
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ action: 'save', groupId, payload }),
    })
    if (!response.ok) {
      const json = (await response.json().catch(() => ({}))) as { error?: string }
      throw new Error(json.error ?? 'Sikertelen felhő mentés.')
    }
    return
  }

  const supabase = getSupabase()
  const groupId = getDefaultGroupId()
  if (!supabase || !groupId) {
    return
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
    throw new Error(`Supabase mentés: ${error.message}`)
  }
}

function persistHeaderToLocalStorage(header: HeaderImageState | null): void {
  if (header) {
    try {
      localStorage.setItem(HEADER_KEY, JSON.stringify(header))
    } catch (e) {
      console.warn('localStorage (fejléckép) mentés sikertelen', e)
    }
  } else {
    try {
      localStorage.removeItem(HEADER_KEY)
    } catch (e) {
      console.warn('localStorage (fejléckép) törlés sikertelen', e)
    }
  }
}

/**
 * A felhőből visszajövő nézet alkalmazása. Hívás után a már meglévő `useEffect`-ek szinkronizálják a
 * hónap / szülő állapotot.
 */
export function applyAppStatePayload(
  result: CloudLoadResult,
  setters: {
    setChildrenText: (v: string) => void
    setMonthValue: (v: string) => void
    setStartChildByMonth: (v: Record<string, string>) => void
    setMonthOffDaysByMonth: (v: Record<string, string>) => void
    setManualOverridesByMonth: (v: Record<string, Record<string, string>>) => void
    setExcludedChildrenByMonth: (v: Record<string, string[]>) => void
    setHeaderImage: (v: HeaderImageState | null) => void
    setUiTheme: (v: 'elegant' | 'pastel' | 'minimal') => void
    setDarkMode: (v: boolean) => void
    setSettingsPanelOpen: (v: boolean) => void
    setStartChild: (v: string) => void
    setExtraOffDaysText: (v: string) => void
    setManualOverrides: (v: Record<string, string>) => void
  },
): void {
  const p = result.payload
  if (!p) {
    return
  }
  const {
    setChildrenText,
    setMonthValue,
    setStartChildByMonth,
    setMonthOffDaysByMonth,
    setManualOverridesByMonth,
    setExcludedChildrenByMonth,
    setHeaderImage,
    setUiTheme,
    setDarkMode,
    setSettingsPanelOpen,
    setStartChild,
    setExtraOffDaysText,
    setManualOverrides,
  } = setters
  const mergedStart: Record<string, string> = { '2026-02': 'Petrilla Ádám', ...p.startChildByMonth }
  setChildrenText(p.childrenText)
  setMonthValue(p.monthValue)
  setStartChildByMonth(mergedStart)
  setMonthOffDaysByMonth(p.monthOffDaysByMonth)
  setManualOverridesByMonth(p.manualOverridesByMonth)
  setExcludedChildrenByMonth(p.excludedChildrenByMonth ?? {})
  setHeaderImage(p.headerImage)
  // UI theme remains device-local: do not apply cloud values.
  void setUiTheme
  void setDarkMode
  setSettingsPanelOpen(p.settingsPanelOpen)
  persistHeaderToLocalStorage(p.headerImage)
  setStartChild(mergedStart[p.monthValue] ?? mergedStart['2026-02'] ?? 'Petrilla Ádám')
  setExtraOffDaysText(p.monthOffDaysByMonth[p.monthValue] ?? '')
  setManualOverrides(p.manualOverridesByMonth[p.monthValue] ?? {})
}

export function buildAppStatePayload(s: {
  childrenText: string
  monthValue: string
  startChildByMonth: Record<string, string>
  monthOffDaysByMonth: Record<string, string>
  manualOverridesByMonth: Record<string, Record<string, string>>
  excludedChildrenByMonth: Record<string, string[]>
  headerImage: HeaderImageState | null
  uiTheme: 'elegant' | 'pastel' | 'minimal'
  darkMode: boolean
  settingsPanelOpen: boolean
}): AppStatePayload {
  return {
    schemaVersion: APP_STATE_SCHEMA_VERSION,
    childrenText: s.childrenText,
    monthValue: s.monthValue,
    startChildByMonth: { ...s.startChildByMonth },
    monthOffDaysByMonth: { ...s.monthOffDaysByMonth },
    manualOverridesByMonth: { ...s.manualOverridesByMonth },
    excludedChildrenByMonth: { ...s.excludedChildrenByMonth },
    headerImage: s.headerImage,
    uiTheme: s.uiTheme,
    darkMode: s.darkMode,
    settingsPanelOpen: s.settingsPanelOpen,
  }
}

