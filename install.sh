#!/usr/bin/env bash
set -euo pipefail

UUID="power-quick-toggles@smiie.local"
# Predecessor UUIDs; install.sh auto-removes them during migration.
OLD_UUIDS=(
    "ultra-powersave@smiie.local"
    "power-toggles@smiie.local"
)

SRC_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DEST_DIR="${HOME}/.local/share/gnome-shell/extensions/${UUID}"

for OLD in "${OLD_UUIDS[@]}"; do
    OLD_DIR="${HOME}/.local/share/gnome-shell/extensions/${OLD}"
    if [[ -d "${OLD_DIR}" ]]; then
        echo "Migrating away from ${OLD}"
        if gnome-extensions list --enabled 2>/dev/null | grep -qx "${OLD}"; then
            gnome-extensions disable "${OLD}" || true
        fi
        rm -rf "${OLD_DIR}"
    fi
done

echo "Installing ${UUID} to ${DEST_DIR}"
mkdir -p "${DEST_DIR}"

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
echo "    systemctl status power-limit-boost.service"
echo "    systemctl status power-limit-default.service"
echo "  (see README.md -> 'GPU Boost: system-side setup')"
