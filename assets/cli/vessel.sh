#!/bin/sh
# Vessel CLI (macOS) — list and complete the data saved in Vessel, and open the app on a
# tool or SSH session. Installed by Vessel to <data-dir>/bin/vessel (Settings → Data →
# Install CLI), which also adds that folder to PATH in ~/.zshrc.
#
# Talks to the running Vessel over a local Unix socket (<data-dir>/vessel-cli.sock):
# same-user only (socket mode 0600), no network port, no token written to disk.

set -u

SELF_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DATA_DIR=$(dirname -- "$SELF_DIR")
SOCKET="$DATA_DIR/vessel-cli.sock"
APP_BUNDLE_ID="cn.com.stdout.vessel"

usage() {
  cat <<'EOF'
Usage: vessel <command> [args]

Commands:
  tool                          List tools (id + name)
  tool <id|name>                Open the main window and load the tool
  ssh                           List saved SSH hosts (user@host, group, alias)
  ssh <user@host> [password]    Connect, or quick-connect a new host
  ssh <alias>                   Connect to a saved host by its alias
  2fa                           List 2FA accounts with their current codes
  completion                    Print the zsh completion function
  help                          Show this help

Examples:
  vessel tool
  vessel tool ssh
  vessel ssh
  vessel ssh root@192.168.1.10
  vessel ssh root@192.168.1.10 "my-password"
  vessel 2fa
EOF
}

err() {
  printf 'vessel: %s\n' "$*" >&2
}

# Call the local API: api <METHOD> <PATH> [BODY]; prints the response body on success,
# writes the server's error message to stderr and returns non-zero on failure.
api() {
  _method=$1
  _path=$2
  _data=${3:-}
  if [ -n "$_data" ]; then
    _resp=$(curl -sS --max-time 5 --unix-socket "$SOCKET" -X "$_method" \
      --data-binary "$_data" "http://localhost$_path" -w '\n%{http_code}' 2>/dev/null)
  else
    _resp=$(curl -sS --max-time 5 --unix-socket "$SOCKET" -X "$_method" \
      "http://localhost$_path" -w '\n%{http_code}' 2>/dev/null)
  fi
  if [ -z "$_resp" ]; then
    err "cannot reach Vessel (socket: $SOCKET)"
    return 1
  fi
  _code=$(printf '%s' "$_resp" | tail -n 1)
  _body=$(printf '%s' "$_resp" | sed '$d')
  case "$_code" in
    2*)
      [ -n "$_body" ] && printf '%s\n' "$_body"
      return 0
      ;;
    *)
      [ -n "$_body" ] && err "$_body"
      return 1
      ;;
  esac
}

socket_ready() {
  [ -S "$SOCKET" ]
}

# Open Vessel (a menu bar app: launching does not pop the main window) and wait for the socket.
start_app() {
  if socket_ready; then
    return 0
  fi
  err "starting Vessel…"
  open -b "$APP_BUNDLE_ID" >/dev/null 2>&1 || open -a "Vessel" >/dev/null 2>&1 || true
  _i=0
  while [ "$_i" -lt 50 ]; do
    socket_ready && return 0
    sleep 0.2
    _i=$((_i + 1))
  done
  return 1
}

# Every command needs the app (2FA codes and host lists come from it).
with_app() {
  if ! start_app; then
    err "Vessel is not running; open the app once, then retry."
    exit 1
  fi
}

cmd_tool() {
  if [ -z "${1:-}" ]; then
    with_app
    api GET /v1/tools
    return
  fi
  with_app
  api POST /v1/tool "$1"
}

cmd_ssh() {
  if [ -z "${1:-}" ]; then
    with_app
    api GET /v1/ssh
    return
  fi
  # Target on the first line, password (may contain spaces) on the second.
  with_app
  api POST /v1/ssh "${1}
${2:-}"
}

cmd_twofa() {
  if [ -n "${1:-}" ]; then
    err "2fa takes no arguments"
    usage
    exit 1
  fi
  with_app
  api GET /v1/2fa
}

# Used by the zsh completion: prints candidates silently (nothing when the app is not running).
cmd_complete() {
  case "${1:-}" in
    tool|ssh)
      socket_ready || return 0
      api GET "/v1/complete?kind=$1" 2>/dev/null
      ;;
  esac
}

case "${1:-}" in
  ''|help|-h|--help)
    usage
    ;;
  tool)
    shift
    cmd_tool "${1:-}"
    ;;
  ssh)
    shift
    cmd_ssh "${1:-}" "${2:-}"
    ;;
  2fa|twofa)
    shift
    cmd_twofa "${1:-}"
    ;;
  completion)
    cat "$SELF_DIR/_vessel" 2>/dev/null || err "completion file not found: $SELF_DIR/_vessel"
    ;;
  __complete)
    shift
    cmd_complete "${1:-}"
    ;;
  *)
    err "unknown command: $1"
    usage
    exit 1
    ;;
esac
