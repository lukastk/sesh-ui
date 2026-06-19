#!/bin/zsh
# sesh-ui try-out launcher. Uses an ISOLATED dev daemon — it does NOT touch your live sesh
# (its own SESH_HOME / sockets / machine name). Double-click this in Finder to run the app.
BOX=~/sesh-ui
SESH="$BOX/sesh-dev"            # persistent dev binary built from sesh main; NOT /tmp (macOS purges it)
export SESH_HOME=/tmp/seshui-dev SESH_MACHINE=seshui-dev \
       SESH_TMUX_SOCKET=seshui-dev SESH_MASTER_SOCKET=seshui-dev-m \
       SESH_CODEX_HOME=/tmp/seshui-codex
mkdir -p "$SESH_HOME" "$SESH_CODEX_HOME"

# 1) Start the dev daemon. `daemon start` spawns a DETACHED child (Setsid syscall + Process.Release)
#    that survives this launcher / the ssh shell exiting, and blocks until the daemon is healthy.
if ! "$SESH" daemon status >/dev/null 2>&1; then
  echo "starting isolated sesh-ui dev daemon…"
  if ! "$SESH" daemon start; then
    echo "FAILED to start the dev daemon — see $SESH_HOME/daemon.log"
    echo "(press Enter to close)"; read _; exit 1
  fi
fi

# 2) Ensure demo threads: headed pi (RPC + Terminal) + headless pi (Transcript), spawned by name if missing.
threads=$("$SESH" thread list 2>/dev/null || true)
if ! echo "$threads" | grep -q 'demo-pi'; then
  echo "spawning headed pi demo (RPC + Terminal)…"
  "$SESH" thread new --agent pi --name demo-pi --cwd "$HOME" --yolo >/dev/null 2>&1 || true
fi
if ! echo "$threads" | grep -q 'demo-headless'; then
  echo "spawning headless pi demo (Transcript)…"
  "$SESH" thread new --agent pi --name demo-headless --cwd "$HOME" --headless >/dev/null 2>&1 || true
fi

# 3) Launch the app, pointed at the dev daemon's unix socket (local trust — no token needed).
echo "launching sesh-ui… (close the window to quit)"
cd "$BOX" || exit 1
SESH_SOCKET_PATH="$SESH_HOME/daemon.sock" exec ./node_modules/.bin/electron .
