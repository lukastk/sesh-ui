#!/bin/zsh
# sesh-ui launcher (double-click in Finder).
#
# DEFAULT: point the app at your REAL local sesh daemon (~/.sesh/daemon.sock) — the normal use.
#   It shows your real threads across the whole mesh (the grid defaults to all-machines).
#
# SESHUI_DEMO=1: instead run an ISOLATED throwaway dev daemon with demo threads, for trying the
#   app WITHOUT a real daemon. It has its own SESH_HOME / machine / sockets and never touches your
#   real daemon. (Built from sesh main, so it has the rpc/terminal streaming endpoints.)
BOX=~/sesh-ui
cd "$BOX" || exit 1

if [[ -n "$SESHUI_DEMO" ]]; then
  SESH="$BOX/sesh-dev"            # persistent dev binary built from sesh main; NOT /tmp (macOS purges it)
  export SESH_HOME=/tmp/seshui-dev SESH_MACHINE=seshui-dev \
         SESH_TMUX_SOCKET=seshui-dev SESH_MASTER_SOCKET=seshui-dev-m \
         SESH_CODEX_HOME=/tmp/seshui-codex
  mkdir -p "$SESH_HOME" "$SESH_CODEX_HOME"
  # `daemon start` spawns a DETACHED child (Setsid syscall + Process.Release) that survives this
  # launcher / the ssh shell exiting, and blocks until the daemon answers health.
  if ! "$SESH" daemon status >/dev/null 2>&1; then
    echo "starting isolated sesh-ui DEMO daemon…"
    if ! "$SESH" daemon start; then
      echo "FAILED to start the demo daemon — see $SESH_HOME/daemon.log"
      echo "(press Enter to close)"; read _; exit 1
    fi
  fi
  # Ensure demo threads: headed pi (RPC + Terminal) + headless pi (Transcript), by name if missing.
  threads=$("$SESH" thread list 2>/dev/null || true)
  echo "$threads" | grep -q 'demo-pi'      || { echo "spawning headed pi demo (RPC + Terminal)…"; "$SESH" thread new --agent pi --name demo-pi --cwd "$HOME" --yolo >/dev/null 2>&1 || true; }
  echo "$threads" | grep -q 'demo-headless' || { echo "spawning headless pi demo (Transcript)…"; "$SESH" thread new --agent pi --name demo-headless --cwd "$HOME" --headless >/dev/null 2>&1 || true; }
  export SESH_SOCKET_PATH="$SESH_HOME/daemon.sock"
  echo "launching sesh-ui against the DEMO daemon ($SESH_SOCKET_PATH)…"
else
  # The real local daemon (supervised separately — we don't start/stop it here). Point Electron at
  # its unix socket explicitly; this mirrors config.cjs's default, but is explicit so a stale
  # persisted endpoint can't redirect us. Local trust → no token.
  export SESH_SOCKET_PATH="${SESH_HOME:-$HOME/.sesh}/daemon.sock"
  echo "launching sesh-ui against your real sesh daemon ($SESH_SOCKET_PATH)…"
fi

echo "(close the window to quit)"
exec ./node_modules/.bin/electron .
