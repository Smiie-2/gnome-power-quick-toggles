# Ultra PowerSaving

A tiny GNOME Shell extension that adds a Quick Settings toggle called
**"Ultra PowerSaving"** — a fourth, extra-aggressive power rung below
GNOME's built-in power-saver slider.

Target: GNOME Shell 49 on PikaOS (Intel Meteor Lake, `tuned` + `tuned-ppd`).

## What it does

- **ON**: calls `com.redhat.tuned.control.switch_profile("laptop-battery-powersave")`
  over the system D-Bus. This bypasses `tuned-ppd` and forces tuned to
  the most aggressive battery-powersave profile regardless of AC state
  or GNOME's slider position.
- **OFF**: asks `systemd` (via `org.freedesktop.systemd1.Manager.RestartUnit`)
  to restart `tuned-ppd.service`. Restarting it re-reads the current
  GNOME PPD slider + AC/battery state and pushes the appropriate profile
  back into `tuned`. This is the clean revert.
- Subscribes to tuned's `profile_changed` signal so the toggle stays in
  sync if you change profiles from a terminal (e.g. `tuned-adm profile …`)
  or via the GNOME slider.
- Reads `active_profile()` on enable to initialize the toggle state.

## Why restart tuned-ppd for the revert?

Three options were considered:

1. **Restart `tuned-ppd.service`** — cleanest: tuned-ppd's own logic
   decides the right profile. Works without a polkit prompt because
   `org.freedesktop.systemd1.Manager.RestartUnit` accepts calls from the
   active user session on this system (verified with `busctl` as
   `smiie`). **Chosen.**
2. Parse `/etc/tuned/ppd.conf` ourselves, read battery state + the
   current PPD slider, compute the mapping, and call `switch_profile`
   directly. Brittle: duplicates tuned-ppd logic, breaks if the config
   changes.
3. Set PPD's `ActiveProfile` property via D-Bus. **Not available** on
   this build — `net.hadess.PowerProfiles` exposes only `HoldProfile`
   / `ReleaseProfile`, no settable profile property.

If a future kernel/distro update makes `RestartUnit` prompt for auth,
the extension will surface a notification and flip the toggle back on.

## Discoveries during build

- `com.redhat.tuned.control.switch_profile` is polkit-gated with
  `auth_admin` in `/usr/share/polkit-1/actions/com.redhat.tuned.policy`,
  yet it succeeds silently from an unprivileged `busctl` call — there
  is an overriding rule somewhere that allows the active session. The
  extension assumes this continues to hold; if it stops working, check
  polkit rules or the `tuned` package's defaults.
- `tuned-ppd.service` runs as `Type=dbus` with
  `BusName=org.freedesktop.UPower.PowerProfiles` / `net.hadess.PowerProfiles`
  and a `Requires=tuned.service` — restarting it does not kill tuned itself.

## Install

```bash
./install.sh
gnome-extensions enable ultra-powersave@smiie.local
```

Then restart GNOME Shell:

- **Wayland**: log out and back in.
- **X11**: press `Alt+F2`, type `r`, press `Enter`.

## Uninstall

```bash
./uninstall.sh
```

## Troubleshooting

Watch shell logs live:

```bash
journalctl -f -o cat /usr/bin/gnome-shell
```

Check tuned's current profile:

```bash
busctl --system call com.redhat.tuned /Tuned com.redhat.tuned.control active_profile
```

Manually exercise the revert path:

```bash
busctl --system call org.freedesktop.systemd1 /org/freedesktop/systemd1 \
    org.freedesktop.systemd1.Manager RestartUnit ss tuned-ppd.service replace
```

## Files

- `metadata.json` — extension manifest (shell-version `49`, ESM).
- `extension.js` — the whole extension; uses `QuickToggle` and
  `SystemIndicator` from `resource:///org/gnome/shell/ui/quickSettings.js`.
- `install.sh` / `uninstall.sh` — idempotent bash helpers.
