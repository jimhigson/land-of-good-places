#!/usr/bin/env bash
# Installs Chromium for playwright-core and its system packages. See action.yml
# for why; issue #737 for what went wrong without it.
#
# Cache hit:  dpkg -i the cached .debs; the browser is already on disk.
# Cache miss: playwright-core install-deps + install, each attempt under its own
#             clock, one retry, and apt told to give up on a stalled mirror
#             rather than wait on it. The .debs apt fetched are kept for the
#             cache.
set -euo pipefail

debs="$HOME/.cache/chromium-debs"

# Per attempt. A healthy miss measures ~20 s for both installs together, so
# this is several times the real duration and still far inside the calling
# step's `timeout-minutes`, which bounds the four attempts in total.
ATTEMPT_SECONDS="${CHROMIUM_ATTEMPT_SECONDS:-90}"

# Runs "$@" under the attempt clock, and once more if that fails or times out.
#
# `--root` runs the clock itself as root. That is load-bearing for apt: measured
# on a stalled mirror, a clock running as `runner` killed playwright-core but
# not the root apt-get it had started under sudo, so the retry died at once on
# "Unable to lock directory /var/lib/apt/lists/" with the first apt still
# hanging. GNU timeout signals its whole process group, and as root that signal
# reaches apt-get and its download workers.
with_retry() {
  local clock=(timeout --kill-after=10 "$ATTEMPT_SECONDS")
  if [ "$1" = "--root" ]; then
    clock=(sudo "${clock[@]}")
    shift
  fi
  local what="$1"
  shift
  for attempt in 1 2; do
    local started=$SECONDS status=0
    "${clock[@]}" "$@" || status=$?
    if [ "$status" -eq 0 ]; then
      echo "$what: attempt $attempt succeeded in $((SECONDS - started)) s"
      return 0
    fi
    if [ "$status" -eq 124 ] || [ "$status" -eq 137 ]; then
      echo "::warning::$what: attempt $attempt timed out after ${ATTEMPT_SECONDS} s"
    else
      echo "::warning::$what: attempt $attempt failed with exit $status after $((SECONDS - started)) s"
    fi
    # A killed apt can leave dpkg half-configured, which would fail the retry
    # for a reason that has nothing to do with the mirror.
    sudo dpkg --configure -a || true
  done
  echo "::error::$what failed twice (each attempt capped at ${ATTEMPT_SECONDS} s) — see #737"
  return 1
}

if [ "${CHROMIUM_CACHE_HIT:-}" = "true" ]; then
  echo "cache hit: installing system packages from $debs, no apt"
  shopt -s nullglob
  packages=("$debs"/*.deb)
  if [ "${#packages[@]}" -gt 0 ]; then
    sudo dpkg -i "${packages[@]}" > /dev/null
    echo "installed ${#packages[@]} cached packages"
  else
    echo "no cached packages: this image needed none"
  fi
  # A no-op when the cached browser is intact; downloads it if not.
  with_retry "browser install" pnpm exec playwright-core install chromium
  exit 0
fi

echo "cache miss: installing through apt"

# A stalled mirror is a connection that stops sending, and apt's default is to
# wait on it far longer than the attempt clock. Fail the fetch instead, so apt's
# own retries and then ours get a go. Keep what it downloads for the cache.
sudo tee /etc/apt/apt.conf.d/99-chromium-ci > /dev/null << 'EOF'
Acquire::http::Timeout "20";
Acquire::https::Timeout "20";
Acquire::Retries "2";
APT::Keep-Downloaded-Packages "true";
Binary::apt::APT::Keep-Downloaded-Packages "true";
EOF

# Start from an empty archive so what is left afterwards is exactly what this
# install fetched.
sudo apt-get clean

# As root, by absolute path: sudo resets PATH, and playwright-core then runs
# apt-get directly rather than through a sudo of its own.
with_retry --root "system packages" "$(command -v node)" node_modules/playwright-core/cli.js install-deps chromium
with_retry "browser install" pnpm exec playwright-core install chromium

mkdir -p "$debs"
shopt -s nullglob
fetched=(/var/cache/apt/archives/*.deb)
if [ "${#fetched[@]}" -gt 0 ]; then
  cp "${fetched[@]}" "$debs/"
fi
echo "kept ${#fetched[@]} packages for the cache"
