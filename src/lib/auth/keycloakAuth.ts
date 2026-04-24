import Keycloak from 'keycloak-js'
import type { AuthSession } from './types'
import type { AppUserRole } from '../cloudTypes'

const authMode = (import.meta.env.VITE_AUTH_MODE as string | undefined)?.toLowerCase() ?? 'none'
const keycloakEnabled = authMode === 'keycloak'

const keycloakUrl = import.meta.env.VITE_KEYCLOAK_URL as string | undefined
const keycloakRealm = import.meta.env.VITE_KEYCLOAK_REALM as string | undefined
const keycloakClientId = import.meta.env.VITE_KEYCLOAK_CLIENT_ID as string | undefined

let keycloak: Keycloak | null = null
let initPromise: Promise<AuthSession> | null = null
let refreshTimer: number | null = null

function readProfile(): Pick<AuthSession, 'displayName' | 'email' | 'sub'> {
  const parsed = keycloak?.tokenParsed as
    | {
        preferred_username?: string
        email?: string
        name?: string
        sub?: string
      }
    | undefined

  return {
    displayName: parsed?.name ?? parsed?.preferred_username ?? parsed?.email ?? null,
    email: parsed?.email ?? null,
    sub: parsed?.sub ?? null,
  }
}

function inferRoleFromToken(): AppUserRole {
  const parsed = keycloak?.tokenParsed as
    | {
        preferred_username?: string
        email?: string
        name?: string
        realm_access?: { roles?: string[] }
      }
    | undefined

  const roles = parsed?.realm_access?.roles ?? []
  if (roles.includes('admin')) {
    return 'admin'
  }
  if (roles.includes('editor')) {
    return 'editor'
  }
  if (roles.includes('viewer')) {
    return 'viewer'
  }
  const username = parsed?.preferred_username?.toLowerCase() ?? ''
  const email = parsed?.email?.toLowerCase() ?? ''
  const name = parsed?.name?.toLowerCase() ?? ''
  if (username === 'admin.demo' || username === 'admin_demo' || email === 'admin@example.com' || name.includes('admin')) {
    return 'admin'
  }
  if (username === 'editor.demo' || username === 'editor_demo' || email === 'editor@example.com' || name.includes('editor')) {
    return 'editor'
  }
  return 'viewer'
}

function getSession(authenticated: boolean): AuthSession {
  const profile = readProfile()
  return {
    initialized: true,
    authenticated,
    token: authenticated ? keycloak?.token ?? null : null,
    role: authenticated ? inferRoleFromToken() : 'viewer',
    ...profile,
  }
}

function startRefreshLoop(): void {
  if (!keycloak || refreshTimer != null) {
    return
  }
  refreshTimer = window.setInterval(() => {
    void keycloak
      ?.updateToken(30)
      .catch((error) => console.warn('Keycloak token refresh hiba:', error))
  }, 25000)
}

export function isKeycloakConfigured(): boolean {
  return Boolean(keycloakEnabled && keycloakUrl && keycloakRealm && keycloakClientId)
}

export function getAuthMode(): 'none' | 'keycloak' {
  return keycloakEnabled ? 'keycloak' : 'none'
}

export async function initAuth(): Promise<AuthSession> {
  if (!isKeycloakConfigured()) {
    return {
      initialized: true,
      authenticated: false,
      token: null,
      displayName: null,
      email: null,
      sub: null,
      role: 'viewer',
    }
  }

  if (initPromise) {
    return initPromise
  }

  keycloak = new Keycloak({
    url: keycloakUrl!,
    realm: keycloakRealm!,
    clientId: keycloakClientId!,
  })

  initPromise = keycloak
    .init({
      pkceMethod: 'S256',
      checkLoginIframe: false,
    })
    .then((authenticated) => {
      if (authenticated) {
        startRefreshLoop()
      }
      return getSession(authenticated)
    })
    .catch((error) => {
      console.error('Keycloak init hiba:', error)
      return {
        initialized: true,
        authenticated: false,
        token: null,
        displayName: null,
        email: null,
        sub: null,
        role: 'viewer',
      }
    })

  return initPromise
}

export async function login(): Promise<void> {
  if (!keycloak) {
    await initAuth()
  }
  await keycloak?.login({
    redirectUri: `${window.location.origin}${window.location.pathname}`,
    prompt: 'login',
  })
}

export async function logout(): Promise<void> {
  if (!keycloak) {
    return
  }
  if (refreshTimer != null) {
    window.clearInterval(refreshTimer)
    refreshTimer = null
  }
  await keycloak.logout({ redirectUri: window.location.href })
}

export async function getAccessToken(): Promise<string | null> {
  if (!isKeycloakConfigured()) {
    return null
  }
  if (!keycloak) {
    await initAuth()
  }
  if (!keycloak?.authenticated) {
    return null
  }
  try {
    await keycloak.updateToken(30)
  } catch {
    return null
  }
  return keycloak.token ?? null
}
