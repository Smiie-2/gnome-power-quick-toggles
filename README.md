# Power Quick Toggles

A tiny GNOME Shell extension that adds two Quick Settings toggles for
ThinkPad power tuning:

| Toggle              | ON effect                                                                                                  | OFF effect                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **Ultra PowerSaving** | Forces `tuned` to `laptop-battery-powersave` — a fourth, extra-aggressive rung below GNOME's power-saver. | Restarts `tuned-ppd.service` so PPD's slider-to-tuned mapping resumes. |
| **GPU Boost**         | Raises Intel MMIO RAPL PL1/PL2 from the 20W/43W OEM defaults to 55W/55W via `power-limit-boost.service`. | Restores the OEM limits via `power-limit-default.service`.         |

Target: GNOME Shell 49 on PikaOS (Intel Meteor Lake, `tuned` + `tuned-ppd`).

---

## Ultra PowerSaving

### What it does

- **ON**: calls `com.redhat.tuned.control.switch_profile("laptop-battery-powersave")`
  over the system D-Bus. This bypasses `tuned-ppd` and forces tuned to the
  most aggressive battery-powersave profile regardless of AC state or
  GNOME's slider position.
- **OFF**: asks `systemd` (via `org.freedesktop.systemd1.Manager.RestartUnit`)
  to restart `tuned-ppd.service`. Restarting it re-reads the current GNOME
  PPD slider + AC/battery state and pushes the appropriate profile back
  into `tuned`. This is the clean revert.
- Subscribes to tuned's `profile_changed` signal so the toggle stays in sync
  if you change profiles from a terminal (e.g. `tuned-adm profile …`) or
  via the GNOME slider.
- Reads `active_profile()` on enable to initialize the toggle state.

### Why restart tuned-ppd for the revert?

Three options were considered:

1. **Restart `tuned-ppd.service`** — cleanest: tuned-ppd's own logic decides
   the right profile. Works without a polkit prompt because
   `org.freedesktop.systemd1.Manager.RestartUnit` accepts calls from the
   active user session on this system (verified with `busctl` as `smiie`).
   **Chosen.**
2. Parse `/etc/tuned/ppd.conf` ourselves, read battery state + the current
   PPD slider, compute the mapping, and call `switch_profile` directly.
   Brittle: duplicates tuned-ppd logic, breaks if the config changes.
3. Set PPD's `ActiveProfile` property via D-Bus. **Not available** on this
   build — `net.hadess.PowerProfiles` exposes only `HoldProfile` /
   `ReleaseProfile`, no settable profile property.

---

## GPU Boost

### What it does

Raises the Intel **MMIO** RAPL limit. On Meteor Lake, two RAPL interfaces
are exposed and firmware enforces `intel-rapl-mmio:0`, not the MSR-based
`intel-rapl:0` — so writing to the latter has no effect. OEM defaults on
this chassis are **PL1 = 20W, PL2 = 43W** (long/short term), which starves
the iGPU the moment any CPU load kicks in. Symptoms: `throttle_reason_pl1`
reads `1` on `/sys/class/drm/card1/gt/gt0/`, and the iGPU clock drops
**below** its configured `gt_min_freq_mhz`.

The fix is just `echo 55000000 > .../constraint_0_power_limit_uw` (and the
same for `constraint_1_power_limit_uw`). Firmware on this ThinkPad accepts
the raised value without clamping it back. At 55W the iGPU clocks
~1050 MHz instead of 450 MHz — peak package temp ~77 °C with fans at max,
well inside PROCHOT and VR-protection limits, which are firmware-enforced
and independent of RAPL.

### Toggle behavior

- **ON**: `StartUnit("power-limit-boost.service", "replace")` over D-Bus
  writes 55W to both PL1 and PL2.
- **OFF**: `StartUnit("power-limit-default.service", "replace")` writes
  20W/43W.
- State is read back from `/sys/class/powercap/intel-rapl-mmio:0/constraint_0_power_limit_uw`
  (world-readable sysfs) on enable and after every click, so the toggle
  always reflects the actual hardware state — if you raise the limit from
  a terminal or another session, the toggle updates on next extension load.

### Why not a single service that reads the power profile?

An earlier iteration bound PL1 to `/sys/firmware/acpi/platform_profile`:
`performance` → 55W, else 20W. That couples two orthogonal things — you
might want *balanced* CPU scheduling **and** a lifted GPU ceiling (e.g.
for a game that is GPU-bound but doesn't want maxed CPU clocks). A
standalone Quick Settings toggle lets those two knobs move independently.

### GPU Boost: system-side setup

The extension only calls D-Bus; the actual sysfs writes are done by two
tiny one-shot systemd units shipped in `systemd/`. Install once:

```bash
sudo install -m 0644 systemd/power-limit-boost.service \
    /etc/systemd/system/power-limit-boost.service
sudo install -m 0644 systemd/power-limit-default.service \
    /etc/systemd/system/power-limit-default.service
sudo systemctl daemon-reload
```

Smoke test (should succeed without a polkit prompt):

```bash
sudo systemctl start power-limit-boost.service
cat /sys/class/powercap/intel-rapl-mmio:0/constraint_0_power_limit_uw
# expect: 55000000

sudo systemctl start power-limit-default.service
cat /sys/class/powercap/intel-rapl-mmio:0/constraint_0_power_limit_uw
# expect: 20000000
```

Then verify the unprompted D-Bus path the extension actually uses:

```bash
busctl --system call org.freedesktop.systemd1 /org/freedesktop/systemd1 \
    org.freedesktop.systemd1.Manager StartUnit ss \
    power-limit-boost.service replace
```

If that call prompts for authentication, install the polkit fallback rule:

```bash
sudo install -m 0644 polkit/50-power-quick-toggles.rules \
    /etc/polkit-1/rules.d/50-power-quick-toggles.rules
```

---

## Install the extension

```bash
./install.sh
gnome-extensions enable power-quick-toggles@smiie.local
```

Then restart GNOME Shell:

- **Wayland**: log out and back in.
- **X11**: press `Alt+F2`, type `r`, press `Enter`.

`install.sh` also removes predecessor installs (`ultra-powersave@smiie.local`
and `power-toggles@smiie.local`) if they are still present, so upgrading
is one command.

## Uninstall

```bash
./uninstall.sh
```

This removes the GNOME extension only. The `power-limit-*` systemd units
are left in place — remove them manually if you want a clean slate.

## Troubleshooting

Watch shell logs live:

```bash
journalctl -f -o cat /usr/bin/gnome-shell
```

Check tuned's current profile:

```bash
busctl --system call com.redhat.tuned /Tuned com.redhat.tuned.control active_profile
```

Manually exercise the Ultra PowerSaving revert path:

```bash
busctl --system call org.freedesktop.systemd1 /org/freedesktop/systemd1 \
    org.freedesktop.systemd1.Manager RestartUnit ss tuned-ppd.service replace
```

Read current GPU Boost state:

```bash
cat /sys/class/powercap/intel-rapl-mmio:0/constraint_0_power_limit_uw
# 20000000 = OEM default, 55000000 = boost active
```

Live readout of both toggles (no GNOME, just sysfs + tuned):

```bash
./scripts/watch-toggles.sh
```

Check active iGPU throttle reasons (useful when GPU Boost doesn't seem
to help):

```bash
for f in /sys/class/drm/card*/gt/gt*/throttle_reason_*; do
    v=$(cat "$f")
    [ "$v" = "1" ] && echo "ACTIVE: $f"
done
```

## Discoveries during build

- `com.redhat.tuned.control.switch_profile` is polkit-gated with
  `auth_admin` in `/usr/share/polkit-1/actions/com.redhat.tuned.policy`,
  yet it succeeds silently from an unprivileged `busctl` call — there is
  an overriding rule somewhere that allows the active session. The
  extension assumes this continues to hold; if it stops working, check
  polkit rules or the `tuned` package's defaults.
- `tuned-ppd.service` runs as `Type=dbus` with
  `BusName=org.freedesktop.UPower.PowerProfiles` / `net.hadess.PowerProfiles`
  and a `Requires=tuned.service` — restarting it does not kill tuned itself.
- Meteor Lake exposes two RAPL interfaces: `intel-rapl:0` (MSR, what the
  OS requests) and `intel-rapl-mmio:0` (MMIO, what firmware enforces).
  Effective limit = `min(MSR, MMIO)`. Raising only MSR has no effect.
  Diagnostic: `/sys/class/drm/card1/gt/gt0/throttle_reason_pl1` reads `1`
  under iGPU power starvation, while `throttle_reason_thermal` stays `0`.
- Intel firmware on this chassis accepts user-raised MMIO limits without
  clamping them back. PROCHOT (silicon ~100 °C) and VR protections
  (`throttle_reason_vr_tdc`, `vr_thermalert`) are independent of RAPL and
  always active, so raising the MMIO limit doesn't remove any safety net.

## Files

- `metadata.json` — extension manifest (shell-version `49`, ESM).
- `extension.js` — thin entry point: the `Extension` subclass and the
  `SystemIndicator` that hosts both toggles.
- `toggles/common.js` — shared tuned + systemd D-Bus constants.
- `toggles/ultraPowerSave.js` — `UltraPowerSaveToggle` (tuned profile
  switch, `profile_changed` subscription, `tuned-ppd` restart on revert).
- `toggles/gpuBoost.js` — `GpuBoostToggle` (starts the boost/default
  systemd units, reads MMIO RAPL sysfs for state).
- `install.sh` / `uninstall.sh` — idempotent bash helpers. `install.sh`
  preflights `systemctl` and the `power-limit-*.service` units, warns if
  `tuned.service` is missing or inactive, and migrates away from
  predecessor UUIDs (`ultra-powersave@smiie.local`,
  `power-toggles@smiie.local`).
- `systemd/power-limit-{boost,default}.service` — one-shot units that
  perform the actual sysfs writes for GPU Boost.
- `polkit/50-power-quick-toggles.rules` — optional fallback rule if a
  future update makes `manage-units` prompt for auth.
- `scripts/watch-toggles.sh` — live TTY readout of both toggle states
  from the same sysfs + D-Bus sources the extension uses. Handy when
  debugging why a toggle disagrees with reality.

## History

This project started as **ultra-powersave@smiie.local** — a single toggle
for the `laptop-battery-powersave` tuned profile. When the GPU Boost
toggle was added it was briefly renamed to **power-toggles@smiie.local**,
then finalized as **power-quick-toggles@smiie.local** for clarity about
what it is: a collection of Quick Settings toggles for power-related
knobs. The systemd backing units were also renamed from `hs-power-limit-*`
(legacy prefix from an earlier Hearthstone-on-Linux debugging session) to
`power-limit-*`. `install.sh` handles extension-side migration
automatically; see the README section above for the one-time system-side
cleanup when upgrading from a pre-rename install.
