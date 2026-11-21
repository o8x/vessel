#!/bin/sh
# Vessel CLI (macOS) — read the data saved in Vessel and open its tools / sessions.
# Installed by Vessel to <data-dir>/bin/vessel (Settings → Data → Install CLI), which also
# creates the `vess` alias and adds that folder to PATH in ~/.zshrc.
#
# Talks to the running Vessel over a local Unix socket (<data-dir>/vessel-cli.sock):
# same-user only (socket mode 0600), no network port, no token written to disk.

set -u

# ANSI colors: only when writing to a terminal, so pipes / files stay clean.
if [ -t 1 ]; then
  C_RESET=$(printf '\033[0m')
  C_BOLD=$(printf '\033[1m')
  C_DIM=$(printf '\033[2m')
  C_CYAN=$(printf '\033[36m')
  C_GREEN=$(printf '\033[32m')
  C_RED=$(printf '\033[31m')
  C_YELLOW=$(printf '\033[33m')
else
  C_RESET=''
  C_BOLD=''
  C_DIM=''
  C_CYAN=''
  C_GREEN=''
  C_RED=''
  C_YELLOW=''
fi

SELF_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DATA_DIR=$(dirname -- "$SELF_DIR")
SOCKET="$DATA_DIR/vessel-cli.sock"
APP_BUNDLE_ID="cn.com.stdout.vessel"

usage() {
  cat <<'EOF'
Usage: vess <command> [args]        (vessel is an alias of vess)

Commands:
  ssh                          List saved SSH hosts (host, group, alias)
  ssh <user@host> [password]   Connect, or quick-connect a new host
  ssh <alias>                  Connect to a saved host by its alias
  2fa                          List 2FA accounts with their current codes
  timestamp [value]            Current date plus epoch seconds / millis / nanos;
                               a value is auto-detected (epoch or date string)
  network [ip|cidr|mask]     With no argument: local LAN and public IP addresses;
                               with a value: network and subnet details for it
  codec <text>                 Show the text as Base64 / hex / URL / ASCII
  hash <text|file>             Show every hash of a text or an existing file
  uuid [type]                  Generate 5 values: uuid4 (default) / uuid7 / ulid
  edit [file]                  Open a scratch file (or <file>) in the Vessel editor
  json | regex | color | ids   Open that tool in the Vessel app
  clipboard | nutrient | games Open that tool in the Vessel app
  completion                   Print the zsh completion function
  help                         Show this help

Reading from stdin:
  echo -n hello | vess codec
  cat README.md | vess hash

Examples:
  vess 2fa
  vess timestamp
  vess timestamp 1700000000
  vess network
  vess network 192.168.1.10/24
  vess network 2001:db8::/32
  vess codec "hello world"
  vess hash ./package.json
  vess uuid
  vess uuid uuid7
  vess ssh root@192.168.1.10 "my-password"
  vess edit ./README.md
EOF
}

err() {
  printf '%s%s%s\n' "$C_RED" "vess: $*" "$C_RESET" >&2
}

# Colorize plain-text API output (header row / UUID / labels).
colorize() {
  if [ -z "$C_RESET" ]; then
    cat
    return 0
  fi
  awk -v reset="$C_RESET" -v bold="$C_BOLD" -v cyan="$C_CYAN" -v green="$C_GREEN" -v dim="$C_DIM" '
    function is_header(s) { return s ~ /^[A-Z0-9][A-Z0-9 \/-]*$/ }
    {
      if (NR == 1 && is_header($0)) { print bold cyan $0 reset; next }
      if ($0 ~ /^[0-9a-f][0-9a-f-]*$/ && length($0) >= 20) { print green $0 reset; next }
      if ($0 ~ /^(No |Cannot |Invalid |Type )/) { print dim $0 reset; next }
      if (match($0, /  +/)) { print cyan substr($0, 1, RSTART - 1) reset substr($0, RSTART); next }
      print $0
    }'
}

# Call the local API: api <METHOD> <PATH> [BODY]; prints the response body on success,
# writes the server's error message to stderr and returns non-zero on failure.
api() {
  _method=$1
  _path=$2
  _data=${3:-}
  if [ -n "$_data" ]; then
    _resp=$(curl -sS --max-time 30 --unix-socket "$SOCKET" -X "$_method" \
      --data-binary "$_data" "http://localhost$_path" -w '\n%{http_code}' 2>/dev/null)
  else
    _resp=$(curl -sS --max-time 30 --unix-socket "$SOCKET" -X "$_method" \
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
      [ -n "$_body" ] && printf '%s\n' "$_body" | colorize
      return 0
      ;;
    *)
      [ -n "$_body" ] && err "$_body"
      return 1
      ;;
  esac
}

# 从标准输入读取（管道 / 重定向时）；交互终端下直接返回空。
read_stdin() {
  if [ ! -t 0 ]; then
    cat
  fi
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

# Every command needs the app (data comes from it).
with_app() {
  if ! start_app; then
    err "Vessel is not running; open the app once, then retry."
    exit 1
  fi
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

cmd_2fa() {
  if [ -n "${1:-}" ]; then
    err "2fa takes no arguments"
    exit 1
  fi
  with_app
  api GET /v1/2fa
}

cmd_timestamp() {
  with_app
  if [ -n "${1:-}" ]; then
    api POST /v1/timestamp "$1"
  else
    api GET /v1/timestamp
  fi
}

cmd_network() {
  with_app
  if [ -n "${1:-}" ]; then
    api POST /v1/network "$1"
  else
    api GET /v1/network
  fi
}

cmd_codec() {
  _text=${1:-}
  if [ -z "$_text" ]; then
    _text=$(read_stdin)
  fi
  with_app
  api POST /v1/codec "$_text"
}

cmd_hash() {
  _input=${1:-}
  if [ -z "$_input" ]; then
    _input=$(read_stdin)
  fi
  if [ -z "$_input" ]; then
    err "hash requires text or a file path"
    exit 1
  fi
  with_app
  if [ -f "$_input" ]; then
    # 先转成绝对路径：应用的工作目录与当前 shell 不同。
    _abs=$(CDPATH= cd -- "$(dirname -- "$_input")" && pwd)/$(basename -- "$_input")
    api POST /v1/hash "file
$_abs"
  else
    api POST /v1/hash "text
$_input"
  fi
}

cmd_uuid() {
  with_app
  api POST /v1/uuid "${1:-}"
}

cmd_edit() {
  with_app
  api POST /v1/edit "${1:-}"
}

# 在应用里打开工具（json / regex / color / …）。
cmd_open() {
  with_app
  api POST /v1/open "$1"
}

# Used by the zsh completion: prints candidates silently (nothing when the app is not running).
cmd_complete() {
  case "${1:-}" in
    ssh)
      socket_ready || return 0
      api GET "/v1/complete?kind=ssh" 2>/dev/null
      ;;
  esac
}

case "${1:-}" in
  ''|help|-h|--help)
    usage
    ;;
  ssh)
    shift
    cmd_ssh "${1:-}" "${2:-}"
    ;;
  2fa)
    shift
    cmd_2fa "${1:-}"
    ;;
  timestamp|ts)
    shift
    cmd_timestamp "${1:-}"
    ;;
  network|net|subnet|ip)
    shift
    cmd_network "${1:-}"
    ;;
  codec|encode|text)
    shift
    cmd_codec "${1:-}"
    ;;
  hash)
    shift
    cmd_hash "${1:-}"
    ;;
  uuid)
    shift
    cmd_uuid "${1:-}"
    ;;
  ulid)
    shift
    cmd_uuid "${1:-ulid}"
    ;;
  edit)
    shift
    cmd_edit "${1:-}"
    ;;
  completion)
    cat "$SELF_DIR/_vessel" 2>/dev/null || err "completion file not found: $SELF_DIR/_vessel"
    ;;
  __complete)
    shift
    cmd_complete "${1:-}"
    ;;
  json|regex|color|ids|clipboard|nutrient|games)
    cmd_open "$1"
    ;;
  *)
    err "unknown command: $1"
    usage
    exit 1
    ;;
esac
