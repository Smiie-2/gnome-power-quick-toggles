import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {QuickToggle} from 'resource:///org/gnome/shell/ui/quickSettings.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {
    TUNED_NAME, TUNED_PATH, TUNED_IFACE,
    SYSTEMD_NAME, SYSTEMD_PATH, SYSTEMD_IFACE,
} from './common.js';

const BOOST_UNIT = 'power-limit-boost.service';
const DEFAULT_UNIT = 'power-limit-default.service';
const MMIO_PL1 = '/sys/class/powercap/intel-rapl-mmio:0/constraint_0_power_limit_uw';
const BOOST_THRESHOLD_UW = 40_000_000;

const isCancelled = e =>
    e?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);

export const GpuBoostToggle = GObject.registerClass(
class GpuBoostToggle extends QuickToggle {
    _init() {
        super._init({
            title: 'GPU Boost',
            iconName: 'power-profile-performance-symbolic',
            toggleMode: true,
        });

        this._bus = Gio.DBus.system;
        this._cancellable = new Gio.Cancellable();
        this._verifyTimeoutId = 0;
        this._profileSignalId = 0;

        this.connect('clicked', () => {
            const unit = this.checked ? BOOST_UNIT : DEFAULT_UNIT;
            this._startUnit(unit);
        });

        this._profileSignalId = this._bus.signal_subscribe(
            TUNED_NAME, TUNED_IFACE, 'profile_changed', TUNED_PATH, null,
            Gio.DBusSignalFlags.NONE,
            () => this._scheduleVerify(750)
        );

        this._readState();
    }

    _scheduleVerify(delayMs) {
        if (this._verifyTimeoutId)
            GLib.source_remove(this._verifyTimeoutId);
        this._verifyTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, delayMs, () => {
                this._verifyTimeoutId = 0;
                this._readState();
                return GLib.SOURCE_REMOVE;
            });
    }

    _setCheckedSilently(value) {
        if (this.checked !== value) this.checked = value;
    }

    _readState() {
        const file = Gio.File.new_for_path(MMIO_PL1);
        file.load_contents_async(this._cancellable, (src, res) => {
            try {
                const [, bytes] = file.load_contents_finish(res);
                const text = new TextDecoder().decode(bytes).trim();
                const value = parseInt(text, 10);
                if (Number.isFinite(value))
                    this._setCheckedSilently(value > BOOST_THRESHOLD_UW);
            } catch (e) {
                if (!isCancelled(e))
                    logError(e, '[power-quick-toggles/boost] read PL1 failed');
            }
        });
    }

    _startUnit(unit) {
        this._bus.call(
            SYSTEMD_NAME, SYSTEMD_PATH, SYSTEMD_IFACE, 'StartUnit',
            new GLib.Variant('(ss)', [unit, 'replace']),
            new GLib.VariantType('(o)'),
            Gio.DBusCallFlags.NONE, -1, this._cancellable,
            (src, res) => {
                try {
                    this._bus.call_finish(res);
                    this._scheduleVerify(250);
                } catch (e) {
                    if (isCancelled(e)) return;
                    logError(e, '[power-quick-toggles/boost] StartUnit failed');
                    Main.notify('GPU Boost',
                        `Could not start ${unit}: ${e.message}`);
                    this._setCheckedSilently(!this.checked);
                }
            }
        );
    }

    destroy() {
        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }
        if (this._profileSignalId) {
            this._bus.signal_unsubscribe(this._profileSignalId);
            this._profileSignalId = 0;
        }
        if (this._verifyTimeoutId) {
            GLib.source_remove(this._verifyTimeoutId);
            this._verifyTimeoutId = 0;
        }
        super.destroy();
    }
});
