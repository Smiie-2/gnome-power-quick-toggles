# gnome-power-quick-toggles

GNOME Shell 49 extension that adds two Quick Settings toggles for ThinkPad
power tuning. UUID: `power-quick-toggles@smiie.local`.

## Toggles

- **Ultra PowerSaving** — calls `tuned`'s `switch_profile("laptop-battery-powersave")`
  on the system bus to drop below GNOME's built-in power-saver rung. Disabling
  it restarts `tuned-ppd.service` so tuned returns to its auto-selected profile.
- **GPU Boost** — starts `power-limit-boost.service` (PL1/PL2 → 55W/55W) or
  `power-limit-default.service` (back to OEM 20W/43W on this ThinkPad). State
  is read from Intel MMIO RAPL sysfs, not cached.

## Non-obvious things to know

- **`switch_profile` reply signature is `((bs))`, not `(bs)`.** tuned wraps
  the (ok, msg) struct in the outer reply tuple. Using `(bs)` makes GJS
  reject the reply and the toggle errors. Unpack as `[[ok, msg]]`.
- **The polkit rule is required, not optional.** The extension calls D-Bus
  with `DBusCallFlags.NONE` (no interactive auth). Without
  `/etc/polkit-1/rules.d/50-power-quick-toggles.rules`, every call fails with
  `org.freedesktop.DBus.Error.InteractiveAuthorizationRequired`. `install.sh`
  installs it via sudo.
- **GpuBoostToggle subscribes to tuned's `profile_changed` signal** and
  re-reads sysfs after a short delay. Reason: switching tuned profiles
  (e.g. enabling Ultra PowerSaving) rewrites PL1/PL2 behind our back, so
  without the subscription the boost toggle stays highlighted while the
  hardware is no longer boosted.
- **No optimistic UI.** Both toggles read sysfs / D-Bus to determine actual
  state rather than trusting that the click "worked." `_scheduleVerify(ms)`
  re-reads after a delay; longer delay (~750ms) for tuned profile changes,
  shorter (~250ms) for direct unit starts.

## Layout

- `extension.js` — the whole extension (single file, ES module).
- `metadata.json` — UUID, shell-version, GitHub URL.
- `polkit/50-power-quick-toggles.rules` — required polkit rule.
- `systemd/power-limit-{boost,default}.service` — units called by GPU Boost.
- `install.sh` / `uninstall.sh` — copy extension to
  `~/.local/share/gnome-shell/extensions/<UUID>/`, install/remove polkit rule.

## Reload after changes

GNOME Shell does not hot-reload extensions. After editing `extension.js`:

- **Wayland:** log out and back in.
- **X11:** Alt+F2, type `r`, Enter.

`./install.sh` only copies files; it does not reload the shell.

## Debugging

- Extension `log()` / `logError()` output:
  `journalctl /usr/bin/gnome-shell --since "5 min ago"` (or `--user`
  depending on session).
- D-Bus / polkit refusals:
  `journalctl --since "5 min ago" | grep -iE "tuned|polkit|power-limit"`.
- To verify a method by hand: `busctl --system call com.redhat.tuned
  /Tuned com.redhat.tuned.control switch_profile s laptop-battery-powersave`
  — note that `busctl` succeeds where the extension fails because it can
  prompt interactively. A working `busctl` does not mean the extension
  will work; only the polkit rule does.

## Constants

Hard-coded in `extension.js` — search by name to find them:

- `TUNED_NAME` / `TUNED_PATH` / `TUNED_IFACE` — `com.redhat.tuned` on the
  system bus, `/Tuned`, interface `com.redhat.tuned.control`.
- `ULTRA_PROFILE = "laptop-battery-powersave"` — must exist as a tuned
  profile on the system; this project does not ship it.
- `BOOST_UNIT` / `DEFAULT_UNIT` — names of the systemd units in `systemd/`.
