import type { AppUserRole } from '../cloudTypes'

export type AuthMode = 'none' | 'keycloak'

export type AuthSession = {
  initialized: boolean
  authenticated: boolean
  token: string | null
  displayName: string | null
  email: string | null
  sub: string | null
  role: AppUserRole
}

export type AuthContext = {
  mode: AuthMode
  ready: boolean
  authenticated: boolean
  displayName: string | null
  email: string | null
  role: AppUserRole
}
