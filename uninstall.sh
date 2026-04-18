#!/usr/bin/env bash
set -euo pipefail

UUIDS=(
    "power-quick-toggles@smiie.local"
    "power-toggles@smiie.local"
    "ultra-powersave@smiie.local"
)

for u in "${UUIDS[@]}"; do
    if gnome-extensions list --enabled 2>/dev/null | grep -qx "${u}"; then
        echo "Disabling ${u}"
        gnome-extensions disable "${u}" || true
    fi
done

for u in "${UUIDS[@]}"; do
    d="${HOME}/.local/share/gnome-shell/extensions/${u}"
    if [[ -d "${d}" ]]; then
        echo "Removing ${d}"
        rm -rf "${d}"
    fi
done

echo "Done. Restart GNOME Shell to fully drop the indicator:"
echo "  - Wayland: log out and back in"
echo "  - X11:     Alt+F2, 'r', Enter"
echo
echo "Note: the systemd units power-limit-{boost,default}.service are NOT"
echo "removed by this script. Remove them manually if you want a clean slate:"
echo "  sudo rm /etc/systemd/system/power-limit-{boost,default}.service"
echo "  sudo systemctl daemon-reload"
