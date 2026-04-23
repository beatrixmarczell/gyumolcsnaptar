export type HeaderImageState = {
  dataUrl: string
  width: number
  height: number
  updatedAt: number
}

export const APP_STATE_SCHEMA_VERSION = 1 as const

export type AppStatePayload = {
  schemaVersion: typeof APP_STATE_SCHEMA_VERSION
  childrenText: string
  monthValue: string
  startChildByMonth: Record<string, string>
  monthOffDaysByMonth: Record<string, string>
  manualOverridesByMonth: Record<string, Record<string, string>>
  headerImage: HeaderImageState | null
  uiTheme: 'elegant' | 'pastel' | 'minimal'
  darkMode: boolean
  settingsPanelOpen: boolean
}
