import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// Dev-only proxy: stands in for the Electron main-process / Android native HTTP layer.
// It forwards to a sesh daemon's TCP API and INJECTS the bearer token server-side, so the
// browser/renderer never holds the token (and CORS is dodged — the daemon sends none).
// Point these at your dev daemon (see PLAN.md → "Running a dev daemon").
const DAEMON = process.env.SESH_API_URL || 'http://127.0.0.1:8990'
const TOKEN = process.env.SESH_API_TOKEN || 'devtoken'

export default defineConfig({
  plugins: [svelte()],
  server: {
    host: '127.0.0.1',
    port: 5180,
    proxy: {
      // request/response API: /api/* → daemon /v1/*  (+ token header)
      '/api': {
        target: DAEMON,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, '/v1'),
        headers: { Authorization: `Bearer ${TOKEN}` },
      },
      // streaming endpoints (token via header — Vite doesn't apply `rewrite` to WS upgrades):
      '/v1/threads/rpc': { target: DAEMON, ws: true, changeOrigin: true, headers: { Authorization: `Bearer ${TOKEN}` } },
      '/v1/threads/terminal': { target: DAEMON, ws: true, changeOrigin: true, headers: { Authorization: `Bearer ${TOKEN}` } },
    },
  },
})
