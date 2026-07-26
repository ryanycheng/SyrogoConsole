#!/usr/bin/env bash
set -euo pipefail

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT
mkdir -p "$ROOT/bin" "$ROOT/systemd" "$ROOT/core/bin" "$ROOT/core/config"

write_command() {
  local name="$1"
  shift
  printf '#!/usr/bin/env bash\n%s\n' "$*" > "$ROOT/bin/$name"
  chmod +x "$ROOT/bin/$name"
}

write_command id 'if [ "${1:-}" = "-u" ]; then printf 0; else exit 0; fi'
write_command uname 'case "${1:-}" in -s) printf Linux;; -m) printf amd64;; esac'
write_command systemctl 'printf "%s\n" "$*" >> "${TEST_LOG:?}"'
write_command sleep ':'
write_command useradd ':'
write_command curl 'exit 1'

export TEST_LOG="$ROOT/systemctl.log"
export SYROGO_ID="$ROOT/bin/id"
export SYROGO_UNAME="$ROOT/bin/uname"
export SYROGO_SYSTEMCTL="$ROOT/bin/systemctl"
export SYROGO_SLEEP="$ROOT/bin/sleep"
export SYROGO_USERADD="$ROOT/bin/useradd"
export SYROGO_CURL="$ROOT/bin/curl"
export SYROGO_SYSTEMD_DIR="$ROOT/systemd"
export SYROGO_CONSOLE_INSTALL_ROOT="$ROOT/console"
export SYROGO_CORE_ROOT="$ROOT/core"
export SYROGO_CORE_UNIT="$ROOT/systemd/syrogo.service"

# Any partial Core footprint must fail closed before touching Console.
if bash "$(dirname "$0")/install.sh" --console-only --skip-healthcheck >"$ROOT/out" 2>&1; then
  printf 'expected partial Core detection to fail\n' >&2
  exit 1
fi
grep -q 'appears incomplete or unhealthy' "$ROOT/out"
[ ! -e "$ROOT/console" ]

# Uninstall is scoped to Console and never removes Core.
mkdir -p "$ROOT/console"
printf core > "$ROOT/core/marker"
bash "$(dirname "$0")/install.sh" --uninstall
[ ! -e "$ROOT/console" ]
[ "$(cat "$ROOT/core/marker")" = core ]
grep -q 'disable syrogo-console.service' "$TEST_LOG"

printf 'installer tests passed\n'
