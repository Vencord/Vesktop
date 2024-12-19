/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import "./themedSplash";
import "./ipcCommands";
import "./appBadge";
import "./patches";
import "./fixes";
import "./arrpc";

console.log("read if cute :3");

export * as Components from "./components";
import { onceReady } from "@vencord/types/webpack";
import { Alerts } from "@vencord/types/webpack/common";

import SettingsUi from "./components/settings/Settings";
import { Settings } from "./settings";
export { Settings };

export async function openDeepLink(data: any) {
    console.log(data);
    if (data.type === "CHANNEL") {
        // I am unaware of any other types but ensure just in case.
        const { guildId, channelId, messageId } = data.params;
        if (!guildId) return false; // ensure at least guildId exists

        const path = [guildId, channelId, messageId].filter(Boolean).join("/");
        Vencord.Webpack.Common.NavigationRouter.transitionTo(`/channels/${path}`);

        return true;
    } else {
        console.warn("Unhandled deep link type: ", data.type);
        return false;
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
