declare const __APP_VERSION__: string
declare const __APP_CHANNEL__: 'stable' | 'next'

interface ImportMetaEnv {
  readonly VITE_LOCAL_GATEWAY_BEARER_TOKEN?: string
  readonly VITE_RELEASE_CHANNEL?: 'stable' | 'next'
  readonly VITE_SWAP_ADMIN_TEST_MODE?: 'true' | 'false'
}
