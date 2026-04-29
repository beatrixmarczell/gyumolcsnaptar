import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import {
  addOneMonth,
  generateAssignments,
  getMonthWorkingDays,
  isPublicHolidayDate,
  monthLabel,
  toDateKey,
} from './calendar'
import type { AppUserRole, HeaderImageState } from './lib/cloudTypes'
import { getAccessToken, initAuth, isKeycloakConfigured, login, logout } from './lib/auth/keycloakAuth'
import { isKeycloakAuthEnabled } from './lib/supabaseClient'
import {
  applyAppStatePayload,
  buildAppStatePayload,
  fetchGroupState,
  saveGroupState,
} from './lib/supabaseState'
import {
  approveSwapOffer,
  createSwapOffer,
  createSwapRequest,
  deleteSwapRequest,
  loadSwapRequests,
  withdrawSwapOffer,
  withdrawSwapRequest,
  type SwapRequest,
} from './lib/swapWorkflow'

const defaultChildren = [
  'Balassa-Molcsán Hunor',
  'Baló Olívia',
  'Burik Bendegúz',
  'Czakó Adél Luca',
  'Fehér Noémi Anna',
  'Gulyás Annabella',
  'Horváth Mira Viola',
  'Huszár Tamás',
  'Imre Léna',
  'Juhász Botond',
  'Kardos Bori',
  'Keczéry Mátyás Mór',
  'Kulcsár Adrienn',
  'Lobont Péter Lajos',
  'Mag Milán',
  'Marczell Zsombor Dániel',
  'Németh Levente Kolos',
  'Palotás Petra',
  'Péter-Kiss Laura',
  'Petrilla Ádám',
  'Szabó Anna Bella',
  'Ujhelyi Marcell',
  'Yuann Louis Zhuo',
  'Zsoldos Tamás',
]

const weekdays = ['Hétfő', 'Kedd', 'Szerda', 'Csütörtök', 'Péntek']
const EXTRA_OFF_DAYS_STORAGE_KEY = 'fruit-calendar-extra-off-days-by-month'
const START_CHILD_STORAGE_KEY = 'fruit-calendar-start-child-by-month'
const MANUAL_OVERRIDES_STORAGE_KEY = 'fruit-calendar-manual-overrides-by-month'
const EXCLUDED_CHILDREN_STORAGE_KEY = 'fruit-calendar-excluded-children-by-month'
const CHILDREN_TEXT_STORAGE_KEY = 'fruit-calendar-children-text'
const LAST_MONTH_STORAGE_KEY = 'fruit-calendar-last-month'
const UI_THEME_STORAGE_KEY = 'fruit-calendar-ui-theme'
const DARK_MODE_STORAGE_KEY = 'fruit-calendar-dark-mode'
const SETTINGS_PANEL_OPEN_STORAGE_KEY = 'fruit-calendar-settings-panel-open'
const OFFDAY_LABELS_STORAGE_KEY = 'fruit-calendar-offday-labels-by-month'
const MANUAL_SAVE_SNAPSHOT_STORAGE_KEY = 'fruit-calendar-manual-save-snapshot'
const DEFAULT_OFFDAY_LABEL = 'Nevelés nélküli nap'
const PDF_TEMPLATE_VERSION = 'PDF_TEMPLATE_V4'
const APP_VERSION = __APP_VERSION__
const APP_CHANNEL = __APP_CHANNEL__
const APP_VERSION_DISPLAY = (() => {
  const match = APP_VERSION.match(/v?\d+\.\d+\.\d+/i)
  if (!match) {
    return APP_VERSION
  }
  const core = match[0].replace(/^v/i, '')
  return `v${core}`
})()
const IS_NEXT_CHANNEL = APP_CHANNEL === 'next'

// Next branch is intentionally isolated from shared DB sync.
const CLOUD_SYNC = false
const KEYCLOAK_AUTH = isKeycloakAuthEnabled()
const CLOUD_SAVE_DEBOUNCE_MS = 1000
const KEYCLOAK_URL = (import.meta.env.VITE_KEYCLOAK_URL as string | undefined) ?? ''
const LOCAL_GATEWAY_BEARER_TOKEN = (import.meta.env.VITE_LOCAL_GATEWAY_BEARER_TOKEN as string | undefined)?.trim() ?? ''
const SWAP_ADMIN_TEST_MODE = import.meta.env.VITE_SWAP_ADMIN_TEST_MODE === 'true'

const rolePriority: Record<AppUserRole, number> = {
  viewer: 0,
  editor: 1,
  admin: 2,
}

function keepHigherRole(current: AppUserRole, incoming: AppUserRole): AppUserRole {
  return rolePriority[incoming] > rolePriority[current] ? incoming : current
}

function fromMonthInputValue(value: string): { year: number; monthIndex: number } {
  const [yearText, monthText] = value.split('-')
  const year = Number(yearText)
  const monthIndex = Number(monthText) - 1
  return { year, monthIndex }
}

function parseDateKeys(text: string): string[] {
  return [...new Set(text.split('\n').map((line) => line.trim()).filter(Boolean))].sort()
}

function serializeDateKeys(keys: string[]): string {
  return [...new Set(keys)].sort().join('\n')
}

function enumerateDateKeysInclusive(fromDateKey: string, toDateKeyValue: string): string[] {
  const from = new Date(`${fromDateKey}T00:00:00`)
  const to = new Date(`${toDateKeyValue}T00:00:00`)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
    return []
  }
  const out: string[] = []
  const cursor = new Date(from)
  while (cursor <= to) {
    const day = cursor.getDay()
    if (day >= 1 && day <= 5) {
      out.push(toDateKey(cursor))
    }
    cursor.setDate(cursor.getDate() + 1)
  }
  return out
}

function toMonthValue(year: number, monthIndex: number): string {
  return `${year}-${`${monthIndex + 1}`.padStart(2, '0')}`
}

function addMonths(baseYear: number, baseMonthIndex: number, delta: number): { year: number; monthIndex: number } {
  const date = new Date(baseYear, baseMonthIndex + delta, 1)
  return { year: date.getFullYear(), monthIndex: date.getMonth() }
}

type ManualSaveSnapshot = {
  payload: ReturnType<typeof buildAppStatePayload>
  savedAt: number
}

function mapSwapUiError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Ismeretlen hiba.'
  if (message.toLowerCase().includes('ismeretlen action')) {
    return 'A swap backend action még nincs ezen a környezeten.'
  }
  return message
}

/** DB-ből jövő státuszkód → magyar felirat a teszt panelen */
function labelSwapRequestStatus(s: string): string {
  const m: Record<string, string> = {
    requested: 'nyitott kérés',
    withdrawn: 'visszavonott kérés',
    resolved: 'lezárt (a csere lefutott)',
  }
  return m[s] ?? s
}

function labelSwapOfferStatus(s: string): string {
  const m: Record<string, string> = {
    pending: 'ajánlat függőben',
    accepted: 'elfogadott ajánlat',
    rejected: 'visszavont vagy elutasított ajánlat',
    auto_rejected: 'automatikusan elutasított (más ajánlat lett elfogadva)',
    withdrawn: 'visszavont ajánlat',
  }
  return m[s] ?? s
}


function App() {
  const [childrenText, setChildrenText] = useState(() => {
    return localStorage.getItem(CHILDREN_TEXT_STORAGE_KEY) ?? defaultChildren.join('\n')
  })
  const [monthValue, setMonthValue] = useState(() => {
    return localStorage.getItem(LAST_MONTH_STORAGE_KEY) ?? '2026-02'
  })
  const [startChildByMonth, setStartChildByMonth] = useState<Record<string, string>>(() => {
    try {
      const stored = localStorage.getItem(START_CHILD_STORAGE_KEY)
      if (!stored) {
        return { '2026-02': 'Petrilla Ádám' }
      }
      const parsed = JSON.parse(stored) as Record<string, string>
      if (!parsed || typeof parsed !== 'object') {
        return { '2026-02': 'Petrilla Ádám' }
      }
      return { '2026-02': 'Petrilla Ádám', ...parsed }
    } catch {
      return { '2026-02': 'Petrilla Ádám' }
    }
  })
  const [startChild, setStartChild] = useState(() => {
    return startChildByMonth['2026-02'] ?? 'Petrilla Ádám'
  })
  const [monthOffDaysByMonth, setMonthOffDaysByMonth] = useState<Record<string, string>>(() => {
    try {
      const stored = localStorage.getItem(EXTRA_OFF_DAYS_STORAGE_KEY)
      if (!stored) {
        return {}
      }
      const parsed = JSON.parse(stored) as Record<string, string>
      if (!parsed || typeof parsed !== 'object') {
        return {}
      }
      return parsed
    } catch {
      return {}
    }
  })
  const [extraOffDaysText, setExtraOffDaysText] = useState(() => {
    return monthOffDaysByMonth['2026-02'] ?? ''
  })
  const [offDaySelectionAnchor, setOffDaySelectionAnchor] = useState<string | null>(null)
  const [offDayDragMode, setOffDayDragMode] = useState<'add' | 'remove' | null>(null)
  const offDayDragTouchedRef = useRef<Set<string>>(new Set())
  const [manualOverridesByMonth, setManualOverridesByMonth] = useState<
    Record<string, Record<string, string>>
  >(() => {
    try {
      const stored = localStorage.getItem(MANUAL_OVERRIDES_STORAGE_KEY)
      if (!stored) {
        return {}
      }
      const parsed = JSON.parse(stored) as Record<string, Record<string, string>>
      if (!parsed || typeof parsed !== 'object') {
        return {}
      }
      return parsed
    } catch {
      return {}
    }
  })
  const [excludedChildrenByMonth, setExcludedChildrenByMonth] = useState<Record<string, string[]>>(() => {
    try {
      const stored = localStorage.getItem(EXCLUDED_CHILDREN_STORAGE_KEY)
      if (!stored) {
        return {}
      }
      const parsed = JSON.parse(stored) as Record<string, unknown>
      if (!parsed || typeof parsed !== 'object') {
        return {}
      }
      return Object.fromEntries(
        Object.entries(parsed).map(([month, value]) => [
          month,
          Array.isArray(value) ? value.filter((name): name is string => typeof name === 'string') : [],
        ]),
      )
    } catch {
      return {}
    }
  })
  const [headerImage, setHeaderImage] = useState<HeaderImageState | null>(() => {
    const stored = localStorage.getItem('fruit-calendar-header-image')
    if (!stored) {
      return null
    }
    try {
      const parsed = JSON.parse(stored) as Partial<HeaderImageState>
      if (parsed?.dataUrl && (parsed?.width ?? 0) > 0 && (parsed?.height ?? 0) > 0) {
        return {
          dataUrl: parsed.dataUrl,
          width: parsed.width!,
          height: parsed.height!,
          updatedAt: parsed.updatedAt ?? Date.now(),
        }
      }
    } catch {
      if (stored.startsWith('data:image/')) {
        return { dataUrl: stored, width: 1200, height: 600, updatedAt: Date.now() }
      }
    }
    return null
  })
  const [uiTheme, setUiTheme] = useState<'elegant' | 'pastel' | 'minimal'>(() => {
    const stored = localStorage.getItem(UI_THEME_STORAGE_KEY)
    if (stored === 'pastel' || stored === 'minimal' || stored === 'elegant') {
      return stored
    }
    return 'elegant'
  })
  const [darkMode, setDarkMode] = useState(() => {
    return localStorage.getItem(DARK_MODE_STORAGE_KEY) === 'true'
  })
  const [settingsPanelOpen, setSettingsPanelOpen] = useState(() => {
    const stored = localStorage.getItem(SETTINGS_PANEL_OPEN_STORAGE_KEY)
    if (stored === null) {
      return false
    }
    return stored === 'true'
  })
  const [offDayLabelsByMonth, setOffDayLabelsByMonth] = useState<Record<string, Record<string, string>>>(() => {
    try {
      const stored = localStorage.getItem(OFFDAY_LABELS_STORAGE_KEY)
      if (!stored) {
        return {}
      }
      const parsed = JSON.parse(stored) as Record<string, unknown>
      if (!parsed || typeof parsed !== 'object') {
        return {}
      }
      return Object.fromEntries(
        Object.entries(parsed).map(([month, value]) => [
          month,
          value && typeof value === 'object' && !Array.isArray(value)
            ? Object.fromEntries(
                Object.entries(value).filter(
                  (entry): entry is [string, string] => typeof entry[0] === 'string' && typeof entry[1] === 'string',
                ),
              )
            : {},
        ]),
      )
    } catch {
      return {}
    }
  })
  const [cloudStatus, setCloudStatus] = useState<'off' | 'loading' | 'ok' | 'err'>(() => {
    return CLOUD_SYNC ? 'loading' : 'off'
  })
  const [canSaveToCloud, setCanSaveToCloud] = useState(!CLOUD_SYNC)
  const [authReady, setAuthReady] = useState(!KEYCLOAK_AUTH)
  const [isAuthenticated, setIsAuthenticated] = useState(!KEYCLOAK_AUTH)
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [userDisplayName, setUserDisplayName] = useState<string | null>(null)
  const [userRole, setUserRole] = useState<AppUserRole>(KEYCLOAK_AUTH ? 'viewer' : 'admin')
  const [userProfileId, setUserProfileId] = useState<string | null>(null)
  const [manualSaveSnapshot, setManualSaveSnapshot] = useState<ManualSaveSnapshot | null>(() => {
    try {
      const stored = localStorage.getItem(MANUAL_SAVE_SNAPSHOT_STORAGE_KEY)
      if (!stored) {
        return null
      }
      const parsed = JSON.parse(stored) as Partial<ManualSaveSnapshot>
      if (!parsed || typeof parsed !== 'object' || typeof parsed.savedAt !== 'number' || !parsed.payload) {
        return null
      }
      return {
        payload: parsed.payload as ReturnType<typeof buildAppStatePayload>,
        savedAt: parsed.savedAt,
      }
    } catch {
      return null
    }
  })
  const [isManualSaveBusy, setIsManualSaveBusy] = useState(false)
  const [isRestoreBusy, setIsRestoreBusy] = useState(false)
  const [childFilter, setChildFilter] = useState('')
  const [swapRequests, setSwapRequests] = useState<SwapRequest[]>([])
  const [swapLoading, setSwapLoading] = useState(false)
  const [swapError, setSwapError] = useState<string | null>(null)
  const [swapRequestDateKey, setSwapRequestDateKey] = useState('')
  const [swapOfferDateByRequest, setSwapOfferDateByRequest] = useState<Record<string, string>>({})
  const [swapBusy, setSwapBusy] = useState(false)
  const [showClosedSwapRequests] = useState(false)
  const [swapPanelOpen, setSwapPanelOpen] = useState(true)
  const [childFilterPanelOpen, setChildFilterPanelOpen] = useState(true)
  const [editingOffDayLabelCellKey, setEditingOffDayLabelCellKey] = useState<string | null>(null)
  const [editingOffDayLabelValue, setEditingOffDayLabelValue] = useState(DEFAULT_OFFDAY_LABEL)
  const cloudBootstrapStarted = useRef(false)
  const forcedMonthStartRef = useRef<{ monthValue: string; startChild: string } | null>(null)
  const calendarMonthPickerRef = useRef<HTMLInputElement | null>(null)
  const offDayLabelInputRef = useRef<HTMLInputElement | null>(null)

  const canEdit = KEYCLOAK_AUTH
    ? isAuthenticated && (userRole === 'admin' || userRole === 'editor')
    : true
  const useLocalGatewayToken = KEYCLOAK_AUTH && KEYCLOAK_URL.startsWith('http://localhost') && Boolean(LOCAL_GATEWAY_BEARER_TOKEN)
  const gatewayAccessToken = useLocalGatewayToken ? LOCAL_GATEWAY_BEARER_TOKEN : accessToken
  const themeModeValue = darkMode ? 'dark' : uiTheme
  const { year, monthIndex } = fromMonthInputValue(monthValue)

  useEffect(() => {
    if (!KEYCLOAK_AUTH) {
      return
    }
    const run = async (): Promise<void> => {
      const session = await initAuth()
      setAuthReady(true)
      setIsAuthenticated(session.authenticated)
      setUserRole(session.role)
      setUserDisplayName(session.displayName ?? session.email)
      if (!session.authenticated) {
        // Viewer mode: only show cloud "loading" when sync is actually enabled (waiting for login).
        if (CLOUD_SYNC) {
          setCloudStatus('loading')
          setCanSaveToCloud(true)
        }
        setAccessToken(null)
        return
      }
      const token = (await getAccessToken()) ?? session.token
      setAccessToken(token ?? null)
    }
    void run()
  }, [])

  useEffect(() => {
    if (!CLOUD_SYNC) {
      return
    }
    if (KEYCLOAK_AUTH && !authReady) {
      return
    }
    const hasToken = Boolean(gatewayAccessToken)
    if (KEYCLOAK_AUTH && isAuthenticated && !hasToken) {
      setCloudStatus('off')
      return
    }
    if (cloudBootstrapStarted.current) {
      return
    }
    cloudBootstrapStarted.current = true
    const run = async (): Promise<void> => {
      setCloudStatus('loading')
      try {
        const remote = await fetchGroupState({ accessToken: gatewayAccessToken })
        setUserRole((prev) => keepHigherRole(prev, remote.role))
        setUserProfileId(remote.userProfileId ?? null)
        if (remote.displayName) {
          setUserDisplayName(remote.displayName)
        }
        if (remote.payload) {
          applyAppStatePayload(remote, {
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
            setOffDayLabelsByMonth,
            setStartChild,
            setExtraOffDaysText,
            setManualOverrides: () => {},
          })
        }
        setCloudStatus('ok')
      } catch (e) {
        console.error('Felhő betöltés:', e)
        setCloudStatus('err')
      } finally {
        setCanSaveToCloud(true)
      }
    }
    void run()
  }, [authReady, isAuthenticated, gatewayAccessToken])

  useEffect(() => {
    if (!CLOUD_SYNC || !canSaveToCloud) {
      return
    }
    if (KEYCLOAK_AUTH && (!isAuthenticated || !gatewayAccessToken || !canEdit)) {
      return
    }
    const payload = buildAppStatePayload({
      childrenText,
      monthValue,
      startChildByMonth,
      monthOffDaysByMonth,
      manualOverridesByMonth,
      excludedChildrenByMonth,
      headerImage,
      uiTheme,
      darkMode,
      settingsPanelOpen,
      offDayLabelsByMonth,
    })
    const timer = setTimeout(() => {
      void saveGroupState(payload, { accessToken: gatewayAccessToken, role: userRole })
        .then(() => setCloudStatus('ok'))
        .catch((e) => {
          console.error('Felhő mentés:', e)
          setCloudStatus('err')
        })
    }, CLOUD_SAVE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [
    childrenText,
    monthValue,
    startChildByMonth,
    monthOffDaysByMonth,
    manualOverridesByMonth,
    excludedChildrenByMonth,
    headerImage,
    uiTheme,
    darkMode,
    settingsPanelOpen,
    offDayLabelsByMonth,
    canSaveToCloud,
    isAuthenticated,
    gatewayAccessToken,
    userRole,
    canEdit,
  ])

  useEffect(() => {
    setExtraOffDaysText(monthOffDaysByMonth[monthValue] ?? '')
  }, [monthValue, monthOffDaysByMonth])

  useEffect(() => {
    const forced = forcedMonthStartRef.current
    if (forced && forced.monthValue === monthValue) {
      setStartChild(forced.startChild)
      setStartChildByMonth((prev) => ({
        ...prev,
        [monthValue]: forced.startChild,
      }))
      forcedMonthStartRef.current = null
      return
    }
    const remembered = startChildByMonth[monthValue]
    if (remembered) {
      setStartChild(remembered)
    }
  }, [monthValue, startChildByMonth])

  useEffect(() => {
    try {
      localStorage.setItem(EXTRA_OFF_DAYS_STORAGE_KEY, JSON.stringify(monthOffDaysByMonth))
    } catch (error) {
      console.warn('Extra off-day localStorage save failed:', error)
    }
  }, [monthOffDaysByMonth])

  useEffect(() => {
    try {
      localStorage.setItem(START_CHILD_STORAGE_KEY, JSON.stringify(startChildByMonth))
    } catch (error) {
      console.warn('Start child localStorage save failed:', error)
    }
  }, [startChildByMonth])

  useEffect(() => {
    try {
      localStorage.setItem(MANUAL_OVERRIDES_STORAGE_KEY, JSON.stringify(manualOverridesByMonth))
    } catch (error) {
      console.warn('Manual overrides localStorage save failed:', error)
    }
  }, [manualOverridesByMonth])

  useEffect(() => {
    try {
      localStorage.setItem(EXCLUDED_CHILDREN_STORAGE_KEY, JSON.stringify(excludedChildrenByMonth))
    } catch (error) {
      console.warn('Excluded children localStorage save failed:', error)
    }
  }, [excludedChildrenByMonth])

  useEffect(() => {
    try {
      localStorage.setItem(CHILDREN_TEXT_STORAGE_KEY, childrenText)
    } catch (error) {
      console.warn('Children text localStorage save failed:', error)
    }
  }, [childrenText])

  useEffect(() => {
    try {
      localStorage.setItem(LAST_MONTH_STORAGE_KEY, monthValue)
    } catch (error) {
      console.warn('Last month localStorage save failed:', error)
    }
  }, [monthValue])

  useEffect(() => {
    localStorage.setItem(UI_THEME_STORAGE_KEY, uiTheme)
  }, [uiTheme])

  useEffect(() => {
    localStorage.setItem(DARK_MODE_STORAGE_KEY, `${darkMode}`)
  }, [darkMode])

  useEffect(() => {
    localStorage.setItem(SETTINGS_PANEL_OPEN_STORAGE_KEY, `${settingsPanelOpen}`)
  }, [settingsPanelOpen])

  useEffect(() => {
    localStorage.setItem(OFFDAY_LABELS_STORAGE_KEY, JSON.stringify(offDayLabelsByMonth))
  }, [offDayLabelsByMonth])

  useEffect(() => {
    if (!editingOffDayLabelCellKey) {
      return
    }
    offDayLabelInputRef.current?.focus()
    offDayLabelInputRef.current?.select()
  }, [editingOffDayLabelCellKey])

  const children = useMemo(() => {
    return childrenText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  }, [childrenText])

  useEffect(() => {
    if (children.length === 0) {
      return
    }
    if (!children.includes(startChild)) {
      const fallback = children[0]
      setStartChild(fallback)
      setStartChildByMonth((prev) => ({
        ...prev,
        [monthValue]: fallback,
      }))
    }
  }, [children, startChild, monthValue])

  const extraOffDays = useMemo(() => {
    return new Set(parseDateKeys(extraOffDaysText))
  }, [extraOffDaysText])
  const extraOffDayList = useMemo(() => parseDateKeys(extraOffDaysText), [extraOffDaysText])
  const workingDays = useMemo(
    () => getMonthWorkingDays(year, monthIndex, extraOffDays),
    [year, monthIndex, extraOffDays],
  )
  const manualOverrides = useMemo(() => manualOverridesByMonth[monthValue] ?? {}, [manualOverridesByMonth, monthValue])
  const offDayLabelsForMonth = useMemo(() => offDayLabelsByMonth[monthValue] ?? {}, [offDayLabelsByMonth, monthValue])
  const excludedChildren = useMemo(() => excludedChildrenByMonth[monthValue] ?? [], [excludedChildrenByMonth, monthValue])
  const filteredChild = useMemo(() => {
    const normalized = childFilter.trim().toLowerCase()
    if (!normalized) {
      return ''
    }
    return children.find((name) => name.toLowerCase() === normalized) ?? ''
  }, [childFilter, children])

  const monthResult = useMemo(() => {
    return generateAssignments({
      children,
      monthWorkingDays: workingDays,
      startChild,
      manualOverrides,
      excludedChildren: [],
    })
  }, [children, workingDays, startChild, manualOverrides, excludedChildren])
  const assignedChildByDateKey = useMemo(() => {
    const map = new Map<string, string>()
    for (const entry of monthResult.assignments) {
      map.set(toDateKey(entry.date), entry.child)
    }
    return map
  }, [monthResult.assignments])
  const displayedAssignments = useMemo(() => {
    const rows: ReturnType<typeof generateAssignments>['assignments'] = []
    const current = new Date(year, monthIndex, 1)
    while (current.getMonth() === monthIndex) {
      const day = current.getDay()
      if (day >= 1 && day <= 5) {
        const date = new Date(current)
        const dateKey = toDateKey(date)
        rows.push({
          date,
          dateKey,
          child: assignedChildByDateKey.get(dateKey) ?? '',
        })
      }
      current.setDate(current.getDate() + 1)
    }
    return rows
  }, [year, monthIndex, assignedChildByDateKey])
  const weeks = useMemo(() => chunkByWeek(displayedAssignments), [displayedAssignments])
  const exportTitle = useMemo(() => {
    return `GYÜMÖLCSNAPTÁR - ${monthNameHuLong(monthIndex).toUpperCase()}`
  }, [monthIndex])
  const printPreviewHtml = useMemo(() => {
    return buildPdfHtml({
      title: exportTitle,
      weekdays,
      weeks,
      offDayDateKeys: new Set(extraOffDayList),
      offDayLabelsByDateKey: offDayLabelsForMonth,
      headerImage,
      displayYear: year,
      displayMonthIndex: monthIndex,
    })
  }, [exportTitle, weeks, extraOffDayList, offDayLabelsForMonth, headerImage, year, monthIndex])
  const printPreviewFrameHtml = useMemo(() => {
    return buildResponsivePreviewHtml(printPreviewHtml)
  }, [printPreviewHtml])
  const printPreviewFrameKey = useMemo(() => {
    return `${monthValue}:${extraOffDaysText}:${JSON.stringify(offDayLabelsForMonth)}:${JSON.stringify(manualOverrides)}:${printPreviewHtml.length}`
  }, [monthValue, extraOffDaysText, offDayLabelsForMonth, manualOverrides, printPreviewHtml])
  const currentPayload = useMemo(
    () =>
      buildAppStatePayload({
        childrenText,
        monthValue,
        startChildByMonth,
        monthOffDaysByMonth,
        manualOverridesByMonth,
        excludedChildrenByMonth,
        headerImage,
        uiTheme,
        darkMode,
        settingsPanelOpen,
        offDayLabelsByMonth,
      }),
    [
      childrenText,
      monthValue,
      startChildByMonth,
      monthOffDaysByMonth,
      manualOverridesByMonth,
      excludedChildrenByMonth,
      headerImage,
      uiTheme,
      darkMode,
      settingsPanelOpen,
      offDayLabelsByMonth,
    ],
  )
  const currentPayloadSignature = useMemo(() => JSON.stringify(currentPayload), [currentPayload])
  const manualSnapshotSignature = useMemo(
    () => (manualSaveSnapshot ? JSON.stringify(manualSaveSnapshot.payload) : null),
    [manualSaveSnapshot],
  )
  const canCreateManualSave = canEdit && !isManualSaveBusy && currentPayloadSignature !== manualSnapshotSignature
  const canRestoreLastManualSave = canEdit && !isRestoreBusy && Boolean(manualSaveSnapshot)
  const isAdminDemoUser = useMemo(() => {
    const normalized = (userDisplayName ?? '').trim().toLowerCase()
    return normalized === 'admin.demo' || normalized === 'admin_demo' || normalized.includes('demo admin')
  }, [userDisplayName])
  const swapAdminTestEnabled =
    SWAP_ADMIN_TEST_MODE && KEYCLOAK_AUTH && isAuthenticated && userRole === 'admin'
  const visibleSwapRequests = useMemo(
    () => (showClosedSwapRequests ? swapRequests : swapRequests.filter((request) => request.status === 'requested')),
    [showClosedSwapRequests, swapRequests],
  )
  const monthDateKeys = useMemo(() => workingDays.map((d) => toDateKey(d)), [workingDays])
  /** A naptár aktuális állapota dátum kulcsonként (kérés/ajánlat listán a tárolt név helyett ezt mutatjuk). */
  const currentChildNameByDateKey = useMemo(() => {
    const out = new Map<string, string>(assignedChildByDateKey)
    const needed = new Set<string>()
    for (const r of swapRequests) {
      needed.add(r.requester_date_key)
      for (const o of r.offers) {
        needed.add(o.offer_date_key)
      }
    }
    for (const dateKey of needed) {
      if (out.has(dateKey)) {
        continue
      }
      const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey)
      if (!parsed) {
        continue
      }
      const y = Number(parsed[1])
      const monthNum = Number(parsed[2])
      const monthValue = `${parsed[1]}-${parsed[2]}`
      const monthIndex0 = monthNum - 1
      const slotOffDays = new Set(parseDateKeys(monthOffDaysByMonth[monthValue] ?? ''))
      const slotWorkingDays = getMonthWorkingDays(y, monthIndex0, slotOffDays)
      const slotOverrides = manualOverridesByMonth[monthValue] ?? {}
      const slotStartChild = startChildByMonth[monthValue] ?? startChild
      const slotResult = generateAssignments({
        children,
        monthWorkingDays: slotWorkingDays,
        startChild: slotStartChild,
        manualOverrides: slotOverrides,
        excludedChildren: [],
      })
      const found = slotResult.assignments.find((a) => a.dateKey === dateKey)
      if (found?.child) {
        out.set(dateKey, found.child)
      }
    }
    return out
  }, [
    assignedChildByDateKey,
    swapRequests,
    monthOffDaysByMonth,
    startChildByMonth,
    manualOverridesByMonth,
    children,
    startChild,
  ])
  const childFilterMonths = useMemo(() => {
    const monthSlots = [0, 1, 2].map((offset) => {
      const slot = addMonths(year, monthIndex, offset)
      const slotMonthValue = toMonthValue(slot.year, slot.monthIndex)
      return {
        ...slot,
        monthValue: slotMonthValue,
        label: monthLabel(slot.year, slot.monthIndex),
      }
    })

    if (!filteredChild || children.length === 0) {
      return monthSlots.map((slot) => ({
        ...slot,
        dates: [] as string[],
      }))
    }

    let rollingStartChild = startChild
    return monthSlots.map((slot, idx) => {
      const slotOverrides = manualOverridesByMonth[slot.monthValue] ?? {}
      const slotOffDays = new Set(parseDateKeys(monthOffDaysByMonth[slot.monthValue] ?? ''))
      const slotWorkingDays = getMonthWorkingDays(slot.year, slot.monthIndex, slotOffDays)
      const explicitStart = startChildByMonth[slot.monthValue]
      const slotStartChild = idx === 0 ? startChild : explicitStart ?? rollingStartChild ?? children[0] ?? ''
      const slotResult = generateAssignments({
        children,
        monthWorkingDays: slotWorkingDays,
        startChild: slotStartChild,
        manualOverrides: slotOverrides,
        excludedChildren: [],
      })
      rollingStartChild = slotResult.nextStartChild || slotStartChild
      const dates = slotResult.assignments
        .filter((entry) => entry.child === filteredChild)
        .map((entry) => toDateKey(entry.date))
      return {
        ...slot,
        dates,
      }
    })
  }, [
    filteredChild,
    children,
    year,
    monthIndex,
    manualOverridesByMonth,
    monthOffDaysByMonth,
    startChildByMonth,
    startChild,
  ])

  const continueWithNextMonth = (): void => {
    const next = addOneMonth(year, monthIndex)
    const nextMonthValue = `${next.year}-${`${next.monthIndex + 1}`.padStart(2, '0')}`
    const nextStart = monthResult.nextStartChild || startChild
    forcedMonthStartRef.current = { monthValue: nextMonthValue, startChild: nextStart }
    const nextExtraOffDays = new Set(parseDateKeys(monthOffDaysByMonth[nextMonthValue] ?? ''))
    const nextWorkingDays = getMonthWorkingDays(next.year, next.monthIndex, nextExtraOffDays)
    const nextFirstWorkingDayKey = nextWorkingDays.length > 0 ? toDateKey(nextWorkingDays[0]) : null
    setStartChildByMonth((prev) => ({
      ...prev,
      [monthValue]: startChild,
      // Always continue from calculated next start child.
      [nextMonthValue]: nextStart,
    }))
    setManualOverridesByMonth((prev) => ({
      ...prev,
      [nextMonthValue]: (() => {
        const current = { ...(prev[nextMonthValue] ?? {}) }
        if (nextFirstWorkingDayKey) {
          delete current[nextFirstWorkingDayKey]
        }
        return current
      })(),
    }))
    setExcludedChildrenByMonth((prev) => ({
      ...prev,
      [nextMonthValue]: prev[nextMonthValue] ?? [],
    }))
    setMonthValue(nextMonthValue)
    setStartChild(nextStart)
  }

  const goToPreviousMonth = (): void => {
    const previousMonthIndex = monthIndex === 0 ? 11 : monthIndex - 1
    const previousYear = monthIndex === 0 ? year - 1 : year
    const previousMonthValue = `${previousYear}-${`${previousMonthIndex + 1}`.padStart(2, '0')}`
    setStartChildByMonth((prev) => ({
      ...prev,
      [monthValue]: startChild,
    }))
    setMonthValue(previousMonthValue)
    if (startChildByMonth[previousMonthValue]) {
      setStartChild(startChildByMonth[previousMonthValue])
    }
  }

  const updateOverride = (dateKey: string, child: string): void => {
    const normalizedChild = child.trim()
    if (!normalizedChild) {
      return
    }
    setManualOverridesByMonth((prev) => {
      const cleanChildren = children.filter((name) => name.trim().length > 0)
      if (cleanChildren.length === 0) {
        return prev
      }

      const editedChildIndex = cleanChildren.indexOf(normalizedChild)
      if (editedChildIndex < 0) {
        return prev
      }

      const monthOverrides = { ...(prev[monthValue] ?? {}) }
      monthOverrides[dateKey] = normalizedChild
      const usedInMonth = new Set<string>()
      let currentIndex = Math.max(cleanChildren.indexOf(startChild), 0)

      const resolveAssignedChild = (key: string): string => {
        const override = monthOverrides[key]
        const overrideIdx = override ? cleanChildren.indexOf(override) : -1
        if (overrideIdx >= 0) {
          currentIndex = (overrideIdx + 1) % cleanChildren.length
          return override
        }
        const autoChild = cleanChildren[currentIndex] ?? ''
        const autoIdx = cleanChildren.indexOf(autoChild)
        currentIndex = autoIdx >= 0 ? (autoIdx + 1) % cleanChildren.length : (currentIndex + 1) % cleanChildren.length
        return autoChild
      }

      // First pass: honor existing assignments up to edited date, collect used children.
      workingDays.forEach((date) => {
        const key = toDateKey(date)
        if (key > dateKey) {
          return
        }
        const assigned = resolveAssignedChild(key)
        if (assigned) {
          usedInMonth.add(assigned)
        }
      })

      const findNextNotUsedIndex = (fromIndex: number): number => {
        for (let step = 0; step < cleanChildren.length; step += 1) {
          const idx = (fromIndex + step) % cleanChildren.length
          if (!usedInMonth.has(cleanChildren[idx])) {
            return idx
          }
        }
        return -1
      }

      // Second pass: after edited date continue in order, skipping already used names in this month.
      workingDays.forEach((date) => {
        const key = toDateKey(date)
        if (key <= dateKey) {
          return
        }
        const nextIdx = findNextNotUsedIndex(currentIndex)
        if (nextIdx < 0) {
          delete monthOverrides[key]
          return
        }
        const nextChild = cleanChildren[nextIdx]
        monthOverrides[key] = nextChild
        usedInMonth.add(nextChild)
        currentIndex = (nextIdx + 1) % cleanChildren.length
      })

      return {
        ...prev,
        [monthValue]: monthOverrides,
      }
    })
  }

  const downloadPdf = async (): Promise<void> => {
    const title = exportTitle
    const html2pdf = (await import('html2pdf.js')).default as any

    const container = document.createElement('div')
    container.innerHTML = printPreviewHtml
    const root = container.firstElementChild as HTMLElement | null
    if (!root) {
      return
    }
    document.body.appendChild(root)
    try {
      await waitForImagesToLoad(root)
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const runId = Math.random().toString(36).slice(2, 8)
      await html2pdf()
        .set({
          margin: 0,
          filename: `${sanitizeFileName(title)}_${PDF_TEMPLATE_VERSION}_${timestamp}_${runId}.pdf`,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ededed' },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
          pagebreak: { mode: ['css'] },
        })
        .from(root)
        .save()
    } finally {
      document.body.removeChild(root)
    }
  }

  const downloadJpg = async (): Promise<void> => {
    const title = exportTitle
    const html2canvas = (await import('html2canvas')).default
    const container = document.createElement('div')
    container.innerHTML = printPreviewHtml
    const root = container.firstElementChild as HTMLElement | null
    if (!root) {
      return
    }
    document.body.appendChild(root)
    try {
      await waitForImagesToLoad(root)
      const canvas = await html2canvas(root, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
      })
      const data = canvas.toDataURL('image/jpeg', 0.95)
      const link = document.createElement('a')
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      link.href = data
      link.download = `${sanitizeFileName(title)}_${timestamp}.jpg`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    } finally {
      document.body.removeChild(root)
    }
  }

  const doLogin = (): void => {
    void login()
  }

  const doLogout = (): void => {
    void logout()
  }

  const openCalendarMonthPicker = (): void => {
    const picker = calendarMonthPickerRef.current as (HTMLInputElement & { showPicker?: () => void }) | null
    if (!picker) {
      return
    }
    try {
      picker.showPicker?.()
    } catch {
      picker.click()
    }
  }

  const applyExtraOffDays = (dateKeys: string[]): void => {
    const normalizedKeys = [...new Set(dateKeys.filter(Boolean))].sort()
    if (normalizedKeys.length === 0) {
      return
    }
    const touchedMonths = new Set<string>()
    setMonthOffDaysByMonth((prev) => {
      const next = { ...prev }
      for (const dateKey of normalizedKeys) {
        const monthKey = dateKey.slice(0, 7)
        touchedMonths.add(monthKey)
        const merged = serializeDateKeys([...parseDateKeys(next[monthKey] ?? ''), dateKey])
        next[monthKey] = merged
      }
      return next
    })
    // Off-day changes must reflow daily assignments continuously on touched months.
    setManualOverridesByMonth((prev) => {
      const next = { ...prev }
      touchedMonths.forEach((monthKey) => {
        next[monthKey] = {}
      })
      return next
    })
    setOffDayLabelsByMonth((prev) => {
      const next = { ...prev }
      touchedMonths.forEach((monthKey) => {
        const current = { ...(next[monthKey] ?? {}) }
        normalizedKeys.forEach((dateKey) => {
          if (dateKey.startsWith(monthKey)) {
            delete current[dateKey]
          }
        })
        next[monthKey] = current
      })
      return next
    })
  }

  const removeExtraOffDays = (dateKeys: string[]): void => {
    const normalizedKeys = [...new Set(dateKeys.filter(Boolean))].sort()
    if (normalizedKeys.length === 0) {
      return
    }
    const keysToRemove = new Set(normalizedKeys)
    const touchedMonths = new Set<string>()
    setMonthOffDaysByMonth((prev) => {
      const next = { ...prev }
      for (const dateKey of normalizedKeys) {
        touchedMonths.add(dateKey.slice(0, 7))
      }
      touchedMonths.forEach((monthKey) => {
        const currentKeys = parseDateKeys(next[monthKey] ?? '')
        next[monthKey] = serializeDateKeys(currentKeys.filter((key) => !keysToRemove.has(key)))
      })
      return next
    })
    // Off-day changes must reflow daily assignments continuously on touched months.
    setManualOverridesByMonth((prev) => {
      const next = { ...prev }
      touchedMonths.forEach((monthKey) => {
        next[monthKey] = {}
      })
      return next
    })
  }

  const toggleCalendarOffDay = (dateKey: string, withRangeSelection: boolean): void => {
    if (!canEdit) {
      return
    }
    const targetKeys =
      withRangeSelection && offDaySelectionAnchor
        ? enumerateDateKeysInclusive(
            offDaySelectionAnchor <= dateKey ? offDaySelectionAnchor : dateKey,
            offDaySelectionAnchor <= dateKey ? dateKey : offDaySelectionAnchor,
          )
        : [dateKey]
    if (targetKeys.length === 0) {
      return
    }
    const shouldAdd = targetKeys.some((key) => !extraOffDays.has(key))
    if (shouldAdd) {
      applyExtraOffDays(targetKeys)
    } else {
      removeExtraOffDays(targetKeys)
    }
    setOffDaySelectionAnchor(dateKey)
  }

  const beginCalendarOffDayDrag = (dateKey: string): void => {
    if (!canEdit) {
      return
    }
    const dragMode: 'add' | 'remove' = extraOffDays.has(dateKey) ? 'remove' : 'add'
    offDayDragTouchedRef.current = new Set([dateKey])
    if (dragMode === 'add') {
      applyExtraOffDays([dateKey])
    } else {
      removeExtraOffDays([dateKey])
    }
    setOffDayDragMode(dragMode)
    setOffDaySelectionAnchor(dateKey)
  }

  const extendCalendarOffDayDrag = (dateKey: string): void => {
    if (!canEdit || !offDayDragMode) {
      return
    }
    if (offDayDragTouchedRef.current.has(dateKey)) {
      return
    }
    offDayDragTouchedRef.current.add(dateKey)
    if (offDayDragMode === 'add') {
      applyExtraOffDays([dateKey])
    } else {
      removeExtraOffDays([dateKey])
    }
  }

  const stopCalendarOffDayDrag = (): void => {
    if (!offDayDragMode) {
      return
    }
    offDayDragTouchedRef.current.clear()
    setOffDayDragMode(null)
  }

  const getOffDayLabel = (dateKey: string): string => {
    const custom = offDayLabelsForMonth[dateKey]
    return custom?.trim() || DEFAULT_OFFDAY_LABEL
  }

  const startEditingOffDayLabel = (dateKey: string): void => {
    if (!canEdit) {
      return
    }
    setEditingOffDayLabelCellKey(dateKey)
    setEditingOffDayLabelValue(getOffDayLabel(dateKey))
  }

  const commitOffDayLabelEdit = (): void => {
    if (!editingOffDayLabelCellKey) {
      return
    }
    const normalized = editingOffDayLabelValue.trim()
    setOffDayLabelsByMonth((prev) => {
      const currentMonth = { ...(prev[monthValue] ?? {}) }
      if (!normalized || normalized === DEFAULT_OFFDAY_LABEL) {
        delete currentMonth[editingOffDayLabelCellKey]
      } else {
        currentMonth[editingOffDayLabelCellKey] = normalized
      }
      return {
        ...prev,
        [monthValue]: currentMonth,
      }
    })
    setEditingOffDayLabelCellKey(null)
  }

  useEffect(() => {
    if (!offDayDragMode) {
      return
    }
    const handleMouseUp = (): void => {
      stopCalendarOffDayDrag()
    }
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [offDayDragMode])

  const refreshSwapRequests = async (): Promise<void> => {
    if (!swapAdminTestEnabled || !gatewayAccessToken) {
      setSwapRequests([])
      return
    }
    setSwapLoading(true)
    setSwapError(null)
    try {
      const rows = await loadSwapRequests({ accessToken: gatewayAccessToken, role: userRole })
      setSwapRequests(rows)
    } catch (error) {
      setSwapError(mapSwapUiError(error))
    } finally {
      setSwapLoading(false)
    }
  }

  useEffect(() => {
    if (!swapAdminTestEnabled) {
      setSwapRequests([])
      setSwapError(null)
      return
    }
    void refreshSwapRequests()
  }, [swapAdminTestEnabled])

  const handleDeleteClosedSwapRequest = async (requestId: string): Promise<void> => {
    if (!swapAdminTestEnabled || !gatewayAccessToken) {
      return
    }
    const ok = window.confirm('Biztosan törlöd ezt a lezárt/visszavont csere-kérést?')
    if (!ok) {
      return
    }
    setSwapBusy(true)
    setSwapError(null)
    try {
      await deleteSwapRequest({ accessToken: gatewayAccessToken, requestId })
      await refreshSwapRequests()
    } catch (error) {
      setSwapError(mapSwapUiError(error))
    } finally {
      setSwapBusy(false)
    }
  }

  const handleCreateSwapRequest = async (): Promise<void> => {
    if (!swapAdminTestEnabled || !gatewayAccessToken || !swapRequestDateKey || children.length === 0) {
      return
    }
    const requesterChildName = assignedChildByDateKey.get(swapRequestDateKey)
    if (!requesterChildName) {
      setSwapError(`A kiválasztott dátumhoz nem található kiosztott név: ${swapRequestDateKey}`)
      return
    }
    setSwapBusy(true)
    setSwapError(null)
    try {
      await createSwapRequest({
        accessToken: gatewayAccessToken,
        requesterChildName,
        requesterDateKey: swapRequestDateKey,
      })
      setSwapRequestDateKey('')
      await refreshSwapRequests()
    } catch (error) {
      setSwapError(mapSwapUiError(error))
    } finally {
      setSwapBusy(false)
    }
  }

  const handleCreateOffer = async (requestId: string): Promise<void> => {
    const offerDateKey = swapOfferDateByRequest[requestId]
    if (!swapAdminTestEnabled || !gatewayAccessToken || !offerDateKey || children.length === 0) {
      return
    }
    const request = swapRequests.find((row) => row.id === requestId)
    if (!request) {
      setSwapError('A kiválasztott kérés már nem található. Frissíts listát.')
      return
    }
    if (offerDateKey === request.requester_date_key) {
      setSwapError('Ugyanarra a napra nem küldhető ajánlat.')
      return
    }
    const offerChildName = assignedChildByDateKey.get(offerDateKey)
    if (!offerChildName) {
      setSwapError(`A kiválasztott ajánlat dátumhoz nem található kiosztott név: ${offerDateKey}`)
      return
    }
    const requesterCurrentChild = currentChildNameByDateKey.get(request.requester_date_key) ?? request.requester_child_name
    if (offerChildName === requesterCurrentChild) {
      setSwapError('Ugyanarra a gyerekre nem küldhető csereajánlat.')
      return
    }
    setSwapBusy(true)
    setSwapError(null)
    try {
      await createSwapOffer({
        accessToken: gatewayAccessToken,
        requestId,
        offerChildName,
        offerDateKey,
      })
      setSwapOfferDateByRequest((prev) => ({ ...prev, [requestId]: '' }))
      await refreshSwapRequests()
    } catch (error) {
      setSwapError(mapSwapUiError(error))
    } finally {
      setSwapBusy(false)
    }
  }

  const handleWithdrawOffer = async (offerId: string): Promise<void> => {
    if (!swapAdminTestEnabled || !gatewayAccessToken) {
      return
    }
    setSwapBusy(true)
    setSwapError(null)
    try {
      await withdrawSwapOffer({ accessToken: gatewayAccessToken, offerId })
      await refreshSwapRequests()
    } catch (error) {
      setSwapError(mapSwapUiError(error))
    } finally {
      setSwapBusy(false)
    }
  }

  const handleApproveOffer = async (requestId: string, offerId: string): Promise<void> => {
    if (!swapAdminTestEnabled || !gatewayAccessToken) {
      return
    }
    setSwapBusy(true)
    setSwapError(null)
    try {
      const approveResult = await approveSwapOffer({ accessToken: gatewayAccessToken, requestId, offerId })
      // A swap RPC a frissített csoport payload-ot (benne a manualOverridesByMonth-szal) is visszaadja.
      // A `CLOUD_SYNC` flag-től függetlenül itt frissítjük a táblázat állapotát, hogy a két név
      // a UI-ban is azonnal lecserélődjön.
      const swappedOverrides = approveResult.payload?.manualOverridesByMonth
      if (swappedOverrides && typeof swappedOverrides === 'object') {
        setManualOverridesByMonth((prev) => {
          const next = { ...prev }
          for (const [monthKey, monthOverrides] of Object.entries(swappedOverrides)) {
            next[monthKey] = { ...(prev[monthKey] ?? {}), ...monthOverrides }
          }
          return next
        })
      }
      await refreshSwapRequests()
      if (CLOUD_SYNC) {
        setCloudStatus('loading')
        try {
          const remote = await fetchGroupState({ accessToken: gatewayAccessToken })
          setUserRole((prev) => keepHigherRole(prev, remote.role))
          setUserProfileId(remote.userProfileId ?? null)
          if (remote.displayName) {
            setUserDisplayName(remote.displayName)
          }
          if (remote.payload) {
            applyAppStatePayload(remote, {
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
              setOffDayLabelsByMonth,
              setStartChild,
              setExtraOffDaysText,
              setManualOverrides: () => {},
            })
          }
          setCloudStatus('ok')
          await refreshSwapRequests()
        } catch (error) {
          console.error('Felhő újratöltés jóváhagyás után:', error)
          setCloudStatus('err')
        }
      }
    } catch (error) {
      setSwapError(mapSwapUiError(error))
    } finally {
      setSwapBusy(false)
    }
  }

  const handleWithdrawRequest = async (requestId: string): Promise<void> => {
    if (!swapAdminTestEnabled || !gatewayAccessToken) {
      return
    }
    setSwapBusy(true)
    setSwapError(null)
    try {
      await withdrawSwapRequest({ accessToken: gatewayAccessToken, requestId })
      await refreshSwapRequests()
    } catch (error) {
      setSwapError(mapSwapUiError(error))
    } finally {
      setSwapBusy(false)
    }
  }

  const saveManualSnapshot = async (): Promise<void> => {
    if (!canCreateManualSave) {
      return
    }
    const confirmed = window.confirm(
      'Biztosan mented az aktuális teljes névsor állapotot (összes hónap), mint új SAVE pont?',
    )
    if (!confirmed) {
      return
    }
    setIsManualSaveBusy(true)
    const snapshot: ManualSaveSnapshot = {
      payload: currentPayload,
      savedAt: Date.now(),
    }
    try {
      localStorage.setItem(MANUAL_SAVE_SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot))
      setManualSaveSnapshot(snapshot)
      if (CLOUD_SYNC && KEYCLOAK_AUTH && isAuthenticated && gatewayAccessToken && canEdit) {
        await saveGroupState(snapshot.payload, { accessToken: gatewayAccessToken, role: userRole })
        setCloudStatus('ok')
      }
    } catch (error) {
      console.error('SAVE mentési pont hiba:', error)
      setCloudStatus('err')
    } finally {
      setIsManualSaveBusy(false)
    }
  }

  const restoreLastManualSnapshotToDatabase = async (): Promise<void> => {
    if (!manualSaveSnapshot || isRestoreBusy) {
      return
    }
    setIsRestoreBusy(true)
    try {
      applyAppStatePayload(
        { payload: manualSaveSnapshot.payload, role: userRole, displayName: userDisplayName, userProfileId },
        {
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
          setOffDayLabelsByMonth,
          setStartChild,
          setExtraOffDaysText,
          setManualOverrides: () => {},
        },
      )
      if (CLOUD_SYNC && KEYCLOAK_AUTH && isAuthenticated && gatewayAccessToken && canEdit) {
        await saveGroupState(manualSaveSnapshot.payload, { accessToken: gatewayAccessToken, role: userRole })
        setCloudStatus('ok')
      }
    } catch (error) {
      console.error('SAVE visszatöltés hiba:', error)
      setCloudStatus('err')
    } finally {
      setIsRestoreBusy(false)
    }
  }

  return (
    <main className={`app theme-${uiTheme} ${darkMode ? 'dark-mode' : ''}`}>
      <header className="title">
        <div className="title-row">
          <div className="title-start">
            <h1 className="app-title">
              Gyümölcsnaptár <span className="group-name">- Zsiráf csoport</span>
            </h1>
            <label className="inline-control compact-control appearance-control appearance-control-mobile">
              Megjelenés
              <select
                value={themeModeValue}
                onChange={(e) => {
                  const selected = e.target.value
                  if (selected === 'dark') {
                    setDarkMode(true)
                    return
                  }
                  if (selected === 'elegant' || selected === 'pastel' || selected === 'minimal') {
                    setUiTheme(selected)
                    setDarkMode(false)
                  }
                }}
              >
                <option value="elegant">Elegant</option>
                <option value="pastel">Pasztell</option>
                <option value="minimal">Minimal</option>
                <option value="dark">Sötét</option>
              </select>
            </label>
          </div>
          <div className="title-end">
            {IS_NEXT_CHANNEL ? (
              <span className="release-channel-badge" title="Következő (fejlesztői) kiadás">
                NEXT
              </span>
            ) : null}
            <span className="app-version-discrete" title="Alkalmazás verziója">
              {APP_VERSION_DISPLAY}
            </span>
            <span
              className={`cloud-pill cloud-pill--${cloudStatus === 'ok' ? 'ok' : cloudStatus === 'err' ? 'err' : cloudStatus === 'off' ? 'off' : 'loading'}`}
              title={
                CLOUD_SYNC
                  ? 'Közös adat a Supabase felhőben. Mindenki, aki a linket használja, ugyanazt a mentést látja.'
                  : 'A felhő szinkron kikapcsolva ezen a környezeten, adatbázis kapcsolat nélkül.'
              }
            >
              {cloudStatus === 'loading' && 'Felhő: betöltés…'}
              {cloudStatus === 'ok' && 'Felhő: mentve'}
              {cloudStatus === 'err' && 'Felhő: hiba'}
              {cloudStatus === 'off' && 'Felhő: kikapcsolva (nincs DB sync)'}
            </span>
            {KEYCLOAK_AUTH && isAuthenticated ? (
              <span className="cloud-pill" title="Bejelentkezett felhasználó szerepkörrel.">
                {authReady ? `Felhasználó: ${userDisplayName ?? '—'} (${userRole})` : 'Felhasználó: ellenőrzés…'}
              </span>
            ) : null}
            <div className="ui-controls">
              {KEYCLOAK_AUTH && authReady && !isAuthenticated ? (
                <button
                  type="button"
                  className="login-button-compact"
                  onClick={doLogin}
                  disabled={!isKeycloakConfigured()}
                >
                  Bejelentkezés
                </button>
              ) : null}
              {KEYCLOAK_AUTH && isAuthenticated ? (
                <button type="button" className="login-button-compact" onClick={doLogout}>
                  Kijelentkezés
                </button>
              ) : null}
            </div>
            <label className="inline-control compact-control appearance-control appearance-control-web">
              Megjelenés
              <select
                value={themeModeValue}
                onChange={(e) => {
                  const selected = e.target.value
                  if (selected === 'dark') {
                    setDarkMode(true)
                    return
                  }
                  if (selected === 'elegant' || selected === 'pastel' || selected === 'minimal') {
                    setUiTheme(selected)
                    setDarkMode(false)
                  }
                }}
              >
                <option value="elegant">Elegant</option>
                <option value="pastel">Pasztell</option>
                <option value="minimal">Minimal</option>
                <option value="dark">Sötét</option>
              </select>
            </label>
          </div>
        </div>
      </header>

      <section className={`layout ${canEdit ? (settingsPanelOpen ? '' : 'sidebar-collapsed') : 'layout-readonly'}`}>
        <button
          type="button"
          className="sidebar-toggle"
          style={{ display: canEdit ? undefined : 'none' }}
          onClick={() => setSettingsPanelOpen((prev) => !prev)}
          aria-label={settingsPanelOpen ? 'Beállítások panel becsukása' : 'Beállítások panel kinyitása'}
          title={settingsPanelOpen ? 'Beállítások panel becsukása' : 'Beállítások panel kinyitása'}
        >
          <span className="sidebar-toggle-label">Beállítások</span>
          <span className="sidebar-toggle-icon-desktop">{settingsPanelOpen ? '◀' : '▶'}</span>
          <span className="sidebar-toggle-icon-mobile">{settingsPanelOpen ? '▼' : '▲'}</span>
        </button>
        {canEdit ? (
        <div className="settings-panel-shell">
          <button
            type="button"
            className="mobile-panel-toggle settings-mobile-toggle"
            onClick={() => setSettingsPanelOpen((prev) => !prev)}
            aria-label={settingsPanelOpen ? 'Beállítások panel becsukása' : 'Beállítások panel kinyitása'}
          >
            <span>Beállítások</span>
            <span>{settingsPanelOpen ? '▼' : '▲'}</span>
          </button>
          <div className={`mobile-panel-content ${settingsPanelOpen ? '' : 'mobile-collapsed'}`}>
          <aside className={`panel settings-panel ${settingsPanelOpen ? '' : 'collapsed'}`}>
            <h2>Beállítások</h2>

          <details className="collapsible-box">
            <summary>Névsor (1 sor = 1 név)</summary>
            <label>
              Gyerekek
              <textarea
                className="roster-textarea"
                value={childrenText}
                disabled={!canEdit}
                onChange={(e) => setChildrenText(e.target.value)}
                rows={7}
              />
            </label>
          </details>

          <details className="collapsible-box" open={Boolean(headerImage)}>
            <summary>Fejléckép (referencia designhoz)</summary>
            <label>
              Kép feltöltése
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={!canEdit}
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  if (!file) {
                    return
                  }
                  try {
                    const result = await convertImageFileToJpegDataUrl(file)
                    setHeaderImage(result)
                    try {
                      localStorage.setItem('fruit-calendar-header-image', JSON.stringify(result))
                    } catch (storageError) {
                      console.warn('Header image localStorage save failed:', storageError)
                    }
                  } catch {
                    alert('Nem sikerült képet feldolgozni. Próbálj másik PNG/JPG képet feltölteni.')
                  } finally {
                    e.currentTarget.value = ''
                  }
                }}
              />
            </label>
            {headerImage ? (
              <>
                <div className="image-preview">
                  <p>Fejléckép beállítva:</p>
                  <img src={headerImage.dataUrl} alt="Fejléckép előnézet" />
                  <p>{`Utolsó frissítés: ${new Date(headerImage.updatedAt).toLocaleString('hu-HU')}`}</p>
                </div>
                <button
                  type="button"
                  className="action-button secondary"
                  disabled={!canEdit}
                  onClick={() => {
                    setHeaderImage(null)
                    localStorage.removeItem('fruit-calendar-header-image')
                  }}
                >
                  <span>🗑️</span> Fejléckép törlése
                </button>
              </>
            ) : (
              <p className="compact-note">Nincs fejléckép betöltve.</p>
            )}
          </details>
          </aside>
          </div>
        </div>
        ) : null}

        <div className="main-column">
          {swapAdminTestEnabled ? (
            <section className="panel swap-admin-panel">
              <button
                type="button"
                className="mobile-panel-toggle"
                onClick={() => setSwapPanelOpen((prev) => !prev)}
                aria-label={swapPanelOpen ? 'Csere panel becsukása' : 'Csere panel kinyitása'}
              >
                <span>Parent Swap (Admin Test Mode)</span>
                <span>{swapPanelOpen ? '▲' : '▼'}</span>
              </button>
              <div className={`mobile-panel-content ${swapPanelOpen ? '' : 'mobile-collapsed'}`}>
                <h2>Parent Swap (Admin Test Mode)</h2>
                <div className="swap-request-create-card">
                  <p className="swap-request-create-title">Csere igénylés:</p>
                  <div className="swap-admin-actions">
                    <label>
                      Kérés dátuma
                      <select value={swapRequestDateKey} onChange={(e) => setSwapRequestDateKey(e.target.value)}>
                        <option value="">-- Válassz dátumot --</option>
                        {monthDateKeys.map((key) => (
                          <option key={`request-date-${key}`} value={key}>
                            {key}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="action-button swap-primary-action"
                      disabled={swapBusy || !swapRequestDateKey}
                      onClick={() => void handleCreateSwapRequest()}
                    >
                      Csere kérés indítása
                    </button>
                  </div>
                </div>
                {swapError ? <p className="cloud-pill cloud-pill--err">{swapError}</p> : null}
                {swapLoading ? <p className="compact-note">Swap lista betöltése…</p> : null}
                <div className="swap-request-list">
                  {visibleSwapRequests.map((request) => (
                    <article key={request.id} className="swap-request-card">
                    <p
                      title="A név a naptár jelenlegi hozzárendelése a kérés napján (nem a szerveren eltárolt kérés-szöveg)."
                    >
                      <strong>Kérés:</strong>{' '}
                      {currentChildNameByDateKey.get(request.requester_date_key) ?? request.requester_child_name} @{' '}
                      {request.requester_date_key} ({labelSwapRequestStatus(request.status)})
                    </p>
                    {request.status === 'requested' ? (
                      <div className="swap-offer-actions">
                        <button
                          type="button"
                          className="action-button secondary swap-compact-action"
                          disabled={swapBusy}
                          onClick={() => void handleWithdrawRequest(request.id)}
                        >
                          Kérés visszavonása
                        </button>
                      </div>
                    ) : (
                      <div className="swap-closed-request-actions">
                        <p className="swap-inactive-hint">
                          A kérés lezárt/visszavont; külön törölhető, hogy ne szemetelje a listát.
                        </p>
                        <button
                          type="button"
                          className="swap-request-delete"
                          title="Lezárt/visszavont kérés törlése"
                          aria-label="Lezárt/visszavont kérés törlése"
                          disabled={swapBusy}
                          onClick={() => void handleDeleteClosedSwapRequest(request.id)}
                        >
                          ×
                        </button>
                      </div>
                    )}
                    <div
                      className={
                        request.status === 'requested' ? 'swap-admin-actions' : 'swap-admin-actions swap-inactive-block'
                      }
                    >
                      <label>
                        Ajánlat dátuma
                        <select
                          value={swapOfferDateByRequest[request.id] ?? ''}
                          onChange={(e) =>
                            setSwapOfferDateByRequest((prev) => ({ ...prev, [request.id]: e.target.value }))
                          }
                          disabled={swapBusy || request.status !== 'requested'}
                        >
                          <option value="">-- Válassz dátumot --</option>
                          {monthDateKeys.map((key) => (
                            <option key={`offer-date-${request.id}-${key}`} value={key}>
                              {key}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        className="action-button secondary"
                        disabled={swapBusy || request.status !== 'requested' || !(swapOfferDateByRequest[request.id] ?? '')}
                        onClick={() => void handleCreateOffer(request.id)}
                      >
                        Ajánlat küldése
                      </button>
                    </div>
                    <ul className="swap-offer-list">
                      {request.offers
                        // A visszavont ajánlat ne maradjon kint értesítésként.
                        .filter((offer) => offer.status !== 'withdrawn')
                        .map((offer) => (
                        <li key={offer.id}>
                          <span
                            title="A név a naptár jelenlegi hozzárendelése az ajánlott napon (nem a szerveren eltárolt mentett szöveg)."
                          >
                            {currentChildNameByDateKey.get(offer.offer_date_key) ?? offer.offer_child_name} @{' '}
                            {offer.offer_date_key} ({labelSwapOfferStatus(offer.status)})
                          </span>
                          {request.status === 'requested' && offer.status === 'pending' ? (
                            <div className="swap-offer-actions">
                              <button
                                type="button"
                                className="action-button secondary"
                                disabled={swapBusy}
                                onClick={() => void handleApproveOffer(request.id, offer.id)}
                              >
                                Jóváhagyás
                              </button>
                              <button
                                type="button"
                                className="action-button secondary"
                                disabled={swapBusy}
                                onClick={() => void handleWithdrawOffer(offer.id)}
                              >
                                Ajánlat visszavonása
                              </button>
                            </div>
                          ) : (
                            <p className="swap-inactive-hint">
                              {offer.status === 'pending' && request.status !== 'requested'
                                ? 'Az ajánlat a kérés lezárása miatt már nem kezelhető a listából.'
                                : 'Az ajánlat már nincs függőben, ezért nincs műveletgomb.'}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                    </article>
                  ))}
                </div>
              </div>
            </section>
          ) : null}
          <section className="panel calendar-panel">
            <div className="child-filter-panel">
              <button
                type="button"
                className="mobile-panel-toggle"
                onClick={() => setChildFilterPanelOpen((prev) => !prev)}
                aria-label={childFilterPanelOpen ? 'Gyerek szűrő panel becsukása' : 'Gyerek szűrő panel kinyitása'}
              >
                <span>Gyerek név szerinti szűrés (3 hónap)</span>
                <span>{childFilterPanelOpen ? '▲' : '▼'}</span>
              </button>
              <div className={`mobile-panel-content ${childFilterPanelOpen ? '' : 'mobile-collapsed'}`}>
                <div className="child-filter-header">
                  <h3>Gyerek név szerinti szűrés (3 hónap)</h3>
                </div>
                <div className="child-filter-row">
                  <label className="child-filter-label">
                    Gyerek neve
                    <select value={childFilter} onChange={(e) => setChildFilter(e.target.value)}>
                      <option value="">-- Válassz gyereket --</option>
                      {children.map((name) => (
                        <option key={`filter-${name}`} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="button" className="action-button secondary child-filter-clear" onClick={() => setChildFilter('')}>
                    Szűrő ürítése
                  </button>
                </div>
                <div className="child-filter-results">
                  {childFilterMonths.map((item) => (
                    <div className="child-filter-month-card" key={`filter-month-${item.monthValue}`}>
                      <p className="child-filter-month-title">{item.label}</p>
                      {filteredChild ? (
                        item.dates.length > 0 ? (
                          <p className="child-filter-dates">{item.dates.join(', ')}</p>
                        ) : (
                          <p className="child-filter-empty">Nincs hozzárendelt dátum ebben a hónapban.</p>
                        )
                      ) : (
                        <p className="child-filter-empty">Válassz gyereket a dátumok listázásához.</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="calendar-heading">
              <button
                type="button"
                className="calendar-nav-button"
                onClick={goToPreviousMonth}
                aria-label="Előző hónap"
                title="Előző hónap"
              >
                ◀
              </button>
              <button
                type="button"
                className="calendar-title-button"
                onClick={openCalendarMonthPicker}
                aria-label="Hónap választás"
                title="Kattints a hónap kiválasztásához"
              >
                <span>{monthLabel(year, monthIndex)}</span>
                <span className="calendar-title-hint">📅</span>
              </button>
              <button
                type="button"
                className="calendar-nav-button"
                onClick={continueWithNextMonth}
                aria-label="Következő hónap"
                title="Következő hónap"
              >
                ▶
              </button>
              <input
                ref={calendarMonthPickerRef}
                className="calendar-month-picker-input-hidden"
                type="month"
                value={monthValue}
                onChange={(e) => setMonthValue(e.target.value)}
                aria-label="Hónap választás"
              />
            </div>
            {canEdit ? (
              <p className="compact-note calendar-offday-hint">
                Tipp: jobb felső +/− ikonnal egy napot állítasz szünnappá; Shift + kattintásnál intervallumot vált.
              </p>
            ) : null}
            <table>
              <thead>
                <tr>
                  <th>Dátum</th>
                  {weekdays.map((day) => (
                    <th key={day}>{day}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weeks.map((week, weekIdx) => (
                  <tr key={`week-${weekIdx}`}>
                    <td className="week-label">{weekLabel(week, year, monthIndex)}</td>
                    {weekdays.map((_, idx) => {
                      const item = week.find((entry) => entry.date.getDay() === idx + 1)
                      if (!item) {
                        return <td key={`empty-${weekIdx}-${idx}`} className="empty"></td>
                      }
                      const isOffDay = extraOffDays.has(item.dateKey)
                      const isImportedHolidayGap = !item.child && isPublicHolidayDate(item.date) && !isOffDay
                      return (
                        <td
                          key={item.dateKey}
                          className={`calendar-day-cell ${item.child ? '' : 'offday'} ${canEdit ? 'calendar-day-cell--editable' : ''}`}
                          onMouseDown={(e) => {
                            if (!canEdit || e.button !== 0) {
                              return
                            }
                            const target = e.target as HTMLElement
                            if (target.closest('button,select,input,textarea,a,label')) {
                              return
                            }
                            e.preventDefault()
                            beginCalendarOffDayDrag(item.dateKey)
                          }}
                          onMouseEnter={() => {
                            extendCalendarOffDayDrag(item.dateKey)
                          }}
                        >
                          <div className="day">{item.date.getDate()}</div>
                          {canEdit ? (
                            <button
                              type="button"
                              className={`offday-toggle-button ${isOffDay ? 'is-offday' : ''}`}
                              title="Katt: szünnap be/ki, Shift+katt: intervallum"
                              aria-label={
                                isOffDay
                                  ? `Szünnap törlése: ${item.dateKey}`
                                  : `Szünnappá jelölés: ${item.dateKey}`
                              }
                              onClick={(e) => {
                                e.stopPropagation()
                                toggleCalendarOffDay(item.dateKey, e.shiftKey)
                              }}
                            >
                              {isOffDay ? '−' : '+'}
                            </button>
                          ) : null}
                          {canEdit ? (
                            item.child ? (
                              <select value={item.child} disabled={!canEdit} onChange={(e) => updateOverride(item.dateKey, e.target.value)}>
                                {children.map((name) => (
                                  <option key={`${item.dateKey}-${name}`} value={name}>
                                    {name}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <div className={`offday-cell ${isImportedHolidayGap ? 'holiday-gap-cell' : ''}`}>
                                {isOffDay ? (
                                  editingOffDayLabelCellKey === item.dateKey ? (
                                    <input
                                      ref={offDayLabelInputRef}
                                      type="text"
                                      className="offday-label"
                                      value={editingOffDayLabelValue}
                                      onChange={(e) => setEditingOffDayLabelValue(e.target.value)}
                                      onBlur={commitOffDayLabelEdit}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          e.preventDefault()
                                          commitOffDayLabelEdit()
                                        }
                                        if (e.key === 'Escape') {
                                          e.preventDefault()
                                          setEditingOffDayLabelCellKey(null)
                                        }
                                      }}
                                    />
                                  ) : (
                                    <button
                                      type="button"
                                      className="offday-label"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        startEditingOffDayLabel(item.dateKey)
                                      }}
                                      title="Felirat szerkesztése"
                                    >
                                      {getOffDayLabel(item.dateKey)}
                                    </button>
                                  )
                                ) : null}
                                {isImportedHolidayGap ? <span className="offday-label">Munkaszüneti nap</span> : null}
                              </div>
                            )
                          ) : (
                            item.child ? (
                              <div>{item.child}</div>
                            ) : (
                              <div className={`offday-cell offday-cell-readonly ${isImportedHolidayGap ? 'holiday-gap-cell' : ''}`}>
                                {isOffDay ? <span className="offday-label">{getOffDayLabel(item.dateKey)}</span> : null}
                                {isImportedHolidayGap ? <span className="offday-label">Munkaszüneti nap</span> : null}
                              </div>
                            )
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="calendar-actions">
              <button type="button" className="action-button" onClick={downloadPdf}>
                <span>🧾</span> PDF letöltés
              </button>
              <button type="button" className="action-button" onClick={downloadJpg}>
                <span>🖼️</span> JPG letöltés
              </button>
              {isAuthenticated ? (
                <>
                  <button
                    type="button"
                    className="action-button action-button-restore"
                    disabled={!canRestoreLastManualSave}
                    onClick={() => void restoreLastManualSnapshotToDatabase()}
                  >
                    <span>↩️</span> Utolsó SAVE visszatöltése
                  </button>
                  <button
                    type="button"
                    className="action-button action-button-save action-button-save-right"
                    disabled={!canCreateManualSave}
                    onClick={() => void saveManualSnapshot()}
                  >
                    <span>💾</span> SAVE (összes hónap)
                  </button>
                </>
              ) : null}
            </div>
            {isAdminDemoUser ? (
              <div className="inline-info">
                <p>
                  Utolsó SAVE:{' '}
                  <strong>
                    {manualSaveSnapshot ? new Date(manualSaveSnapshot.savedAt).toLocaleString('hu-HU') : 'még nincs'}
                  </strong>
                </p>
              </div>
            ) : null}
            <div className="inline-info">
              <p>
                Következő hónap induló neve: <strong>{monthResult.nextStartChild || '-'}</strong>
              </p>
            </div>
          </section>

          <section className="panel preview-panel">
            <h2>Nyomtatási előnézet</h2>
            <iframe
              key={printPreviewFrameKey}
              title="Nyomtatási előnézet"
              className="print-preview-frame"
              sandbox="allow-scripts"
              srcDoc={printPreviewFrameHtml}
            />
          </section>
        </div>
      </section>

    </main>
  )
}

function chunkByWeek(assignments: ReturnType<typeof generateAssignments>['assignments']) {
  const grouped = new Map<string, ReturnType<typeof generateAssignments>['assignments']>()

  assignments.forEach((item) => {
    const mondayOfWeek = getMondayOfWeek(item.date)
    const key = toDateKey(mondayOfWeek)
    const existing = grouped.get(key)
    if (existing) {
      existing.push(item)
    } else {
      grouped.set(key, [item])
    }
  })

  return [...grouped.entries()]
    .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
    .map(([, items]) => items)
}

function weekLabel(
  week: ReturnType<typeof generateAssignments>['assignments'],
  displayYear: number,
  displayMonthIndex: number,
): string {
  const first = week[0]
  if (!first) {
    return '-'
  }
  const monday = getMondayOfWeek(first.date)
  const friday = new Date(monday)
  friday.setDate(friday.getDate() + 4)
  const daysInShownMonth: Date[] = []
  for (let idx = 0; idx < 5; idx += 1) {
    const day = new Date(monday)
    day.setDate(monday.getDate() + idx)
    if (day.getFullYear() === displayYear && day.getMonth() === displayMonthIndex) {
      daysInShownMonth.push(day)
    }
  }

  if (daysInShownMonth.length === 0) {
    return `${monthNameHu(monday)} ${monday.getDate()}-${friday.getDate()}.`
  }

  const rangeStart = daysInShownMonth[0]
  const rangeEnd = daysInShownMonth[daysInShownMonth.length - 1]
  if (rangeStart.getDate() === rangeEnd.getDate()) {
    return `${monthNameHu(rangeStart)} ${rangeStart.getDate()}.`
  }
  return `${monthNameHu(rangeStart)} ${rangeStart.getDate()}-${rangeEnd.getDate()}.`
}

function getMondayOfWeek(date: Date): Date {
  const monday = new Date(date)
  const day = monday.getDay()
  const diffToMonday = day === 0 ? -6 : 1 - day
  monday.setDate(monday.getDate() + diffToMonday)
  monday.setHours(0, 0, 0, 0)
  return monday
}

function monthNameHu(date: Date): string {
  const months = [
    'Január',
    'Február',
    'Március',
    'Április',
    'Május',
    'Június',
    'Július',
    'Augusztus',
    'Szeptember',
    'Október',
    'November',
    'December',
  ]
  return months[date.getMonth()]
}

function monthNameHuLong(monthIndex: number): string {
  const months = [
    'Január',
    'Február',
    'Március',
    'Április',
    'Május',
    'Június',
    'Július',
    'Augusztus',
    'Szeptember',
    'Október',
    'November',
    'December',
  ]
  return months[monthIndex]
}

function buildPdfHtml(params: {
  title: string
  weekdays: string[]
  weeks: ReturnType<typeof chunkByWeek>
  offDayDateKeys: Set<string>
  offDayLabelsByDateKey: Record<string, string>
  headerImage: HeaderImageState | null
  displayYear: number
  displayMonthIndex: number
}): string {
  const { title, weekdays, weeks, offDayDateKeys, offDayLabelsByDateKey, headerImage, displayYear, displayMonthIndex } = params
  const headColumns = weekdays
    .map(
      (day) =>
        `<th style="border:1px solid #4d4d4d;background:#e4e4e4;font-weight:700;text-align:center;padding:2.2mm 1.2mm;font-size:4.1mm;">${escapeHtml(day)}</th>`,
    )
    .join('')

  const bodyRows = weeks
    .map((week) => {
      const monday = getMondayOfWeek(week[0].date)
      const dayRowCells = weekdays
        .map((_, idx) => {
          const dayDate = new Date(monday)
          dayDate.setDate(monday.getDate() + idx)
          const isInShownMonth = dayDate.getFullYear() === displayYear && dayDate.getMonth() === displayMonthIndex
          const dayBackground = isInShownMonth ? '#fffbe8' : '#f3f4f6'
          return `<td style="border:1px solid #4d4d4d;background:${dayBackground};font-weight:700;text-align:center;padding:1.2mm 1mm;font-size:4.1mm;height:7.2mm;">${dayDate.getDate()}</td>`
        })
        .join('')

      const nameRowCells = weekdays
        .map((_, idx) => {
          const dayDate = new Date(monday)
          dayDate.setDate(monday.getDate() + idx)
          const item = week.find((entry) => entry.date.getDay() === idx + 1)
          const isOffDay = Boolean(item && offDayDateKeys.has(item.dateKey))
          const isImportedHolidayGap =
            Boolean(item) &&
            !item!.child &&
            item!.date.getFullYear() === displayYear &&
            item!.date.getMonth() === displayMonthIndex &&
            isPublicHolidayDate(item!.date) &&
            !isOffDay
          const background = item ? (isOffDay ? '#eef6ea' : isImportedHolidayGap ? '#e8eef9' : '#f4e9dd') : '#f3f4f6'
          const content = item
            ? isOffDay
              ? `<span style="display:block;font-weight:600;font-size:2.6mm;line-height:1.2;color:#6f7c72;opacity:0.85;">${escapeHtml(
                  offDayLabelsByDateKey[item.dateKey]?.trim() || DEFAULT_OFFDAY_LABEL,
                )}</span>`
              : isImportedHolidayGap
                ? '<span style="display:block;font-weight:600;font-size:2.6mm;line-height:1.2;color:#5d6f89;opacity:0.88;">Munkaszüneti nap</span>'
              : escapeHtml(item.child)
            : ''
          return `<td style="border:1px solid #4d4d4d;background:${background};font-weight:700;text-align:center;padding:1.5mm 1.2mm;font-size:4.1mm;height:12.5mm;">${content}</td>`
        })
        .join('')

      return `
        <tr>
          <td rowspan="2" style="border:1px solid #4d4d4d;background:#ffffff;color:#0b6296;font-weight:700;text-align:left;padding:1.5mm 1.5mm;font-size:4.2mm;vertical-align:middle;width:30mm;">${escapeHtml(
            weekLabel(week, displayYear, displayMonthIndex),
          )}</td>
          ${dayRowCells}
        </tr>
        <tr>
          ${nameRowCells}
        </tr>
      `
    })
    .join('')

  const imageBlock = headerImage
    ? `<img src="${headerImage.dataUrl}" alt="Fejléckép" data-updated-at="${headerImage.updatedAt}" style="display:block;max-width:160mm;max-height:60mm;width:auto;height:auto;object-fit:contain;margin:0 auto 9mm auto;" />`
    : ''

  return `
    <div style="width:210mm;background:#ffffff;box-sizing:border-box;font-family:Arial,Helvetica,sans-serif;color:#111;-webkit-print-color-adjust:exact;print-color-adjust:exact;display:flex;justify-content:center;padding-top:8mm;padding-bottom:8mm;">
      <div style="width:190mm;">
        ${imageBlock}
        <div style="border:1px solid #4d4d4d;background:#c2d2a8;text-align:center;font-weight:700;font-size:9mm;line-height:10.5mm;height:10.5mm;text-transform:uppercase;margin:0 auto;width:190mm;">${escapeHtml(title)}</div>
        <table style="width:190mm;margin:0 auto;border-collapse:collapse;table-layout:fixed;background:#fff;">
          <thead>
            <tr>
              <th style="border:1px solid #4d4d4d;background:#e4e4e4;font-weight:700;text-align:center;padding:2.2mm 1mm;font-size:4.1mm;width:30mm;">Dátum</th>
              ${headColumns}
            </tr>
          </thead>
          <tbody>
            ${bodyRows}
          </tbody>
        </table>
      </div>
    </div>
  `
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function sanitizeFileName(text: string): string {
  return text
    .toLowerCase()
    .replaceAll(' ', '_')
    .replaceAll('-', '_')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function convertImageFileToJpegDataUrl(file: File): Promise<HeaderImageState> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('file-read-error'))
    reader.onload = () => {
      const source = `${reader.result ?? ''}`
      const image = new Image()
      image.onerror = () => reject(new Error('image-load-error'))
      image.onload = () => {
        const maxWidth = 1400
        const scale = image.width > maxWidth ? maxWidth / image.width : 1
        const targetWidth = Math.round(image.width * scale)
        const targetHeight = Math.round(image.height * scale)

        const canvas = document.createElement('canvas')
        canvas.width = targetWidth
        canvas.height = targetHeight
        const context = canvas.getContext('2d')
        if (!context) {
          reject(new Error('canvas-context-error'))
          return
        }
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, targetWidth, targetHeight)
        context.drawImage(image, 0, 0, targetWidth, targetHeight)
        resolve({
          dataUrl: canvas.toDataURL('image/jpeg', 0.9),
          width: targetWidth,
          height: targetHeight,
          updatedAt: Date.now(),
        })
      }
      image.src = source
    }
    reader.readAsDataURL(file)
  })
}

async function waitForImagesToLoad(root: HTMLElement): Promise<void> {
  const images = Array.from(root.querySelectorAll('img'))
  if (images.length === 0) {
    return
  }
  await Promise.all(
    images.map((img) => {
      if (img.complete && img.naturalWidth > 0) {
        return Promise.resolve()
      }
      return new Promise<void>((resolve) => {
        const done = () => resolve()
        img.addEventListener('load', done, { once: true })
        img.addEventListener('error', done, { once: true })
      })
    }),
  )
}

function buildResponsivePreviewHtml(contentHtml: string): string {
  return `<!doctype html>
<html lang="hu">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      html, body {
        margin: 0;
        padding: 0;
        width: 100%;
        overflow-x: hidden;
        overflow-y: auto;
        background: #ffffff;
      }
      #preview-stage {
        width: 100%;
        overflow: hidden;
        display: flex;
      }
      #preview-root {
        transform-origin: top left;
        will-change: transform;
      }
    </style>
  </head>
  <body>
    <div id="preview-stage">
      <div id="preview-root">${contentHtml}</div>
    </div>
    <script>
      (function() {
        const stage = document.getElementById('preview-stage');
        const root = document.getElementById('preview-root');
        if (!stage || !root) return;
        const fit = () => {
          root.style.transform = 'none';
          const contentWidth = root.scrollWidth || 1;
          const availableWidth = stage.clientWidth || 1;
          const scale = Math.min(1, availableWidth / contentWidth);
          root.style.width = contentWidth + 'px';
          const isMobile = window.matchMedia('(max-width: 760px)').matches;
          stage.style.justifyContent = isMobile ? 'flex-start' : 'center';
          root.style.transform = 'scale(' + scale + ')';
          const contentHeight = root.scrollHeight || 0;
          const scaledHeight = Math.ceil(contentHeight * scale);
          stage.style.height = scaledHeight + 'px';
          document.body.style.height = scaledHeight + 'px';
        };
        window.requestAnimationFrame(fit);
        window.setTimeout(fit, 100);
        window.addEventListener('load', fit);
        window.addEventListener('resize', fit);
      })();
    </script>
  </body>
</html>`
}

export default App

