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

  const ciTagCandidates = [
    process.env.GITHUB_REF_NAME ?? '',
    process.env.VERCEL_GIT_COMMIT_TAG ?? '',
    process.env.CI_COMMIT_TAG ?? '',
  ]
  for (const candidate of ciTagCandidates) {
    const normalized = extractSemverTag(candidate.trim())
    if (normalized) {
      return normalized
    }
  }

  try {
    const headTag = execSync('git tag --points-at HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .split('\n')
      .map((line) => extractSemverTag(line.trim()))
      .find(Boolean)
    if (headTag) {
      return headTag
    }
  } catch {
    // Ignore missing git metadata and continue with fallbacks.
  }

  const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
    version?: string
  }

  try {
    const commitSha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    if (commitSha) {
      return `git-${commitSha}`
    }
  } catch {
    // Ignore and try package fallback.
  }

  const packageVersion = extractSemverTag(packageJson.version ?? '')
  if (packageVersion) {
    return packageVersion
  }

  return 'v0.0.0'
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

