/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./themedSplash";
import "./ipcCommands";
import "./appBadge";
import "./patches";
import "./fixes";
import "./arrpc";

export * as Components from "./components";

import SettingsUi from "./components/settings/Settings";
import { VesktopLogger } from "./logger";
import { Settings } from "./settings";
export { Settings };


const InviteActions = findByPropsLazy("resolveInvite");

export const keybindCallbacks: {
    [id: number]: {
        onTrigger: Function;
        keyEvents: {
            keyup: boolean;
            keydown: boolean;
        };
    };
} = {};

export async function openInviteModal(code: string) {
    const { invite } = await InviteActions.resolveInvite(code, "Desktop Modal");
    if (!invite) return false;

    VesktopNative.win.focus();

    FluxDispatcher.dispatch({
        type: "INVITE_MODAL_OPEN",
        invite,
        code,
        context: "APP"
    });

    return true;
}

VesktopLogger.log("read if cute :3");
VesktopLogger.log("Vesktop v" + VesktopNative.app.getVersion());

export async function triggerKeybind(id: number, keyup: boolean) {
    var cb = keybindCallbacks[id];
    if (cb.keyEvents.keyup && keyup) {
        cb.onTrigger(false);
    } else if (cb.keyEvents.keydown && !keyup) {
        cb.onTrigger(true);
    }
}

const customSettingsSections = (
    Vencord.Plugins.plugins.Settings as any as { customSections: ((ID: Record<string, unknown>) => any)[] }
).customSections;

customSettingsSections.push(() => ({
    section: "Vesktop",
    label: "Vesktop Settings",
    element: SettingsUi,
    className: "vc-vesktop-settings"
}));
