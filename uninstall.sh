#!/usr/bin/env bash
set -euo pipefail

UUID="power-toggles@smiie.local"
OLD_UUID="ultra-powersave@smiie.local"
DEST_DIR="${HOME}/.local/share/gnome-shell/extensions/${UUID}"
OLD_DEST_DIR="${HOME}/.local/share/gnome-shell/extensions/${OLD_UUID}"

for u in "${UUID}" "${OLD_UUID}"; do
    if gnome-extensions list --enabled 2>/dev/null | grep -qx "${u}"; then
        echo "Disabling ${u}"
        gnome-extensions disable "${u}" || true
    fi
done

for d in "${DEST_DIR}" "${OLD_DEST_DIR}"; do
    if [[ -d "${d}" ]]; then
        echo "Removing ${d}"
        rm -rf "${d}"
    fi
done

echo "Done. Restart GNOME Shell to fully drop the indicator:"
echo "  - Wayland: log out and back in"
echo "  - X11:     Alt+F2, 'r', Enter"
echo
echo "Note: the systemd units hs-power-limit-{boost,default}.service are NOT"
echo "removed by this script. Remove them manually if you want a clean slate:"
echo "  sudo rm /etc/systemd/system/hs-power-limit-{boost,default}.service"
echo "  sudo systemctl daemon-reload"
