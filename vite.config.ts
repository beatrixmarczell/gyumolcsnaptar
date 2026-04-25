import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function extractSemverTag(value: string): string {
  const match = value.match(/v?\d+\.\d+\.\d+/i)
  if (!match) {
    return ''
  }
  return match[0].startsWith('v') ? match[0] : `v${match[0]}`
}

function resolveReleaseChannel(appVersion: string): 'stable' | 'next' {
  const envChannel = (process.env.VITE_RELEASE_CHANNEL ?? '').trim().toLowerCase()
  if (envChannel === 'next' || envChannel === 'stable') {
    return envChannel
  }

  const branchRef = (process.env.VERCEL_GIT_COMMIT_REF ?? '').trim().toLowerCase()
  if (branchRef === 'next/v3' || branchRef.startsWith('next/')) {
    return 'next'
  }

  if (/(alpha|beta|rc)/i.test(appVersion)) {
    return 'next'
  }

  return 'stable'
}

function resolveAppVersion(): string {
  const envVersion = (process.env.VITE_APP_VERSION ?? '').trim()
  const normalizedEnvVersion = extractSemverTag(envVersion)
  if (normalizedEnvVersion) {
    return normalizedEnvVersion
  }

  const vercelTag = (process.env.VERCEL_GIT_COMMIT_TAG ?? '').trim()
  const normalizedVercelTag = extractSemverTag(vercelTag)
  if (normalizedVercelTag) {
    return normalizedVercelTag
  }

  const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
    version?: string
  }
  const packageVersion = extractSemverTag(packageJson.version ?? '') || 'v0.0.0'

  try {
    const tag = execSync('git describe --tags --match v[0-9]* --abbrev=0', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
    const normalizedTag = extractSemverTag(tag)
    return normalizedTag || packageVersion
  } catch {
    try {
      const commitSha =
        (process.env.VERCEL_GIT_COMMIT_SHA ?? '').trim().slice(0, 7) ||
        execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
      if (!commitSha) {
        return packageVersion
      }
      if (packageVersion === 'v0.0.0') {
        return `git-${commitSha}`
      }
      return `${packageVersion}+${commitSha}`
    } catch {
      return packageVersion
    }
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const isDesktop = mode === 'desktop'
  const appVersion = resolveAppVersion()
  const appChannel = resolveReleaseChannel(appVersion)
  return {
    // Electron file:// betöltéshez relatív asset útvonal kell.
    base: isDesktop ? './' : process.env.GITHUB_ACTIONS ? '/gyumolcsnaptar/' : '/',
    plugins: [react()],
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
      __APP_CHANNEL__: JSON.stringify(appChannel),
    },
  }
})
