#!/usr/bin/env bash
# Install the linux x86_64 workflow scanners that CI runs. Each archive is
# checked against the SHA-256 digest its upstream GitHub release publishes
# before it is unpacked. To bump a tool, change its URL and digest together,
# and take the digest from the release's asset metadata, never from a file
# you downloaded.
set -euo pipefail

destination="${1:?usage: install-pinned-tools.sh <destination>}"
mkdir -p "$destination"

install_one() {
  local url="$1" checksum="$2" binary="$3"
  local archive="${destination}/${binary}.tar.gz"
  curl --fail --silent --show-error --location --output "$archive" "$url"
  printf '%s  %s\n' "$checksum" "$archive" | sha256sum --check --status
  tar --extract --gzip --file "$archive" --directory "$destination" "$binary"
  chmod +x "${destination}/${binary}"
  rm -f "$archive"
}

install_one \
  "https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_linux_amd64.tar.gz" \
  "8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8" \
  actionlint

install_one \
  "https://github.com/zizmorcore/zizmor/releases/download/v1.30.1/zizmor-x86_64-unknown-linux-gnu.tar.gz" \
  "e65324f4430c2717591937edcec90ccbefaf14c174f8ec9415e03ca875b46e1a" \
  zizmor
