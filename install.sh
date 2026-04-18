#!/usr/bin/env bash
set -euo pipefail

UUID="power-toggles@smiie.local"
OLD_UUID="ultra-powersave@smiie.local"
SRC_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DEST_DIR="${HOME}/.local/share/gnome-shell/extensions/${UUID}"
OLD_DEST_DIR="${HOME}/.local/share/gnome-shell/extensions/${OLD_UUID}"

# One-time migration: remove the old ultra-powersave@smiie.local install if
# it's still there. This extension supersedes it under a broader name.
if [[ -d "${OLD_DEST_DIR}" ]]; then
    echo "Migrating away from ${OLD_UUID}"
    if gnome-extensions list --enabled 2>/dev/null | grep -qx "${OLD_UUID}"; then
        gnome-extensions disable "${OLD_UUID}" || true
    fi
    rm -rf "${OLD_DEST_DIR}"
fi

echo "Installing ${UUID} to ${DEST_DIR}"
mkdir -p "${DEST_DIR}"

# Copy only the files that belong to the extension
for f in metadata.json extension.js; do
    if [[ -f "${SRC_DIR}/${f}" ]]; then
        install -m 0644 "${SRC_DIR}/${f}" "${DEST_DIR}/${f}"
    fi
done

if [[ -f "${SRC_DIR}/stylesheet.css" ]]; then
    install -m 0644 "${SRC_DIR}/stylesheet.css" "${DEST_DIR}/stylesheet.css"
fi

echo "Done. Next steps:"
echo "  1. Enable:  gnome-extensions enable ${UUID}"
echo "  2. Restart GNOME Shell:"
echo "       - Wayland: log out and back in"
echo "       - X11:     press Alt+F2, type 'r', press Enter"
echo
echo "  Make sure the GPU Boost helper units are installed:"
echo "    systemctl status hs-power-limit-boost.service"
echo "    systemctl status hs-power-limit-default.service"
echo "  (see README.md -> 'GPU Boost: system-side setup')"
