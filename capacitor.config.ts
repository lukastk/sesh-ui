import type { CapacitorConfig } from '@capacitor/cli'

// Capacitor wraps the EXISTING Svelte build (the same dist/ the web + Electron apps render) —
// Android is ADDITIVE, not a fork. webDir is Vite's build output; the native bridge that gives the
// WebView a daemon connection is the SeshNative Capacitor plugin (android/app/.../SeshNative*.kt),
// which seshClient.js detects as window.SeshNative. appId matches the Electron build (work.jackfruiting.seshui).
const config: CapacitorConfig = {
  appId: 'work.jackfruiting.seshui',
  appName: 'sesh-ui',
  webDir: 'dist',
  android: {
    // The daemon's TCP API is plain http over Tailscale (a private network), so the WebView must
    // be allowed to make cleartext requests to it. The bearer token never lives in the WebView —
    // the native SeshNative plugin holds it (Keystore) and attaches it to the upstream request.
    allowMixedContent: true,
  },
}

export default config
