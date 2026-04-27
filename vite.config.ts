import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function extractSemverTag(value: string): string {
  const match = value.match(/v?\d+\.\d+\.\d+(?:-[0-9a-z.-]+)?/i)
  if (!match) {
    return ''
  }
  return match[0].startsWith('v') ? match[0] : `v${match[0]}`
}

function resolveAppVersion(): string {
  const envVersion = (process.env.VITE_APP_VERSION ?? '').trim()
  const normalizedEnvVersion = extractSemverTag(envVersion)
  if (normalizedEnvVersion) {
    return normalizedEnvVersion
  }

  const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
    version?: string
  }
  const packageVersion = extractSemverTag(packageJson.version ?? '')
  if (packageVersion) {
    return packageVersion
  }

  try {
    const commitSha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    return commitSha ? `git-${commitSha}` : 'v0.0.0'
  } catch {
    return 'v0.0.0'
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const isDesktop = mode === 'desktop'
  const appVersion = resolveAppVersion()
  return {
    // Electron file:// betolteshez relativ asset utvonal kell.
    base: isDesktop ? './' : process.env.GITHUB_ACTIONS ? '/gyumolcsnaptar/' : '/',
    plugins: [react()],
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
    },
  }
})

