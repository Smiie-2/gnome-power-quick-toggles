/* extension.js — Power Quick Toggles
 *
 * Adds two Quick Settings toggles for ThinkPad power tuning:
 *   - "Ultra PowerSaving" (tuned profile switch, see toggles/ultraPowerSave.js)
 *   - "GPU Boost"         (Intel MMIO RAPL via systemd units, see toggles/gpuBoost.js)
 *
 * GNOME Shell 49, ESM module.
 */

import GObject from 'gi://GObject';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {UltraPowerSaveToggle} from './toggles/ultraPowerSave.js';
import {GpuBoostToggle} from './toggles/gpuBoost.js';

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
