#!/usr/bin/env bash
set -euo pipefail

UUID="power-quick-toggles@smiie.local"
OLD_UUIDS=(
    "ultra-powersave@smiie.local"
    "power-toggles@smiie.local"
)

SRC_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DEST_DIR="${HOME}/.local/share/gnome-shell/extensions/${UUID}"

# ---- preflight --------------------------------------------------------------
# Hard failures: the extension cannot function without these.
command -v gnome-shell >/dev/null || {
    echo "ERROR: gnome-shell not found. This is a GNOME Shell extension." >&2
    exit 1
}
command -v systemctl >/dev/null || {
    echo "ERROR: systemctl not found. This extension drives systemd units." >&2
    exit 1
}

unit_installed() {
    systemctl list-unit-files --no-legend "$1" 2>/dev/null | grep -qF "$1"
}

missing_units=()
for unit in power-limit-boost.service power-limit-default.service; do
    unit_installed "$unit" || missing_units+=("$unit")
done
if (( ${#missing_units[@]} )); then
    echo "ERROR: Required systemd units are not installed:" >&2
    for u in "${missing_units[@]}"; do echo "  - $u" >&2; done
    echo "See README.md -> 'GPU Boost: system-side setup'." >&2
    exit 1
fi

# Soft warnings: the Ultra PowerSaving toggle will fail without tuned, but the
# GPU Boost toggle still works, so don't abort.
if ! unit_installed tuned.service; then
    echo "WARN: tuned.service not installed — the Ultra PowerSaving toggle will not work." >&2
fi
if ! systemctl --quiet is-active tuned.service 2>/dev/null; then
    echo "WARN: tuned.service is not active — the Ultra PowerSaving toggle will not work until it is." >&2
fi

# ---- migrate old UUIDs ------------------------------------------------------
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

# ---- install ----------------------------------------------------------------
echo "Installing ${UUID} to ${DEST_DIR}"
mkdir -p "${DEST_DIR}/toggles"

for f in metadata.json extension.js; do
    install -m 0644 "${SRC_DIR}/${f}" "${DEST_DIR}/${f}"
done

for f in "${SRC_DIR}"/toggles/*.js; do
    install -m 0644 "${f}" "${DEST_DIR}/toggles/$(basename "${f}")"
done

if [[ -f "${SRC_DIR}/stylesheet.css" ]]; then
    install -m 0644 "${SRC_DIR}/stylesheet.css" "${DEST_DIR}/stylesheet.css"
fi

POLKIT_SRC="${SRC_DIR}/polkit/50-power-quick-toggles.rules"
POLKIT_DEST="/etc/polkit-1/rules.d/50-power-quick-toggles.rules"
if [[ -f "${POLKIT_SRC}" ]]; then
    echo "Installing polkit rule to ${POLKIT_DEST} (requires sudo)"
    sudo install -m 0644 "${POLKIT_SRC}" "${POLKIT_DEST}"
fi

echo "Done. Next steps:"
echo "  1. Enable:  gnome-extensions enable ${UUID}"
echo "  2. Restart GNOME Shell:"
echo "       - Wayland: log out and back in"
echo "       - X11:     press Alt+F2, type 'r', press Enter"
