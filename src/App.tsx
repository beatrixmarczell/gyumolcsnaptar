import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import {
  addOneMonth,
  generateAssignments,
  getMonthWorkingDays,
  monthLabel,
  toDateKey,
} from './calendar'
import type { AppUserRole, HeaderImageState } from './lib/cloudTypes'
import { getAccessToken, initAuth, isKeycloakConfigured, login, logout } from './lib/auth/keycloakAuth'
import { isCloudSyncAvailable, isKeycloakAuthEnabled } from './lib/supabaseClient'
import {
  applyAppStatePayload,
  buildAppStatePayload,
  fetchGroupState,
  saveGroupState,
} from './lib/supabaseState'

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
const MANUAL_SAVE_SNAPSHOT_STORAGE_KEY = 'fruit-calendar-manual-save-snapshot'
const PDF_TEMPLATE_VERSION = 'PDF_TEMPLATE_V4'
const APP_VERSION = __APP_VERSION__

const CLOUD_SYNC = isCloudSyncAvailable()
const KEYCLOAK_AUTH = isKeycloakAuthEnabled()
const CLOUD_SAVE_DEBOUNCE_MS = 1000

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

function normalizeMonthValue(value: string): string {
  const [yearText, monthText] = value.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return value
  }
  return `${year}-${`${month}`.padStart(2, '0')}`
}

type ManualSaveSnapshot = {
  payload: ReturnType<typeof buildAppStatePayload>
  savedAt: number
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
  const [offDayPickerValue, setOffDayPickerValue] = useState(() => {
    return `${normalizeMonthValue(monthValue)}-01`
  })
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
      return true
    }
    return stored === 'true'
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
  const cloudBootstrapStarted = useRef(false)
  const forcedMonthStartRef = useRef<{ monthValue: string; startChild: string } | null>(null)
  const calendarMonthPickerRef = useRef<HTMLInputElement | null>(null)

  const canEdit = KEYCLOAK_AUTH
    ? isAuthenticated && (userRole === 'admin' || userRole === 'editor')
    : true
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
        setCloudStatus('loading')
        setCanSaveToCloud(true)
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
    const hasToken = Boolean(accessToken)
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
        const remote = await fetchGroupState({ accessToken })
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
  }, [authReady, isAuthenticated, accessToken])

  useEffect(() => {
    if (!CLOUD_SYNC || !canSaveToCloud) {
      return
    }
    if (KEYCLOAK_AUTH && (!isAuthenticated || !accessToken || !canEdit)) {
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
    })
    const timer = setTimeout(() => {
      void saveGroupState(payload, { accessToken, role: userRole })
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
    canSaveToCloud,
    isAuthenticated,
    accessToken,
    userRole,
    canEdit,
  ])

  useEffect(() => {
    setExtraOffDaysText(monthOffDaysByMonth[monthValue] ?? '')
  }, [monthValue, monthOffDaysByMonth])

  useEffect(() => {
    setOffDayPickerValue(`${normalizeMonthValue(monthValue)}-01`)
  }, [monthValue])

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
  const maxDateInMonth = useMemo(() => {
    return toDateKey(new Date(year, monthIndex + 1, 0))
  }, [year, monthIndex])

  const workingDays = useMemo(
    () => getMonthWorkingDays(year, monthIndex, extraOffDays),
    [year, monthIndex, extraOffDays],
  )
  const manualOverrides = useMemo(() => manualOverridesByMonth[monthValue] ?? {}, [manualOverridesByMonth, monthValue])
  const excludedChildren = useMemo(() => excludedChildrenByMonth[monthValue] ?? [], [excludedChildrenByMonth, monthValue])

  const monthResult = useMemo(() => {
    return generateAssignments({
      children,
      monthWorkingDays: workingDays,
      startChild,
      manualOverrides,
      excludedChildren: [],
    })
  }, [children, workingDays, startChild, manualOverrides, excludedChildren])
  const weeks = useMemo(() => chunkByWeek(monthResult.assignments), [monthResult.assignments])
  const exportTitle = useMemo(() => {
    return `GYÜMÖLCSNAPTÁR - ${monthNameHuLong(monthIndex).toUpperCase()}`
  }, [monthIndex])
  const printPreviewHtml = useMemo(() => {
    return buildPdfHtml({
      title: exportTitle,
      weekdays,
      weeks,
      headerImage,
      displayYear: year,
      displayMonthIndex: monthIndex,
    })
  }, [exportTitle, weeks, headerImage, year, monthIndex])
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

  const addExtraOffDay = (): void => {
    if (!offDayPickerValue) {
      return
    }
    const normalizedMonth = normalizeMonthValue(monthValue)
    if (!offDayPickerValue.startsWith(`${normalizedMonth}-`)) {
      alert(`Kérlek az aktuális hónapból válassz dátumot: ${normalizedMonth}`)
      return
    }
    const next = serializeDateKeys([...extraOffDayList, offDayPickerValue])
    setExtraOffDaysText(next)
    setMonthOffDaysByMonth((prev) => ({
      ...prev,
      [monthValue]: next,
    }))
    // Off-day changes must reflow daily assignments continuously.
    setManualOverridesByMonth((prev) => ({
      ...prev,
      [monthValue]: {},
    }))
  }

  const removeExtraOffDay = (dateKey: string): void => {
    const next = serializeDateKeys(extraOffDayList.filter((item) => item !== dateKey))
    setExtraOffDaysText(next)
    setMonthOffDaysByMonth((prev) => ({
      ...prev,
      [monthValue]: next,
    }))
    // Off-day changes must reflow daily assignments continuously.
    setManualOverridesByMonth((prev) => ({
      ...prev,
      [monthValue]: {},
    }))
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
      if (CLOUD_SYNC && KEYCLOAK_AUTH && isAuthenticated && accessToken && canEdit) {
        await saveGroupState(snapshot.payload, { accessToken, role: userRole })
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
          setStartChild,
          setExtraOffDaysText,
          setManualOverrides: () => {},
        },
      )
      if (CLOUD_SYNC && KEYCLOAK_AUTH && isAuthenticated && accessToken && canEdit) {
        await saveGroupState(manualSaveSnapshot.payload, { accessToken, role: userRole })
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
          </div>
          <div className="title-end">
            <span className="app-version-discrete" title="Alkalmazás verziója">
              {APP_VERSION}
            </span>
            {CLOUD_SYNC ? (
              <span
                className={`cloud-pill cloud-pill--${cloudStatus === 'ok' ? 'ok' : cloudStatus === 'err' ? 'err' : 'loading'}`}
                title="Közös adat a Supabase felhőben. Mindenki, aki a linket használja, ugyanazt a mentést látja."
              >
                {cloudStatus === 'loading' && 'Felhő: betöltés…'}
                {cloudStatus === 'ok' && 'Felhő: mentve (közös)'}
                {cloudStatus === 'err' && 'Felhő: hiba'}
                {cloudStatus === 'off' && 'Felhő: —'}
              </span>
            ) : null}
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
              <label className="inline-control compact-control">
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
          {settingsPanelOpen ? '◀' : '▶'}
        </button>
        {canEdit ? (
        <aside className={`panel settings-panel ${settingsPanelOpen ? '' : 'collapsed'}`}>
          <h2>Beállítások</h2>

          <label>
            Kezdő gyerek
            <select
              value={startChild}
              disabled={!canEdit}
              onChange={(e) => {
                const value = e.target.value
                setStartChild(value)
                setStartChildByMonth((prev) => ({
                  ...prev,
                  [monthValue]: value,
                }))
                // Start child change should regenerate month sequence from scratch.
                setManualOverridesByMonth((prev) => ({
                  ...prev,
                  [monthValue]: {},
                }))
              }}
            >
              {children.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>

          <details className="collapsible-box">
            <summary>Extra szünnapok (naptárból választható)</summary>
            <label>
              Szünnap hozzáadása
              <div className="date-picker-row">
                <input
                  type="date"
                  value={offDayPickerValue}
                  min={`${normalizeMonthValue(monthValue)}-01`}
                  max={maxDateInMonth}
                  disabled={!canEdit}
                  onChange={(e) => setOffDayPickerValue(e.target.value)}
                  onFocus={(e) => {
                    const picker = e.currentTarget as HTMLInputElement & { showPicker?: () => void }
                    try {
                      picker.showPicker?.()
                    } catch {
                      // Browsers without showPicker keep native default behavior.
                    }
                  }}
                  onClick={(e) => {
                    const picker = e.currentTarget as HTMLInputElement & { showPicker?: () => void }
                    try {
                      picker.showPicker?.()
                    } catch {
                      // Browsers without showPicker keep native default behavior.
                    }
                  }}
                />
                <button
                  type="button"
                  className="action-button extra-off-day-add"
                  title="Szünnap hozzáadása"
                  aria-label="Szünnap hozzáadása"
                  disabled={!canEdit}
                  onClick={addExtraOffDay}
                >
                  +
                </button>
              </div>
            </label>
            {extraOffDayList.length > 0 ? (
              <ul className="extra-off-days-list">
                {extraOffDayList.map((dateKey) => (
                  <li key={dateKey}>
                    <span>{dateKey}</span>
                    <button
                      type="button"
                      className="action-button secondary extra-off-day-remove"
                      title="Szünnap törlése"
                      aria-label={`Szünnap törlése: ${dateKey}`}
                      disabled={!canEdit}
                      onClick={() => removeExtraOffDay(dateKey)}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="compact-note">Ehhez a hónaphoz még nincs extra szünnap megadva.</p>
            )}
          </details>

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
        ) : null}

        <div className="main-column">
          <section className="panel calendar-panel">
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
                      return (
                        <td key={item.dateKey}>
                          <div className="day">{item.date.getDate()}</div>
                          {canEdit ? (
                            <select value={item.child} disabled={!canEdit} onChange={(e) => updateOverride(item.dateKey, e.target.value)}>
                              {children.map((name) => (
                                <option key={`${item.dateKey}-${name}`} value={name}>
                                  {name}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <div>{item.child}</div>
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
                <span>🧾</span> Nyomtatás / PDF letöltés
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
            <p>Ez fixen azt mutatja, ami PDF/JPG exportban megjelenik.</p>
            <iframe
              title="Nyomtatási előnézet"
              className="print-preview-frame"
              sandbox=""
              srcDoc={printPreviewHtml}
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
  headerImage: HeaderImageState | null
  displayYear: number
  displayMonthIndex: number
}): string {
  const { title, weekdays, weeks, headerImage, displayYear, displayMonthIndex } = params
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
          return `<td style="border:1px solid #4d4d4d;background:#fffbe8;font-weight:700;text-align:center;padding:1.2mm 1mm;font-size:4.1mm;height:7.2mm;">${dayDate.getDate()}</td>`
        })
        .join('')

      const nameRowCells = weekdays
        .map((_, idx) => {
          const item = week.find((entry) => entry.date.getDay() === idx + 1)
          const background = item ? '#f4e9dd' : '#dfe9f6'
          const content = item ? escapeHtml(item.child) : ''
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

export default App
