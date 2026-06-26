#!/usr/bin/env bash
#
# install-android.sh — build the sesh-ui APK and push it to the phone over Tailscale.
#
# The everyday loop:  ./scripts/install-android.sh
#   vite build → cap sync → gradlew assembleDebug → adb install -r  (in place, token preserved).
#
# Why "in place, token preserved": the daemon token lives in the phone's AndroidKeyStore keyed to
# the app's *signing identity*. As long as every build is signed by THIS box's debug keystore
# (~/.android/debug.keystore), `adb install -r` upgrades over the existing app and the saved
# endpoint+token survive. Installing an APK signed by a different key would force an uninstall and
# wipe the token — which is exactly why we build+push locally instead of pulling a CI-built APK.
#
# Wireless-debugging connection model (Android):
#   - PAIRING is a persistent, one-time step: a *pairing port* + 6-digit code. It survives reboots.
#   - The CONNECT port ROTATES (after a reboot or toggling Wireless debugging off/on). So the normal
#     path only needs the current connect port; pairing is only needed the first time (or if the
#     phone forgot this host). This script tries the saved connect port first and only drops into
#     the pair flow when it genuinely can't connect.
#
# Flags:
#   -n, --no-build   skip the build; reinstall the existing APK
#   -l, --launch     start the app on the phone after installing
#       --host H     override target host (default: android-main, or $SESH_UI_ANDROID_HOST)
#       --port P     use connect port P (and save it) instead of the stored one
#   -h, --help       show this help
#
# The working host:port is cached in scripts/.android-target.local (gitignored).

set -euo pipefail

cd "$(dirname "$0")/.."   # repo root

# ---- config / state -------------------------------------------------------
TARGET_FILE="scripts/.android-target.local"
DEFAULT_HOST="${SESH_UI_ANDROID_HOST:-android-main}"
APK="android/app/build/outputs/apk/debug/app-debug.apk"
APP_COMPONENT="dev.lukastk.seshui/.MainActivity"

HOST="$DEFAULT_HOST"
PORT=""
DO_BUILD=1
DO_LAUNCH=0

# load cached HOST/PORT if present
if [[ -f "$TARGET_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$TARGET_FILE"
fi

# ---- args -----------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    -n|--no-build) DO_BUILD=0; shift ;;
    -l|--launch)   DO_LAUNCH=1; shift ;;
    --host)        HOST="$2"; shift 2 ;;
    --port)        PORT="$2"; shift 2 ;;
    -h|--help)     sed -n '2,/^set -euo/p' "$0" | sed 's/^# \{0,1\}//; s/^#//' | head -n -1; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

say() { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
err() { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; }

save_target() {
  printf 'HOST=%q\nPORT=%q\n' "$HOST" "$PORT" > "$TARGET_FILE"
}

serial() { echo "$HOST:$PORT"; }

# true if our target serial is present AND authorized (state == "device")
device_online() {
  [[ -n "$PORT" ]] || return 1
  adb devices | awk -v s="$(serial)" '$1==s && $2=="device" {found=1} END{exit !found}'
}

# try to bring the saved connect port online; returns 0 if connected
try_connect() {
  [[ -n "$PORT" ]] || return 1
  device_online && return 0
  say "connecting to $(serial) …"
  adb connect "$(serial)" >/dev/null 2>&1 || true
  # adb may report "connected" while the device is briefly offline — poll a moment.
  for _ in 1 2 3 4 5; do
    device_online && return 0
    sleep 0.4
  done
  return 1
}

prompt() { local v; read -r -p "$1" v </dev/tty; echo "$v"; }

# interactive recovery: either the connect port rotated (still paired) or we need to pair.
ensure_connected() {
  try_connect && { say "device online: $(serial)"; return 0; }

  # The recovery flow reads the pairing/connect port off the phone interactively. If there's no
  # terminal to prompt on (CI, an agent, a piped run), fail loudly instead of spinning forever.
  if [[ ! -t 0 && ! -r /dev/tty ]]; then
    err "phone not reachable at ${HOST}:${PORT:-?} and no terminal to pair/connect interactively."
    err "Run this from an interactive shell, or pass --port <current connect port>."
    exit 1
  fi

  while true; do
    cat >&2 <<EOF

Couldn't reach the phone at ${HOST}:${PORT:-?}.
On the phone:  Settings → Developer options → Wireless debugging  (make sure it's ON).
  [c] Already paired — enter the current connect port (the "IP address & Port" on that screen)
  [p] Not paired yet — pair with a code first
  [q] Quit
EOF
    case "$(prompt 'choice [c/p/q]: ')" in
      c|C)
        PORT="$(prompt 'connect port: ')"
        if try_connect; then save_target; say "device online: $(serial)"; return 0; fi
        err "still couldn't connect on $(serial)"
        ;;
      p|P)
        echo "On the phone, tap 'Pair device with pairing code' — it shows a pairing PORT and a 6-digit CODE." >&2
        local pport pcode
        pport="$(prompt 'pairing port: ')"
        pcode="$(prompt 'pairing code: ')"
        if adb pair "$HOST:$pport" "$pcode"; then
          say "paired. Now back on the main Wireless debugging screen, read the IP address & Port."
          PORT="$(prompt 'connect port: ')"
          if try_connect; then save_target; say "device online: $(serial)"; return 0; fi
          err "paired but couldn't connect on $(serial)"
        else
          err "pairing failed"
        fi
        ;;
      q|Q) err "aborted"; exit 1 ;;
    esac
  done
}

# ---- build ----------------------------------------------------------------
if [[ "$DO_BUILD" == 1 ]]; then
  say "vite build"
  npm run build
  say "cap sync android"
  npx cap sync android
  say "gradlew assembleDebug"
  ( cd android && ./gradlew assembleDebug )
fi

[[ -f "$APK" ]] || { err "APK not found at $APK (build first — drop --no-build)"; exit 1; }

# ---- connect + install ----------------------------------------------------
ensure_connected
say "installing $(basename "$APK") → $(serial)"
adb -s "$(serial)" install -r "$APK"

if [[ "$DO_LAUNCH" == 1 ]]; then
  say "launching $APP_COMPONENT"
  adb -s "$(serial)" shell am start -n "$APP_COMPONENT" >/dev/null
fi

say "done."
