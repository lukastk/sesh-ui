import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// Dev-only proxy: stands in for the Electron main-process / Android native HTTP layer.
// It forwards to a sesh daemon's TCP API and INJECTS the bearer token server-side, so the
// browser/renderer never holds the token (and CORS is dodged — the daemon sends none).
// Point these at your dev daemon (see PLAN.md → "Running a dev daemon").
const DAEMON = process.env.SESH_API_URL || 'http://127.0.0.1:8990'
const TOKEN = process.env.SESH_API_TOKEN || 'devtoken'
// Dev daemon (PLAN.md → "Running a dev daemon"): an ISOLATED daemon with its TCP API on,
// never the user's live daemon. SESH_MACHINE=seshui-dev SESH_HOME=/tmp/seshui-dev … on :8990.

// Inject the bearer token on the FORWARDED request (proxyReq / proxyReqWs). Vite's static
// `headers` proxy option is unreliable here, so we set it in the http-proxy hooks — the token
// stays server-side (never in the renderer), exactly as the Electron main process will.
const authHook = (proxy) => {
  proxy.on('proxyReq', (proxyReq) => proxyReq.setHeader('Authorization', `Bearer ${TOKEN}`))
  proxy.on('proxyReqWs', (proxyReq) => proxyReq.setHeader('Authorization', `Bearer ${TOKEN}`))
}

export default defineConfig(({ command }) => ({
  // Electron loads the production build over file:// (win.loadFile), so emit RELATIVE asset
  // paths for the build (absolute /assets/* would 404 under file://). Dev stays at '/'.
  base: command === 'build' ? './' : '/',
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
        configure: authHook,
      },
      // streaming endpoints (the two daemon WebSockets — token injected on the WS upgrade):
      '/v1/threads/rpc': { target: DAEMON, ws: true, changeOrigin: true, configure: authHook },
      '/v1/threads/terminal': { target: DAEMON, ws: true, changeOrigin: true, configure: authHook },
    },
  },
}))
