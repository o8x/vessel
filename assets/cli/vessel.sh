#!/bin/sh
# Vessel CLI (macOS) — read the data saved in Vessel and open its tools / sessions.
# Installed by Vessel to <data-dir>/bin/vessel (Settings → Data → Install CLI), which also
# creates the `vess` alias and adds that folder to PATH in ~/.zshrc.
#
# Talks to the running Vessel over a local Unix socket (<data-dir>/vessel-cli.sock):
# same-user only (socket mode 0600), no network port, no token written to disk.

set -u

# ANSI colors: only when writing to a terminal, so pipes / files stay clean.
# COLOR_MODE: auto (follow the terminal) | always (--color) | never (--no-color).
COLOR_MODE=auto
init_colors() {
  if [ "$COLOR_MODE" = "always" ] || { [ "$COLOR_MODE" = "auto" ] && [ -t 1 ]; }; then
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
}
init_colors

SELF_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DATA_DIR=$(dirname -- "$SELF_DIR")
SOCKET="$DATA_DIR/vessel-cli.sock"
APP_BUNDLE_ID="cn.com.stdout.vessel"

usage() {
  cat <<'EOF'
Usage: vess <command> [args]        (vessel is an alias of vess)

Commands:
  ssh [args]                   Manage saved SSH hosts / connect (see: vess help ssh)
  2fa                          List 2FA accounts with their current codes
  timestamp [value]            Current date plus epoch seconds / millis / nanos;
                               a value is auto-detected (epoch or date string)
  network [ip|cidr|mask]       With no argument: local LAN and public IP addresses;
                               with a value: network and subnet details for it
  codec <text>                 Show the text as Base64 / hex / URL / ASCII
  hash <text|file>             Show every hash of a text or an existing file
  json [--indent N] [filter] [file|text]
                               Pretty-print JSON from a file, text or stdin;
                               jq-style filter and colors; no argument opens
                               the JSON tool
  id [type] [length]           Generate 5 values: uuid4 (default) / uuid7 / ulid /
                               random / password; length applies to random / password
  uuid [type]                  Alias of `id` (e.g. uuid uuid7; uuid = id uuid4)
  ulid                         Alias of `id ulid`
  edit [file]                  Open a scratch file (or <file>) in the Vessel editor
  main                         Open the Vessel main window
  restart                      Restart Vessel
  check-update                 Check for available updates
  regex | color | ids          Open that tool in the Vessel app
  clipboard | nutrient | games Open that tool in the Vessel app
  completion                   Print the zsh completion function
  upgrade                      Reinstall the vessel CLI from the running app
  help [command]               Show this help, or detailed help / examples for a command

Run `vess help <command>` (or `vess <command> --help`) for detailed arguments and examples.
EOF
}

# Detailed help / examples for one command (`vess help <command>`).
cmd_help() {
  case "${1:-}" in
    '')
      usage
      return 0
      ;;
    ssh)
      cat <<'EOF'
Usage: vess ssh [user@host] [password]
       vess ssh <alias>

Arguments:
  user@host   Target host; user is optional.
  password    Optional password (may contain spaces). Omit to use keys / saved credentials.
  alias       A host alias from ~/.ssh/config.

Examples:
  vess ssh
  vess ssh root@192.168.1.10
  vess ssh root@192.168.1.10 "my password"
  vess ssh my-server
EOF
      ;;
    2fa)
      cat <<'EOF'
Usage: vess 2fa

Lists saved 2FA accounts with their current TOTP codes and remaining seconds.
2FA now lives inside the "IDs & passwords" tool.

Examples:
  vess 2fa
EOF
      ;;
    timestamp|ts)
      cat <<'EOF'
Usage: vess timestamp [value]

Arguments:
  value   Optional. Epoch seconds (≤11 digits), milliseconds (≤15 digits),
          nanoseconds, or a date string (e.g. "2026-01-01 12:00").

Examples:
  vess timestamp
  vess timestamp 1700000000
  vess timestamp 1700000000000
  vess timestamp "2026-01-01 12:00"
EOF
      ;;
    network|net|subnet|ip)
      cat <<'EOF'
Usage: vess network [ip|cidr|mask]

Arguments:
  (none)          Show local LAN and public IPv4 / IPv6 addresses.
  ip|cidr|mask    Show network details for an IPv4 / IPv6 address or network.

Examples:
  vess network
  vess network 192.168.1.10/24
  vess network 2001:db8::/32
  vess network 0xc0a80101
EOF
      ;;
    json)
      cat <<'EOF'
Usage: vess json [--indent N] [--color|--no-color] [filter] [file|text]
       vess json -                 # read JSON from stdin
       printf '{"a":1}' | vess json

Arguments:
  filter      jq-style filter applied to the JSON (e.g. `.name`, `.items[0].id`,
              `.[] | select(.ok)`). An argument starting with `.` or naming a
              builtin is read as a filter; the JSON then comes from stdin or
              from the second argument.
  file|text   Existing file path → format that file; otherwise treat the
              argument as JSON text. Use `-` or pipe to read from stdin.
              With no arguments, opens the JSON tool in the Vessel app.

Options:
  --indent N  Indentation width in spaces (0-10, default 4). 0 prints compact
              single-line JSON (like jq -c).
  --color     Always colorize the output (like jq --color-output).
  --no-color  Never colorize the output.

Output: formatted JSON with 4-space indentation, syntax-colored like jq when
the output goes to a terminal (invalid JSON returns an error).

Examples:
  vess json '{"b":2,"a":1}'
  vess json ./package.json
  vess json --indent 2 ./package.json
  vess json --no-color ./package.json
  cat data.json | vess json
  cat data.json | vess json .items[0].name
  vess json '.[] | select(.ok)' ./data.json
EOF
      ;;
    codec|encode|text)
      cat <<'EOF'
Usage: vess codec [text]
       printf 'hello' | vess codec

Arguments:
  text   Text to encode. When omitted, reads from stdin.

Output: text, Base64, hex, URL encode / decode and ASCII decimal.

Examples:
  vess codec "hello world"
  echo -n hello | vess codec
EOF
      ;;
    hash)
      cat <<'EOF'
Usage: vess hash <text|file>
       printf 'hello' | vess hash

Arguments:
  text|file   Existing file path → hash the file; otherwise hash the text.
              When omitted, reads from stdin.

Output: all supported algorithms.

Examples:
  vess hash "hello"
  vess hash ./package.json
  cat README.md | vess hash
EOF
      ;;
    id|uuid|ulid)
      cat <<'EOF'
Usage: vess id [type] [length]

Arguments:
  type     uuid4 (default) | uuid7 | ulid | random | password
  length   Only for random (4–64, default 16) and password (8–64, default 20).
           Always generates 5 values.

Aliases: `vess uuid` = `vess id uuid4`; `vess ulid` = `vess id ulid`.

Examples:
  vess id
  vess id uuid7
  vess id ulid
  vess id random 24
  vess id password
  vess id password 32
EOF
      ;;
    edit)
      cat <<'EOF'
Usage: vess edit [file]

Arguments:
  file   Optional local file to open. Without it, creates a new scratch file.

Examples:
  vess edit
  vess edit ./README.md
EOF
      ;;
    regex|color|ids|clipboard|nutrient|games)
      cat <<EOF
Usage: vess ${1}

Opens the "${1}" tool in the Vessel app.

Examples:
  vess ${1}
EOF
      ;;
    main)
      cat <<'EOF'
Usage: vess main

Opens the Vessel main window (starting the app first if needed). No arguments.

Examples:
  vess main
EOF
      ;;
    restart)
      cat <<'EOF'
Usage: vess restart

Restarts Vessel (relaunch after quitting). No arguments.
The installed CLI and its socket reconnect automatically.

Examples:
  vess restart
EOF
      ;;
    check-update)
      cat <<'EOF'
Usage: vess check-update

Triggers an interactive update check in the running Vessel app
(the same flow as the update button in the app). No arguments.

Examples:
  vess check-update
EOF
      ;;
    upgrade)
      cat <<'EOF'
Usage: vess upgrade

Reinstalls the `vessel` CLI (script, zsh completion and PATH block) from the
currently running Vessel app. No arguments.

Examples:
  vess upgrade
EOF
      ;;
    completion)
      cat <<'EOF'
Usage: vess completion

Prints the zsh completion function (normally sourced from ~/.zshrc by the installer).

Examples:
  vess completion
EOF
      ;;
    help)
      cat <<'EOF'
Usage: vess help [command]

Shows the command list, or detailed arguments / examples for one command.

Examples:
  vess help
  vess help network
  vess help id
EOF
      ;;
    *)
      err "unknown command: $1"
      usage
      return 1
      ;;
  esac
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

# JSON 语法着色（jq 风格）：键 / 字符串 / 数字 / true / false / null / 括号各一色。
# 输入是服务端正则化过的 JSON（每行一个 token，字符串内无裸换行），逐行扫描即可。
colorize_json() {
  if [ -z "$C_RESET" ]; then
    cat
    return 0
  fi
  awk -v reset="$C_RESET" -v key="$C_CYAN" -v str="$C_GREEN" -v num="$C_YELLOW" \
      -v tcol="$C_GREEN" -v fcol="$C_RED" -v nul="$C_DIM" -v punct="$C_DIM" '
    function is_space(c) { return c == " " || c == "\t" }
    {
      line = $0
      out = ""
      i = 1
      n = length(line)
      while (i <= n) {
        c = substr(line, i, 1)
        if (c == "\"") {
          # 取出一个完整字符串（含转义），再判断它后面是不是冒号 → 是则是键。
          j = i + 1
          tok = c
          while (j <= n) {
            ch = substr(line, j, 1)
            if (ch == "\\") { tok = tok ch substr(line, j + 1, 1); j += 2; continue }
            tok = tok ch
            j++
            if (ch == "\"") break
          }
          k = j
          while (k <= n && is_space(substr(line, k, 1))) k++
          if (k <= n && substr(line, k, 1) == ":") out = out key tok reset
          else out = out str tok reset
          i = j
          continue
        }
        if (c == "-" || (c >= "0" && c <= "9")) {
          rest = substr(line, i)
          if (match(rest, /^-?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?/)) {
            out = out num substr(rest, 1, RLENGTH) reset
            i += RLENGTH
            continue
          }
        }
        rest = substr(line, i)
        if (rest ~ /^true/) { out = out tcol "true" reset; i += 4; continue }
        if (rest ~ /^false/) { out = out fcol "false" reset; i += 5; continue }
        if (rest ~ /^null/) { out = out nul "null" reset; i += 4; continue }
        if (index("{}[],:", c) > 0) { out = out punct c reset; i++; continue }
        out = out c
        i++
      }
      print out
    }'
}

# Call the local API: api <METHOD> <PATH> [BODY] [FORMATTER]; prints the response body on success,
# writes the server's error message to stderr and returns non-zero on failure.
# FORMATTER defaults to `colorize` (tables); the json command passes `colorize_json`.
api() {
  _method=$1
  _path=$2
  _data=${3:-}
  _fmt=${4:-colorize}
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
      [ -n "$_body" ] && printf '%s\n' "$_body" | $_fmt
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

# jq 内置函数名（可以单独作为过滤器的那些）：与主进程 jq-service 的函数表对应。
JQ_BUILTINS="length keys keys_unsorted values type not empty add sort unique reverse flatten min max floor ceil round sqrt abs first last tostring tonumber tojson ascii_downcase ascii_upcase explode implode to_entries from_entries paths leaf_paths any all arrays objects strings numbers booleans nulls"

# 这个参数看起来像 jq 过滤器吗？以 . 开头（但不是路径），或者是一个内置函数名。
looks_like_filter() {
  case "$1" in
    ./*|../*|/*) return 1 ;;
  esac
  case "$1" in
    .*) return 0 ;;
  esac
  case " $JQ_BUILTINS " in
    *" $1 "*) return 0 ;;
  esac
  return 1
}

# URL 编码：每个字节转成 %XX（过滤里的 . | [ ] " 等字符都能安全放进 query）。
urlencode() {
  printf '%s' "$1" | od -An -v -tx1 | tr -d ' \n' | sed 's/../%&/g'
}

cmd_json() {
  _indent=''
  _color=''
  _filter=''
  _input=''
  _arg2=''
  _npos=0
  _endopts=0
  while [ $# -gt 0 ]; do
    if [ "$_endopts" -eq 1 ]; then
      _npos=$((_npos + 1))
      if [ "$_npos" -eq 1 ]; then
        _input=$1
      else
        _arg2=$1
      fi
      shift
      continue
    fi
    case "$1" in
      --indent|-i)
        if [ $# -lt 2 ]; then
          err "--indent requires a number"
          exit 1
        fi
        _indent=$2
        shift 2
        ;;
      --indent=*)
        _indent=${1#--indent=}
        shift
        ;;
      --color|-C)
        _color=always
        shift
        ;;
      --no-color|--monochrome)
        _color=never
        shift
        ;;
      --)
        _endopts=1
        shift
        ;;
      -)
        # `-` 表示从 stdin 读（不是选项）。
        if [ "$_npos" -ge 1 ]; then
          err "json accepts a single file path or JSON text"
          exit 1
        fi
        _npos=$((_npos + 1))
        _input='-'
        shift
        ;;
      -*)
        err "unknown option: $1"
        exit 1
        ;;
      *)
        _npos=$((_npos + 1))
        if [ "$_npos" -eq 1 ]; then
          _input=$1
        else
          _arg2=$1
        fi
        shift
        ;;
    esac
  done
  if [ "$_npos" -gt 2 ]; then
    err "json accepts at most a filter and a file path"
    exit 1
  fi
  if [ -n "$_indent" ]; then
    case "$_indent" in
      *[!0-9]*)
        err "--indent must be a number between 0 and 10"
        exit 1
        ;;
    esac
    if [ "$_indent" -gt 10 ]; then
      err "--indent must be a number between 0 and 10"
      exit 1
    fi
  fi
  if [ -n "$_color" ]; then
    COLOR_MODE=$_color
    init_colors
  fi
  # 两个位置参数：第一个是 jq 过滤器，第二个是文件（不存在时按 JSON 文本处理）。
  if [ "$_npos" -ge 2 ]; then
    _filter=$_input
    _input=$_arg2
  elif [ "$_npos" -eq 1 ]; then
    # 一个位置参数：是已存在的文件 → 当文件；看起来像过滤器 → 当过滤器；否则当 JSON 文本。
    if [ ! -f "$_input" ] && looks_like_filter "$_input"; then
      _filter=$_input
      _input=''
    fi
  fi
  if [ -z "$_input" ]; then
    if [ ! -t 0 ]; then
      _input=$(cat)
    elif [ -n "$_filter" ]; then
      err "json requires JSON text, a file path or stdin"
      exit 1
    else
      # 无参数且非管道：保持原有行为，打开应用里的 JSON 工具。
      cmd_open json
      return
    fi
  elif [ "$_input" = "-" ]; then
    _input=$(cat)
  fi
  if [ -z "$_input" ]; then
    err "json requires JSON text, a file path or stdin"
    exit 1
  fi
  with_app
  _query=''
  if [ -n "$_indent" ]; then
    _query="indent=$_indent"
  fi
  if [ -n "$_filter" ]; then
    if [ -n "$_query" ]; then
      _query="$_query&"
    fi
    _query="${_query}filter=$(urlencode "$_filter")"
  fi
  _path="/v1/json"
  if [ -n "$_query" ]; then
    _path="$_path?$_query"
  fi
  if [ -f "$_input" ]; then
    _abs=$(CDPATH= cd -- "$(dirname -- "$_input")" && pwd)/$(basename -- "$_input")
    api POST "$_path" "file
$_abs" colorize_json
  else
    api POST "$_path" "text
$_input" colorize_json
  fi
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

cmd_id() {
  with_app
  api POST /v1/id "${1:-}${2:+ $2}"
}

cmd_edit() {
  with_app
  api POST /v1/edit "${1:-}"
}

# 打开主界面（应用未运行时先启动）。
cmd_main() {
  if [ -n "${1:-}" ]; then
    err "main takes no arguments"
    exit 1
  fi
  with_app
  api POST /v1/main
}

# 重启 Vessel（先收到响应，再由主进程 relaunch + quit）。
cmd_restart() {
  if [ -n "${1:-}" ]; then
    err "restart takes no arguments"
    exit 1
  fi
  with_app
  api POST /v1/restart
}

# 触发一次交互式检查更新。
cmd_check_update() {
  if [ -n "${1:-}" ]; then
    err "check-update takes no arguments"
    exit 1
  fi
  with_app
  api POST /v1/check-update
}

# 重新安装 CLI（从当前运行的 Vessel 复制最新的脚本 / 补全）。
cmd_upgrade() {
  if [ -n "${1:-}" ]; then
    err "upgrade takes no arguments"
    exit 1
  fi
  with_app
  api POST /v1/upgrade
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

# `vess <command> --help` / `-h` → detailed help for that command.
if [ "${2:-}" = "-h" ] || [ "${2:-}" = "--help" ]; then
  cmd_help "$1"
  exit $?
fi

case "${1:-}" in
  ''|-h|--help)
    usage
    ;;
  help)
    shift
    cmd_help "${1:-}"
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
  json)
    shift
    cmd_json "$@"
    ;;
  id)
    shift
    cmd_id "${1:-}" "${2:-}"
    ;;
  uuid)
    shift
    cmd_id "${1:-uuid4}" "${2:-}"
    ;;
  ulid)
    shift
    cmd_id "ulid" "${1:-}"
    ;;
  edit)
    shift
    cmd_edit "${1:-}"
    ;;
  main)
    shift
    cmd_main "${1:-}"
    ;;
  restart)
    shift
    cmd_restart "${1:-}"
    ;;
  check-update)
    shift
    cmd_check_update "${1:-}"
    ;;
  upgrade)
    shift
    cmd_upgrade "${1:-}"
    ;;
  completion)
    cat "$SELF_DIR/_vessel" 2>/dev/null || err "completion file not found: $SELF_DIR/_vessel"
    ;;
  __complete)
    shift
    cmd_complete "${1:-}"
    ;;
  regex|color|ids|clipboard|nutrient|games)
    cmd_open "$1"
    ;;
  *)
    err "unknown command: $1"
    usage
    exit 1
    ;;
esac
