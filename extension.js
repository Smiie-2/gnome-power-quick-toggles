/* extension.js — Power Quick Toggles
 *
 * Adds two Quick Settings toggles:
 *
 *   1. "Ultra PowerSaving" — forces tuned to 'laptop-battery-powersave'
 *      (a fourth, extra-aggressive rung below GNOME's built-in slider).
 *      Reverts by restarting tuned-ppd.service so PPD's mapping resumes.
 *
 *   2. "GPU Boost" — raises Intel MMIO RAPL PL1/PL2 from the 20W/43W OEM
 *      defaults to 55W/55W by invoking power-limit-boost.service. Turns
 *      off by invoking power-limit-default.service. State is read back
 *      from /sys/class/powercap/intel-rapl-mmio:0/constraint_0_power_limit_uw
 *      so the toggle always reflects the actual hardware state.
 *
 * Both toggles rely on org.freedesktop.systemd1.Manager.{RestartUnit,StartUnit}
 * succeeding without a polkit prompt for the active session. On this system
 * that holds by default; if it ever stops working, install the polkit rule
 * shipped in the repo under polkit/.
 *
 * GNOME Shell 49, ESM module.
 */

import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {QuickToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// ----- tuned / Ultra PowerSaving ---------------------------------------------
const TUNED_NAME = 'com.redhat.tuned';
const TUNED_PATH = '/Tuned';
const TUNED_IFACE = 'com.redhat.tuned.control';
const ULTRA_PROFILE = 'laptop-battery-powersave';

// ----- systemd unit invocation ----------------------------------------------
const SYSTEMD_NAME = 'org.freedesktop.systemd1';
const SYSTEMD_PATH = '/org/freedesktop/systemd1';
const SYSTEMD_IFACE = 'org.freedesktop.systemd1.Manager';
const PPD_UNIT = 'tuned-ppd.service';
const BOOST_UNIT = 'power-limit-boost.service';
const DEFAULT_UNIT = 'power-limit-default.service';

// ----- GPU Boost / MMIO RAPL -------------------------------------------------
const MMIO_PL1 = '/sys/class/powercap/intel-rapl-mmio:0/constraint_0_power_limit_uw';
const BOOST_THRESHOLD_UW = 40_000_000; // above this -> boost is active (OEM default is 20M)

// =============================================================================
// Ultra PowerSaving toggle
// =============================================================================
const UltraPowerSaveToggle = GObject.registerClass(
class UltraPowerSaveToggle extends QuickToggle {
    _init() {
        super._init({
            title: 'Ultra PowerSaving',
            iconName: 'power-profile-power-saver-symbolic',
            toggleMode: true,
        });

        this._bus = Gio.DBus.system;
        this._signalId = 0;

        this._signalId = this._bus.signal_subscribe(
            TUNED_NAME, TUNED_IFACE, 'profile_changed', TUNED_PATH, null,
            Gio.DBusSignalFlags.NONE,
            (conn, sender, path, iface, signal, params) => {
                try {
                    const [newProfile] = params.deep_unpack();
                    this._setCheckedSilently(newProfile === ULTRA_PROFILE);
                } catch (e) {
                    logError(e, '[power-quick-toggles/ups] profile_changed parse error');
                }
            }
        );

        this.connect('clicked', () => {
            if (this.checked) this._enableUltra();
            else this._revertToPPD();
        });

        this._readActiveProfile();
    }

    _setCheckedSilently(value) {
        if (this.checked !== value) this.checked = value;
    }

    _readActiveProfile() {
        this._bus.call(
            TUNED_NAME, TUNED_PATH, TUNED_IFACE, 'active_profile',
            null, new GLib.VariantType('(s)'),
            Gio.DBusCallFlags.NONE, -1, null,
            (src, res) => {
                try {
                    const [profile] = this._bus.call_finish(res).deep_unpack();
                    this._setCheckedSilently(profile === ULTRA_PROFILE);
                } catch (e) {
                    logError(e, '[power-quick-toggles/ups] active_profile failed');
                }
            }
        );
    }

    _enableUltra() {
        this._bus.call(
            TUNED_NAME, TUNED_PATH, TUNED_IFACE, 'switch_profile',
            new GLib.Variant('(s)', [ULTRA_PROFILE]),
            new GLib.VariantType('(bs)'),
            Gio.DBusCallFlags.NONE, -1, null,
            (src, res) => {
                try {
                    const [ok, msg] = this._bus.call_finish(res).deep_unpack();
                    if (!ok) {
                        log(`[power-quick-toggles/ups] switch_profile refused: ${msg}`);
                        Main.notify('Ultra PowerSaving', `tuned refused: ${msg}`);
                        this._setCheckedSilently(false);
                    }
                } catch (e) {
                    logError(e, '[power-quick-toggles/ups] switch_profile failed');
                    Main.notify('Ultra PowerSaving', `D-Bus error: ${e.message}`);
                    this._setCheckedSilently(false);
                }
            }
        );
    }

    _revertToPPD() {
        this._bus.call(
            SYSTEMD_NAME, SYSTEMD_PATH, SYSTEMD_IFACE, 'RestartUnit',
            new GLib.Variant('(ss)', [PPD_UNIT, 'replace']),
            new GLib.VariantType('(o)'),
            Gio.DBusCallFlags.NONE, -1, null,
            (src, res) => {
                try {
                    this._bus.call_finish(res);
                } catch (e) {
                    logError(e, '[power-quick-toggles/ups] RestartUnit failed');
                    Main.notify('Ultra PowerSaving',
                        `Could not restart tuned-ppd: ${e.message}`);
                    this._setCheckedSilently(true);
                }
            }
        );
    }

    destroy() {
        if (this._signalId) {
            this._bus.signal_unsubscribe(this._signalId);
            this._signalId = 0;
        }
        super.destroy();
    }
});

// =============================================================================
// GPU Boost toggle
// =============================================================================
const GpuBoostToggle = GObject.registerClass(
class GpuBoostToggle extends QuickToggle {
    _init() {
        super._init({
            title: 'GPU Boost',
            iconName: 'power-profile-performance-symbolic',
            toggleMode: true,
        });

        this._bus = Gio.DBus.system;
        this._readCancellable = null;
        this._verifyTimeoutId = 0;

        this.connect('clicked', () => {
            const unit = this.checked ? BOOST_UNIT : DEFAULT_UNIT;
            this._startUnit(unit);
        });

        this._readState();
    }

    _setCheckedSilently(value) {
        if (this.checked !== value) this.checked = value;
    }

    _readState() {
        // PL1 sysfs is world-readable; parse the µW value and decide by threshold.
        if (this._readCancellable) this._readCancellable.cancel();
        this._readCancellable = new Gio.Cancellable();

        const file = Gio.File.new_for_path(MMIO_PL1);
        file.load_contents_async(this._readCancellable, (src, res) => {
            try {
                const [, bytes] = file.load_contents_finish(res);
                const text = new TextDecoder().decode(bytes).trim();
                const value = parseInt(text, 10);
                if (Number.isFinite(value))
                    this._setCheckedSilently(value > BOOST_THRESHOLD_UW);
            } catch (e) {
                if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    logError(e, '[power-quick-toggles/boost] read PL1 failed');
            }
        });
    }

    _startUnit(unit) {
        this._bus.call(
            SYSTEMD_NAME, SYSTEMD_PATH, SYSTEMD_IFACE, 'StartUnit',
            new GLib.Variant('(ss)', [unit, 'replace']),
            new GLib.VariantType('(o)'),
            Gio.DBusCallFlags.NONE, -1, null,
            (src, res) => {
                try {
                    this._bus.call_finish(res);
                    // Re-read after a short delay so the toggle reflects
                    // actual sysfs state rather than our optimistic assumption.
                    if (this._verifyTimeoutId)
                        GLib.source_remove(this._verifyTimeoutId);
                    this._verifyTimeoutId = GLib.timeout_add(
                        GLib.PRIORITY_DEFAULT, 250, () => {
                            this._verifyTimeoutId = 0;
                            this._readState();
                            return GLib.SOURCE_REMOVE;
                        });
                } catch (e) {
                    logError(e, '[power-quick-toggles/boost] StartUnit failed');
                    Main.notify('GPU Boost',
                        `Could not start ${unit}: ${e.message}`);
                    this._setCheckedSilently(!this.checked);
                }
            }
        );
    }

    destroy() {
        if (this._readCancellable) {
            this._readCancellable.cancel();
            this._readCancellable = null;
        }
        if (this._verifyTimeoutId) {
            GLib.source_remove(this._verifyTimeoutId);
            this._verifyTimeoutId = 0;
        }
        super.destroy();
    }
});

// =============================================================================
// Indicator + Extension
// =============================================================================
const PowerQuickTogglesIndicator = GObject.registerClass(
class PowerQuickTogglesIndicator extends SystemIndicator {
    _init() {
        super._init();
        this._ultra = new UltraPowerSaveToggle();
        this._boost = new GpuBoostToggle();
        this.quickSettingsItems.push(this._ultra);
        this.quickSettingsItems.push(this._boost);
    }

    destroy() {
        this.quickSettingsItems.forEach(i => i.destroy());
        this.quickSettingsItems = [];
        super.destroy();
    }
});

export default class PowerQuickTogglesExtension extends Extension {
    enable() {
        this._indicator = new PowerQuickTogglesIndicator();
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
