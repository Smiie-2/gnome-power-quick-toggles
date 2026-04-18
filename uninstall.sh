#!/usr/bin/env bash
set -euo pipefail

UUID="ultra-powersave@smiie.local"
DEST_DIR="${HOME}/.local/share/gnome-shell/extensions/${UUID}"

if gnome-extensions list --enabled 2>/dev/null | grep -qx "${UUID}"; then
    echo "Disabling ${UUID}"
    gnome-extensions disable "${UUID}" || true
fi

if [[ -d "${DEST_DIR}" ]]; then
    echo "Removing ${DEST_DIR}"
    rm -rf "${DEST_DIR}"
else
    echo "Not installed at ${DEST_DIR}, nothing to remove."
fi

echo "Done. Restart GNOME Shell to fully drop the indicator:"
echo "  - Wayland: log out and back in"
echo "  - X11:     Alt+F2, 'r', Enter"
