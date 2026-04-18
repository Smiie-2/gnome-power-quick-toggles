#!/usr/bin/env bash
set -euo pipefail

UUID="ultra-powersave@smiie.local"
SRC_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DEST_DIR="${HOME}/.local/share/gnome-shell/extensions/${UUID}"

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
