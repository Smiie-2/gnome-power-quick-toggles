/* extension.js — Ultra PowerSaving
 *
 * Adds a Quick Settings toggle that flips tuned to
 * 'laptop-battery-powersave' (most aggressive) when ON, and restarts
 * tuned-ppd when OFF so GNOME's normal PPD->tuned mapping resumes.
 *
 * GNOME Shell 49, ESM module.
 */

import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {QuickToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const TUNED_NAME = 'com.redhat.tuned';
const TUNED_PATH = '/Tuned';
const TUNED_IFACE = 'com.redhat.tuned.control';
const ULTRA_PROFILE = 'laptop-battery-powersave';

const SYSTEMD_NAME = 'org.freedesktop.systemd1';
const SYSTEMD_PATH = '/org/freedesktop/systemd1';
const SYSTEMD_IFACE = 'org.freedesktop.systemd1.Manager';
const PPD_UNIT = 'tuned-ppd.service';

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
        this._busyUntilSignal = false;

        // Connect to the system bus signals for tuned profile changes
        this._signalId = this._bus.signal_subscribe(
            TUNED_NAME,
            TUNED_IFACE,
            'profile_changed',
            TUNED_PATH,
            null,
            Gio.DBusSignalFlags.NONE,
            (conn, sender, path, iface, signal, params) => {
                // signature: sbs -> (new_profile, result, message)
                try {
                    const [newProfile] = params.deep_unpack();
                    this._setCheckedSilently(newProfile === ULTRA_PROFILE);
                } catch (e) {
                    logError(e, '[ultra-powersave] profile_changed parse error');
                }
            }
        );

        // React to user clicks
        this._notifyId = this.connect('clicked', () => {
            if (this.checked)
                this._enableUltra();
            else
                this._revertToPPD();
        });

        // Initialize state from tuned
        this._readActiveProfile();
    }

    _setCheckedSilently(value) {
        if (this.checked === value)
            return;
        // Temporarily block the 'clicked' handler; we only react to user clicks,
        // and setting `checked` directly doesn't emit 'clicked'. Safe to just set.
        this.checked = value;
    }

    _readActiveProfile() {
        this._bus.call(
            TUNED_NAME, TUNED_PATH, TUNED_IFACE, 'active_profile',
            null, new GLib.VariantType('(s)'),
            Gio.DBusCallFlags.NONE, -1, null,
            (src, res) => {
                try {
                    const reply = this._bus.call_finish(res);
                    const [profile] = reply.deep_unpack();
                    this._setCheckedSilently(profile === ULTRA_PROFILE);
                } catch (e) {
                    logError(e, '[ultra-powersave] active_profile failed');
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
                    const reply = this._bus.call_finish(res);
                    const [ok, msg] = reply.deep_unpack();
                    if (!ok) {
                        log(`[ultra-powersave] switch_profile refused: ${msg}`);
                        Main.notify('Ultra PowerSaving', `tuned refused: ${msg}`);
                        this._setCheckedSilently(false);
                    }
                } catch (e) {
                    logError(e, '[ultra-powersave] switch_profile failed');
                    Main.notify('Ultra PowerSaving', `D-Bus error: ${e.message}`);
                    this._setCheckedSilently(false);
                }
            }
        );
    }

    _revertToPPD() {
        // Ask systemd to restart tuned-ppd.service. This works for the logged-in
        // active user session on this system without a polkit prompt (verified).
        // tuned-ppd re-reads the current PPD slider + AC/battery state and pushes
        // the appropriate profile back into tuned.
        this._bus.call(
            SYSTEMD_NAME, SYSTEMD_PATH, SYSTEMD_IFACE, 'RestartUnit',
            new GLib.Variant('(ss)', [PPD_UNIT, 'replace']),
            new GLib.VariantType('(o)'),
            Gio.DBusCallFlags.NONE, -1, null,
            (src, res) => {
                try {
                    this._bus.call_finish(res);
                } catch (e) {
                    logError(e, '[ultra-powersave] RestartUnit failed');
                    Main.notify('Ultra PowerSaving',
                        `Could not restart tuned-ppd: ${e.message}`);
                    // Roll back UI state since revert didn't happen
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

const UltraPowerSaveIndicator = GObject.registerClass(
class UltraPowerSaveIndicator extends SystemIndicator {
    _init() {
        super._init();
        this._toggle = new UltraPowerSaveToggle();
        this.quickSettingsItems.push(this._toggle);
    }

    destroy() {
        this.quickSettingsItems.forEach(i => i.destroy());
        this.quickSettingsItems = [];
        super.destroy();
    }
});

export default class UltraPowerSavingExtension extends Extension {
    enable() {
        this._indicator = new UltraPowerSaveIndicator();
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
