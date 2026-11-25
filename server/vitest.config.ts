import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations')
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            APP_ORIGIN: 'https://setbook.test',
            GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com',
            GOOGLE_CLIENT_SECRET: 'test-secret',
            SESSION_SIGNING_KEY: 'test-signing-key-that-is-long-enough-0123456789',
            DEV_AUTH: 'true',
            WEB_ORIGINS: 'https://web.test',
          },
        },
      }),
    ],
    test: { setupFiles: ['./test/setup.ts'] },
  }
})
