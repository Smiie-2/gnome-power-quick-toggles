import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {QuickToggle} from 'resource:///org/gnome/shell/ui/quickSettings.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {
    TUNED_NAME, TUNED_PATH, TUNED_IFACE, ULTRA_PROFILE,
    SYSTEMD_NAME, SYSTEMD_PATH, SYSTEMD_IFACE,
} from './common.js';

const PPD_UNIT = 'tuned-ppd.service';

const isCancelled = e =>
    e?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);

export const UltraPowerSaveToggle = GObject.registerClass(
class UltraPowerSaveToggle extends QuickToggle {
    _init() {
        super._init({
            title: 'Ultra PowerSaving',
            iconName: 'power-profile-power-saver-symbolic',
            toggleMode: true,
        });

        this._bus = Gio.DBus.system;
        this._cancellable = new Gio.Cancellable();
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
            Gio.DBusCallFlags.NONE, -1, this._cancellable,
            (src, res) => {
                try {
                    const [profile] = this._bus.call_finish(res).deep_unpack();
                    this._setCheckedSilently(profile === ULTRA_PROFILE);
                } catch (e) {
                    if (!isCancelled(e))
                        logError(e, '[power-quick-toggles/ups] active_profile failed');
                }
            }
        );
    }

    _enableUltra() {
        this._bus.call(
            TUNED_NAME, TUNED_PATH, TUNED_IFACE, 'switch_profile',
            new GLib.Variant('(s)', [ULTRA_PROFILE]),
            new GLib.VariantType('((bs))'),
            Gio.DBusCallFlags.NONE, -1, this._cancellable,
            (src, res) => {
                try {
                    const [[ok, msg]] = this._bus.call_finish(res).deep_unpack();
                    if (!ok) {
                        log(`[power-quick-toggles/ups] switch_profile refused: ${msg}`);
                        Main.notify('Ultra PowerSaving', `tuned refused: ${msg}`);
                        this._setCheckedSilently(false);
                    }
                } catch (e) {
                    if (isCancelled(e)) return;
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
            Gio.DBusCallFlags.NONE, -1, this._cancellable,
            (src, res) => {
                try {
                    this._bus.call_finish(res);
                } catch (e) {
                    if (isCancelled(e)) return;
                    logError(e, '[power-quick-toggles/ups] RestartUnit failed');
                    Main.notify('Ultra PowerSaving',
                        `Could not restart tuned-ppd: ${e.message}`);
                    this._setCheckedSilently(true);
                }
            }
        );
    }

    destroy() {
        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }
        if (this._signalId) {
            this._bus.signal_unsubscribe(this._signalId);
            this._signalId = 0;
        }
        super.destroy();
    }
});
