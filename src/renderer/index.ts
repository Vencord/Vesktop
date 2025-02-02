/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import "./fixes";
import "./appBadge";
import "./patches";
import "./themedSplash";
import "./ipcCommands";
import "./arrpc";

console.log("read if cute :3");

export * as Components from "./components";
import { findByPropsLazy, onceReady } from "@vencord/types/webpack";
import { Alerts } from "@vencord/types/webpack/common";

import SettingsUi from "./components/settings/Settings";
import { Settings } from "./settings";
export { Settings };

const InviteActions = findByPropsLazy("resolveInvite");

const customSettingsSections = (
    Vencord.Plugins.plugins.Settings as any as { customSections: ((ID: Record<string, unknown>) => any)[] }
).customSections;

customSettingsSections.push(() => ({
    section: "Vesktop",
    label: "Vesktop Settings",
    element: SettingsUi,
    className: "vc-vesktop-settings"
}));

// TODO: remove soon
const vencordDir = "vencordDir" as keyof typeof Settings.store;
if (Settings.store[vencordDir]) {
    onceReady.then(() =>
        setTimeout(
            () =>
                Alerts.show({
                    title: "Custom Vencord Location",
                    body: "Due to security hardening changes in Vesktop, your custom Vencord location had to be reset. Please configure it again in the settings.",
                    onConfirm: () => delete Settings.store[vencordDir]
                }),
            5000
        )
    );
}
