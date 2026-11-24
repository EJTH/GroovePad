// Copyright (C) 2026 DON:E (Elias Toft Hansen)
// SPDX-License-Identifier: AGPL-3.0-or-later

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const isBeta = process.env.VITE_APP_CHANNEL === 'beta'
const iconPrefix = isBeta ? 'beta-' : ''

export default defineConfig({
  plugins: [
    vue(),
    {
      name: 'beta-branding',
      transformIndexHtml(html) {
        return isBeta
          ? html.replace('/favicon.svg', '/beta-favicon.svg')
            .replace('./pwa-192.png', './beta-pwa-192.png')
            .replace('<title>GroovePad.io</title>', '<title>GroovePad (Beta)</title>')
          : html
      },
    },
    VitePWA({
      registerType: 'prompt',
      workbox: isBeta ? undefined : { navigateFallbackDenylist: [/\/beta(?:\/|$)/] },
      includeAssets: [`${iconPrefix}favicon.svg`],
      manifest: {
        id: './',
        name: isBeta ? 'GroovePad (Beta)' : 'GroovePad.js',
        short_name: isBeta ? 'GroovePad Beta' : 'GroovePad',
        description: 'A mobile groovebox',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#171816',
        theme_color: '#171816',
        icons: [
          { src: `${iconPrefix}pwa-192.png`, sizes: '192x192', type: 'image/png' },
          { src: `${iconPrefix}pwa-512.png`, sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
  },
})
