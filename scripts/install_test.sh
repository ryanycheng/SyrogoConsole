#!/usr/bin/env bash
set -euo pipefail

INSTALLER="$(dirname "$0")/install.sh"
ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT

fail_test() {
  printf 'installer test failed: %s\n' "$*" >&2
  exit 1
}

write_command() {
  local path="$1"
  shift
  printf '#!/usr/bin/env bash\n%s\n' "$*" > "$path"
  chmod +x "$path"
}

make_archive() {
  local root="$1" version="$2" fixture
  fixture="$root/fixture/syrogo-console_${version}_linux_amd64"
  mkdir -p "$fixture/dist" "$fixture/deploy/systemd"
  printf '#!/usr/bin/env sh\nexit 0\n' > "$fixture/syrogo-console"
  chmod +x "$fixture/syrogo-console"
  printf '<html></html>\n' > "$fixture/dist/index.html"
  cp "$(dirname "$INSTALLER")/../deploy/systemd/syrogo-console.service" "$fixture/deploy/systemd/"
  tar -C "$root/fixture" -czf "$root/console.tar.gz" "$(basename "$fixture")"
  (cd "$root" && sha256sum console.tar.gz > checksums.txt)
}

setup_case() {
  CASE_ROOT="$ROOT/$1"
  mkdir -p "$CASE_ROOT/bin" "$CASE_ROOT/systemd"
  : > "$CASE_ROOT/calls.log"
  write_command "$CASE_ROOT/bin/id" 'if [ "${1:-}" = "-u" ]; then printf 0; else exit 0; fi'
  write_command "$CASE_ROOT/bin/uname" 'case "${1:-}" in -s) printf Linux;; -m) printf amd64;; esac'
  write_command "$CASE_ROOT/bin/systemctl" 'printf "systemctl %s\n" "$*" >> "${TEST_LOG:?}"'
  write_command "$CASE_ROOT/bin/sleep" ':'
  write_command "$CASE_ROOT/bin/useradd" ':'
  write_command "$CASE_ROOT/bin/curl" 'printf "curl %s\n" "$*" >> "${TEST_LOG:?}"; case "$*" in *healthz*) [ -f "${CORE_HEALTH_MARKER:?}" ];; *scripts/install.sh*) printf "mock core installer\n";; *) exit 1;; esac'
  write_command "$CASE_ROOT/bin/bash" 'printf "core-bash token=%s args=%s\n" "${SYROGO_BOOTSTRAP_ADMIN_TOKEN:-}" "$*" >> "${TEST_LOG:?}"; [ -n "${SYROGO_BOOTSTRAP_ADMIN_TOKEN:-}" ] || exit 91; [ "$*" = "-s -- --version v0.16.3 --bootstrap" ] || exit 92; mkdir -p "${SYROGO_CORE_ROOT:?}/bin" "${SYROGO_CORE_ROOT:?}/config"; : > "$SYROGO_CORE_ROOT/bin/syrogo"; chmod +x "$SYROGO_CORE_ROOT/bin/syrogo"; printf "installed-core\n" > "$SYROGO_CORE_ROOT/config/config.yaml"; : > "${SYROGO_CORE_UNIT:?}"; : > "${CORE_HEALTH_MARKER:?}"; printf "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\n"'

  export TEST_LOG="$CASE_ROOT/calls.log"
  export CORE_HEALTH_MARKER="$CASE_ROOT/core.healthy"
  export SYROGO_ID="$CASE_ROOT/bin/id"
  export SYROGO_UNAME="$CASE_ROOT/bin/uname"
  export SYROGO_SYSTEMCTL="$CASE_ROOT/bin/systemctl"
  export SYROGO_SLEEP="$CASE_ROOT/bin/sleep"
  export SYROGO_USERADD="$CASE_ROOT/bin/useradd"
  export SYROGO_CURL="$CASE_ROOT/bin/curl"
  export SYROGO_BASH="$CASE_ROOT/bin/bash"
  export SYROGO_SYSTEMD_DIR="$CASE_ROOT/systemd"
  export SYROGO_CONSOLE_INSTALL_ROOT="$CASE_ROOT/console"
  export SYROGO_CONSOLE_USER="$(id -un)"
  export SYROGO_CONSOLE_GROUP="$(id -gn)"
  export SYROGO_CORE_ROOT="$CASE_ROOT/core"
  export SYROGO_CORE_UNIT="$CASE_ROOT/systemd/syrogo.service"
  export SYROGO_CORE_INSTALLER_URL='https://core.invalid/__TAG__/scripts/install.sh'
  make_archive "$CASE_ROOT" v0.16.3
}

install_args() {
  printf '%s\n' --archive "$CASE_ROOT/console.tar.gz" --checksum-file "$CASE_ROOT/checksums.txt" --version "$1" --skip-healthcheck
}

make_healthy_core() {
  mkdir -p "$SYROGO_CORE_ROOT/bin" "$SYROGO_CORE_ROOT/config"
  : > "$SYROGO_CORE_ROOT/bin/syrogo"
  chmod +x "$SYROGO_CORE_ROOT/bin/syrogo"
  printf 'preserve-this-config\n' > "$SYROGO_CORE_ROOT/config/config.yaml"
  : > "$SYROGO_CORE_UNIT"
  : > "$CORE_HEALTH_MARKER"
}

# Default ensure and --console-only both reuse a healthy Core without changing it.
for mode in ensure console-only; do
  setup_case "healthy-$mode"
  make_healthy_core
  before="$(sha256sum "$SYROGO_CORE_ROOT/config/config.yaml")"
  args=()
  [ "$mode" = ensure ] || args+=(--console-only)
  mapfile -t common < <(install_args 0.16.3)
  "$INSTALLER" "${args[@]}" "${common[@]}"
  [ "$before" = "$(sha256sum "$SYROGO_CORE_ROOT/config/config.yaml")" ] || fail_test "$mode changed Core config"
  ! grep -q '^core-bash ' "$TEST_LOG" || fail_test "$mode reinstalled healthy Core"
done

# A completely empty host is bootstrapped by both default ensure and --with-core.
for mode in ensure with-core; do
  setup_case "empty-$mode"
  args=()
  [ "$mode" = ensure ] || args+=(--with-core)
  mapfile -t common < <(install_args v0.16.3)
  "$INSTALLER" "${args[@]}" "${common[@]}"
  grep -q 'curl .*https://core.invalid/v0.16.3/scripts/install.sh' "$TEST_LOG" || fail_test "$mode did not fetch same-tag Core installer"
  grep -Eq '^core-bash token=[0-9a-f]{64} args=-s -- --version v0.16.3 --bootstrap$' "$TEST_LOG" || fail_test "$mode violated Core installer contract"
  [ -f "$CORE_HEALTH_MARKER" ] || fail_test "$mode did not install Core"
done

# --console-only fails when Core is absent.
setup_case console-only-absent
mapfile -t common < <(install_args v0.16.3)
if "$INSTALLER" --console-only "${common[@]}" >"$CASE_ROOT/out" 2>&1; then
  fail_test '--console-only accepted an absent Core'
fi
grep -q -- '--console-only requires an existing healthy Core' "$CASE_ROOT/out"
[ ! -e "$SYROGO_CONSOLE_INSTALL_ROOT" ]

# Any partial or complete-but-unhealthy Core footprint fails closed.
for state in partial unhealthy; do
  setup_case "$state-core"
  mkdir -p "$SYROGO_CORE_ROOT/bin" "$SYROGO_CORE_ROOT/config"
  : > "$SYROGO_CORE_ROOT/bin/syrogo"
  chmod +x "$SYROGO_CORE_ROOT/bin/syrogo"
  if [ "$state" = unhealthy ]; then
    printf 'must-not-change\n' > "$SYROGO_CORE_ROOT/config/config.yaml"
    : > "$SYROGO_CORE_UNIT"
  fi
  mapfile -t common < <(install_args v0.16.3)
  if "$INSTALLER" --with-core "${common[@]}" >"$CASE_ROOT/out" 2>&1; then
    fail_test "$state Core was modified"
  fi
  grep -q 'appears incomplete or unhealthy' "$CASE_ROOT/out"
  ! grep -q '^core-bash ' "$TEST_LOG" || fail_test "$state Core invoked installer"
done

# Local archives retain an explicit normalized version; malformed versions fail early.
setup_case invalid-version
mapfile -t common < <(install_args v0.16)
if "$INSTALLER" "${common[@]}" >"$CASE_ROOT/out" 2>&1; then
  fail_test 'invalid version was accepted'
fi
grep -q -- '--version must be vX.Y.Z' "$CASE_ROOT/out"

setup_case archive-without-version
if "$INSTALLER" --archive "$CASE_ROOT/console.tar.gz" --checksum-file "$CASE_ROOT/checksums.txt" --skip-healthcheck >"$CASE_ROOT/out" 2>&1; then
  fail_test 'local archive without version was accepted'
fi
grep -q 'local archives require --version vX.Y.Z' "$CASE_ROOT/out"

# Uninstall is scoped to Console and never removes or rewrites Core.
setup_case uninstall
mkdir -p "$SYROGO_CONSOLE_INSTALL_ROOT" "$SYROGO_CORE_ROOT/config"
printf 'core-stays\n' > "$SYROGO_CORE_ROOT/config/config.yaml"
before="$(sha256sum "$SYROGO_CORE_ROOT/config/config.yaml")"
"$INSTALLER" --uninstall
[ ! -e "$SYROGO_CONSOLE_INSTALL_ROOT" ]
[ "$before" = "$(sha256sum "$SYROGO_CORE_ROOT/config/config.yaml")" ] || fail_test 'uninstall changed Core'
grep -q 'systemctl disable syrogo-console.service' "$TEST_LOG"

printf 'installer tests passed\n'
