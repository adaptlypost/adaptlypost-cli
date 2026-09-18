#!/bin/sh
set -eu

REPO="adaptlypost/adaptlypost-cli"
BIN="adaptlypost"
INSTALL_DIR="${ADAPTLYPOST_INSTALL_DIR:-$HOME/.local/bin}"

die() {
  printf '%s: %s\n' "$BIN installer" "$1" >&2
  exit 1
}

info() {
  printf '%s\n' "$1" >&2
}

have() {
  command -v "$1" >/dev/null 2>&1
}

fetch() {
  url="$1"
  out="$2"
  if have curl; then
    curl -fsSL --proto '=https' --tlsv1.2 -o "$out" "$url" || return 1
  elif have wget; then
    wget -qO "$out" "$url" || return 1
  else
    die "need curl or wget"
  fi
}

resolve_latest() {
  if have curl; then
    effective=$(curl -fsSLI -o /dev/null -w '%{url_effective}' \
      "https://github.com/$REPO/releases/latest") || return 1
  elif have wget; then
    effective=$(wget -qS --max-redirect=10 --spider \
      "https://github.com/$REPO/releases/latest" 2>&1 |
      awk '/^  Location: /{print $2}' | tail -n 1) || return 1
  else
    die "need curl or wget"
  fi
  case "$effective" in
    */tag/v*) printf '%s\n' "${effective##*/tag/v}" ;;
    *) return 1 ;;
  esac
}

sha256_of() {
  if have sha256sum; then
    sha256sum "$1" | cut -d' ' -f1
  elif have shasum; then
    shasum -a 256 "$1" | cut -d' ' -f1
  elif have openssl; then
    openssl dgst -sha256 "$1" | awk '{print $NF}'
  else
    die "need sha256sum, shasum or openssl to verify the download"
  fi
}

detect_target() {
  os=$(uname -s)
  arch=$(uname -m)
  case "$os" in
    Darwin)
      case "$arch" in
        arm64 | aarch64) printf 'darwin_arm64\n' ;;
        x86_64) printf 'darwin_x64\n' ;;
        *) die "unsupported macOS architecture: $arch" ;;
      esac
      ;;
    Linux)
      libc=gnu
      if [ -e /lib/ld-musl-x86_64.so.1 ] || [ -e /lib/ld-musl-aarch64.so.1 ]; then
        libc=musl
      elif have ldd && ldd --version 2>&1 | grep -qi musl; then
        libc=musl
      fi
      case "$arch" in
        x86_64 | amd64)
          if [ "$libc" = musl ]; then
            printf 'linux_x64_musl\n'
          else
            printf 'linux_x64\n'
          fi
          ;;
        arm64 | aarch64)
          if [ "$libc" = musl ]; then
            die "no musl arm64 binary is published. Install with: npm i -g @adaptlypost/cli"
          fi
          printf 'linux_arm64\n'
          ;;
        *) die "unsupported Linux architecture: $arch" ;;
      esac
      ;;
    *)
      die "unsupported operating system: $os. On Windows use: npm i -g @adaptlypost/cli"
      ;;
  esac
}

TARGET=$(detect_target)

VERSION="${ADAPTLYPOST_VERSION:-}"
if [ -z "$VERSION" ]; then
  VERSION=$(resolve_latest) || die "could not resolve the latest release of $REPO"
fi
VERSION="${VERSION#v}"

ASSET="${BIN}_${VERSION}_${TARGET}.tar.gz"
BASE="https://github.com/$REPO/releases/download/v${VERSION}"

have tar || die "need tar"

TMP=$(mktemp -d "${TMPDIR:-/tmp}/${BIN}-install.XXXXXX") || die "could not create a temp directory"
trap 'rm -rf "$TMP"' EXIT INT TERM

info "Downloading $ASSET"
fetch "$BASE/$ASSET" "$TMP/$ASSET" || die "download failed: $BASE/$ASSET"
fetch "$BASE/checksums.txt" "$TMP/checksums.txt" || die "download failed: $BASE/checksums.txt"

EXPECTED=$(awk -v name="$ASSET" '$2 == name || $2 == "*" name {print $1; exit}' "$TMP/checksums.txt")
[ -n "$EXPECTED" ] || die "$ASSET is not listed in checksums.txt"

ACTUAL=$(sha256_of "$TMP/$ASSET")
[ "$ACTUAL" = "$EXPECTED" ] || die "checksum mismatch for $ASSET: expected $EXPECTED, got $ACTUAL"
info "Checksum verified"

tar -xzf "$TMP/$ASSET" -C "$TMP" || die "could not extract $ASSET"
[ -f "$TMP/$BIN" ] || die "$ASSET did not contain a $BIN executable"

mkdir -p "$INSTALL_DIR" || die "could not create $INSTALL_DIR"
[ -w "$INSTALL_DIR" ] || die "$INSTALL_DIR is not writable. Set ADAPTLYPOST_INSTALL_DIR to a directory you own, or rerun with sudo to install into /usr/local/bin"

chmod 755 "$TMP/$BIN"
mv -f "$TMP/$BIN" "$INSTALL_DIR/$BIN" || die "could not install into $INSTALL_DIR"

printf '\n%s %s installed to %s\n' "$BIN" "$VERSION" "$INSTALL_DIR/$BIN" >&2

case ":${PATH}:" in
  *":$INSTALL_DIR:"*)
    printf 'Run: %s --help\n' "$BIN" >&2
    ;;
  *)
    printf '\n%s is not on your PATH. Add this line to your shell profile:\n\n    export PATH="%s:$PATH"\n\nThen run: %s --help\n' \
      "$INSTALL_DIR" "$INSTALL_DIR" "$BIN" >&2
    ;;
esac
