#!/usr/bin/env bash
set -euo pipefail

REPO="${SYROGO_CONSOLE_REPO:-ryanycheng/SyrogoConsole}"
CORE_REPO="${SYROGO_CORE_REPO:-ryanycheng/Syrogo}"
INSTALL_ROOT="${SYROGO_CONSOLE_INSTALL_ROOT:-/opt/syrogo-console}"
SYSTEMD_DIR="${SYROGO_SYSTEMD_DIR:-/etc/systemd/system}"
SYSTEMCTL="${SYROGO_SYSTEMCTL:-systemctl}"
CURL="${SYROGO_CURL:-curl}"
BASH="${SYROGO_BASH:-bash}"
ID="${SYROGO_ID:-id}"
UNAME="${SYROGO_UNAME:-uname}"
USERADD="${SYROGO_USERADD:-useradd}"
SLEEP="${SYROGO_SLEEP:-sleep}"
SERVICE_USER="${SYROGO_CONSOLE_USER:-syrogo-console}"
SERVICE_GROUP="${SYROGO_CONSOLE_GROUP:-$SERVICE_USER}"
DEFAULT_LISTEN="127.0.0.1:23233"
ENV_FILE="${SYROGO_CONSOLE_ENV_FILE:-/etc/syrogo-console.env}"
LISTEN=""
LISTEN_EXPLICIT=0
if [ "${SYROGO_CONSOLE_LISTEN+x}" = x ]; then
  LISTEN="$SYROGO_CONSOLE_LISTEN"
  LISTEN_EXPLICIT=1
fi
CORE_URL="${SYROGO_CORE_URL:-http://127.0.0.1:23234}"
CORE_HEALTH_URL="${SYROGO_CORE_HEALTH_URL:-http://127.0.0.1:23234/healthz}"
CORE_ROOT="${SYROGO_CORE_ROOT:-/opt/syrogo}"
CORE_UNIT="${SYROGO_CORE_UNIT:-/etc/systemd/system/syrogo.service}"
CORE_INSTALLER_URL="${SYROGO_CORE_INSTALLER_URL:-https://raw.githubusercontent.com/$CORE_REPO/refs/tags/__TAG__/scripts/install.sh}"
UNIT_PATH="$SYSTEMD_DIR/syrogo-console.service"
MODE=ensure
VERSION=""
ARCHIVE=""
CHECKSUM_FILE=""
SKIP_HEALTHCHECK=0
TMP_DIR=""

log() { printf '[console-install] %s\n' "$*"; }
fail() { printf '[console-install] %s\n' "$*" >&2; exit 1; }
cleanup() { [ -z "$TMP_DIR" ] || rm -rf "$TMP_DIR"; }
trap cleanup EXIT

usage() {
  printf '%s\n' 'Usage: install.sh [--console-only|--with-core] [--version v0.16.3] [--archive file --checksum-file file] [--uninstall]'
}

normalize_version() {
  local value="${1#v}"
  case "$value" in
    ''|*[!0-9.]*) fail '--version must be vX.Y.Z' ;;
  esac
  printf '%s' "$value" | grep -Eq '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' || fail '--version must be vX.Y.Z'
  printf 'v%s' "$value"
}

validate_listen() {
  local value="$1" host
  case "$value" in
    *[\ \"\'\\=]*|'') fail 'SYROGO_CONSOLE_LISTEN must be a host with port 23233' ;;
  esac
  if [[ "$value" =~ ^\[([0-9A-Fa-f:.%]+)\]:23233$ ]]; then
    return
  fi
  [[ "$value" =~ ^([A-Za-z0-9._-]+):23233$ ]] || fail 'SYROGO_CONSOLE_LISTEN must be a host with port 23233'
  host="${BASH_REMATCH[1]}"
  [ -n "$host" ] || fail 'SYROGO_CONSOLE_LISTEN must be a host with port 23233'
}

read_listen_env() {
  local line value="" count=0
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      SYROGO_CONSOLE_LISTEN=*)
        value="${line#SYROGO_CONSOLE_LISTEN=}"
        count=$((count + 1))
        ;;
      *) fail "invalid Console environment file: $ENV_FILE" ;;
    esac
  done < "$ENV_FILE"
  [ "$count" -eq 1 ] || fail "invalid Console environment file: $ENV_FILE"
  validate_listen "$value"
  printf '%s' "$value"
}

migrate_listen_from_unit() {
  local line value="" count=0
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ExecStart=*)
        count=$((count + 1))
        if [[ "$line" =~ ^ExecStart=[^[:space:]]*/bin/syrogo-console[[:space:]]+--listen[[:space:]]+([^[:space:]]+)[[:space:]]+--root[[:space:]]+[^[:space:]]+/dist[[:space:]]+--core-url[[:space:]]+[^[:space:]]+$ ]]; then
          value="${BASH_REMATCH[1]}"
        fi
        ;;
    esac
  done < "$UNIT_PATH"
  [ "$count" -eq 1 ] && [ -n "$value" ] || fail 'cannot safely migrate Console listen address; rerun with SYROGO_CONSOLE_LISTEN=<host>:23233'
  validate_listen "$value"
  printf '%s' "$value"
}

write_listen_env() {
  local directory temporary
  directory="$(dirname "$ENV_FILE")"
  install -d -m 0755 "$directory"
  temporary="$(mktemp "$directory/.syrogo-console.env.XXXXXX")"
  printf 'SYROGO_CONSOLE_LISTEN=%s\n' "$LISTEN" > "$temporary"
  chmod 0644 "$temporary"
  mv -f "$temporary" "$ENV_FILE"
}

resolve_listen() {
  case "$ENV_FILE" in
    /*) ;;
    *) fail 'SYROGO_CONSOLE_ENV_FILE must be an absolute path' ;;
  esac
  case "$ENV_FILE" in
    *[\ \"\'\\\&\|]*) fail 'SYROGO_CONSOLE_ENV_FILE contains unsupported characters' ;;
  esac
  if [ "$LISTEN_EXPLICIT" -eq 1 ]; then
    validate_listen "$LISTEN"
    write_listen_env
    return
  fi
  if [ -f "$ENV_FILE" ]; then
    LISTEN="$(read_listen_env)"
    return
  fi
  if [ -e "$ENV_FILE" ]; then
    fail "Console environment path is not a regular file: $ENV_FILE"
  fi
  if [ -f "$UNIT_PATH" ]; then
    LISTEN="$(migrate_listen_from_unit)"
  else
    LISTEN="$DEFAULT_LISTEN"
    validate_listen "$LISTEN"
  fi
  write_listen_env
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --console-only) MODE=console-only; shift ;;
      --with-core) MODE=with-core; shift ;;
      --version) [ "$#" -ge 2 ] || fail 'missing --version value'; VERSION="$2"; shift 2 ;;
      --archive) [ "$#" -ge 2 ] || fail 'missing --archive value'; ARCHIVE="$2"; shift 2 ;;
      --checksum-file) [ "$#" -ge 2 ] || fail 'missing --checksum-file value'; CHECKSUM_FILE="$2"; shift 2 ;;
      --skip-healthcheck) SKIP_HEALTHCHECK=1; shift ;;
      --uninstall) MODE=uninstall; shift ;;
      -h|--help) usage; exit 0 ;;
      *) fail "unknown argument: $1" ;;
    esac
  done
  [ -z "$ARCHIVE" ] || [ -n "$VERSION" ] || fail 'local archives require --version vX.Y.Z'
  [ -z "$CHECKSUM_FILE" ] || [ -n "$ARCHIVE" ] || fail '--checksum-file requires --archive'
  [ -z "$VERSION" ] || VERSION="$(normalize_version "$VERSION")"
}

require_host() {
  [ "$($ID -u)" -eq 0 ] || fail 'run as root'
  [ "$($UNAME -s)" = Linux ] || fail 'Linux is required'
  command -v "$SYSTEMCTL" >/dev/null 2>&1 || fail 'systemctl is required'
  command -v "$CURL" >/dev/null 2>&1 || fail 'curl is required'
  command -v "$BASH" >/dev/null 2>&1 || fail 'bash is required'
}

arch() {
  case "$($UNAME -m)" in x86_64|amd64) printf amd64;; aarch64|arm64) printf arm64;; *) fail "unsupported architecture: $($UNAME -m)";; esac
}

core_healthy() { "$CURL" -fsS --connect-timeout 2 "$CORE_HEALTH_URL" >/dev/null 2>&1; }
core_presence_count() {
  local count=0
  [ -e "$CORE_ROOT" ] && count=$((count + 1))
  [ -e "$CORE_UNIT" ] && count=$((count + 1))
  [ -x "$CORE_ROOT/bin/syrogo" ] && count=$((count + 1))
  [ -f "$CORE_ROOT/config/config.yaml" ] && count=$((count + 1))
  printf '%s' "$count"
}

ensure_core() {
  local count token client_token url
  count="$(core_presence_count)"
  if core_healthy; then log 'reusing healthy Syrogo Core without modification'; return; fi
  [ "$count" -eq 0 ] || fail 'Syrogo Core appears incomplete or unhealthy; refusing to modify it'
  [ "$MODE" != console-only ] || fail 'Syrogo Core is absent; --console-only requires an existing healthy Core'
  [ -n "$VERSION" ] || resolve_version
  token="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
  url="${CORE_INSTALLER_URL/__TAG__/$VERSION}"
  log "installing same-tag Core $VERSION using its installer"
  client_token="$("$CURL" -fsSL "$url" | SYROGO_BOOTSTRAP_ADMIN_TOKEN="$token" "$BASH" -s -- --version "$VERSION" --bootstrap)"
  [[ "$client_token" =~ ^[0-9a-f]{64}$ ]] || fail 'Core installer returned an invalid bootstrap client token'
  client_token=""
  core_healthy || fail 'Core installer completed but Core is unhealthy'
  log "Core bootstrap admin token: $token"
}

resolve_version() {
  local json
  [ -n "$VERSION" ] && return
  json="$("$CURL" -fsSL "https://api.github.com/repos/$REPO/releases/latest")"
  VERSION="$(printf '%s' "$json" | tr ',' '\n' | grep '"tag_name"' | cut -d '"' -f4 | head -n1)"
  [ -n "$VERSION" ] || fail 'cannot resolve latest Console release'
  VERSION="$(normalize_version "$VERSION")"
}

download_release() {
  local machine base name checksums
  resolve_version
  machine="$(arch)"
  base="https://github.com/$REPO/releases/download/$VERSION"
  name="syrogo-console_${VERSION}_linux_${machine}.tar.gz"
  TMP_DIR="$(mktemp -d)"
  ARCHIVE="$TMP_DIR/$name"
  checksums="$TMP_DIR/checksums.txt"
  "$CURL" -fL --retry 5 -o "$ARCHIVE" "$base/$name"
  "$CURL" -fL --retry 5 -o "$checksums" "$base/syrogo-console_${VERSION}_checksums.txt"
  CHECKSUM_FILE="$checksums"
}

verify_archive() {
  local expected actual name
  [ -f "$ARCHIVE" ] || fail "archive not found: $ARCHIVE"
  [ -n "$CHECKSUM_FILE" ] || fail 'a checksum file is required for local archives'
  name="$(basename "$ARCHIVE")"
  expected="$(grep -E "[[:space:]](\\*|)$name$" "$CHECKSUM_FILE" | cut -d ' ' -f1 | head -n1)"
  [ -n "$expected" ] || fail "checksum entry missing for $name"
  actual="$(sha256sum "$ARCHIVE" | cut -d ' ' -f1)"
  [ "$actual" = "$expected" ] || fail 'archive checksum mismatch'
}

install_console() {
  local extract source template
  verify_archive
  [ -n "$TMP_DIR" ] || TMP_DIR="$(mktemp -d)"
  extract="$TMP_DIR/extract"; mkdir -p "$extract"
  tar -xzf "$ARCHIVE" -C "$extract"
  source="$(find "$extract" -type f -name syrogo-console -perm -u+x | head -n1)"
  [ -n "$source" ] || fail 'syrogo-console binary missing from archive'
  template="$(find "$extract" -type f -path '*/deploy/systemd/syrogo-console.service' | head -n1)"
  [ -n "$template" ] || fail 'systemd template missing from archive'
  resolve_listen
  $ID "$SERVICE_USER" >/dev/null 2>&1 || $USERADD --system --home-dir "$INSTALL_ROOT" --shell /usr/sbin/nologin "$SERVICE_USER"
  install -d -m 0755 "$INSTALL_ROOT/bin" "$INSTALL_ROOT/dist" "$SYSTEMD_DIR"
  install -m 0755 "$source" "$INSTALL_ROOT/bin/syrogo-console"
  rm -rf "$INSTALL_ROOT/dist"; mkdir -p "$INSTALL_ROOT/dist"
  cp -a "$(dirname "$source")/dist/." "$INSTALL_ROOT/dist/"
  sed -e "s|__SERVICE_USER__|$SERVICE_USER|g" -e "s|__SERVICE_GROUP__|$SERVICE_GROUP|g" -e "s|__INSTALL_ROOT__|$INSTALL_ROOT|g" -e "s|__ENV_FILE__|$ENV_FILE|g" -e "s|__CORE_URL__|$CORE_URL|g" "$template" > "$UNIT_PATH"
  chown -R "$SERVICE_USER:$SERVICE_GROUP" "$INSTALL_ROOT"
  "$SYSTEMCTL" daemon-reload
  "$SYSTEMCTL" enable syrogo-console.service >/dev/null
  "$SYSTEMCTL" restart syrogo-console.service
  if [ "$SKIP_HEALTHCHECK" -eq 0 ]; then
    for _ in 1 2 3 4 5; do "$CURL" -fsS "http://$LISTEN/healthz" >/dev/null 2>&1 && return; $SLEEP 1; done
    fail 'Console health check failed'
  fi
}

uninstall_console() {
  "$SYSTEMCTL" stop syrogo-console.service >/dev/null 2>&1 || true
  "$SYSTEMCTL" disable syrogo-console.service >/dev/null 2>&1 || true
  rm -f "$UNIT_PATH" "$ENV_FILE"; rm -rf "$INSTALL_ROOT"
  "$SYSTEMCTL" daemon-reload
  log 'Console removed; Syrogo Core was not changed'
}

main() {
  parse_args "$@"; require_host
  [ "$MODE" != uninstall ] || { uninstall_console; return; }
  ensure_core
  [ -n "$ARCHIVE" ] || download_release
  install_console
  log "Console installed at $INSTALL_ROOT"
}
main "$@"
