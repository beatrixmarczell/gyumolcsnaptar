import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function resolveAppVersion(): string {
  const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
    version?: string
  }
  const packageVersion = packageJson.version ? `v${packageJson.version}` : 'v0.0.0'
  try {
    const tag = execSync('git describe --tags --abbrev=0', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
    return tag || packageVersion
  } catch {
    return packageVersion
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const isDesktop = mode === 'desktop'
  const appVersion = resolveAppVersion()
  return {
    // Electron file:// betöltéshez relatív asset útvonal kell.
    base: isDesktop ? './' : process.env.GITHUB_ACTIONS ? '/gyumolcsnaptar/' : '/',
    plugins: [react()],
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
    },
  }
})
