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

import SettingsUi from "./components/settings/Settings";
import { Settings } from "./settings";
export { Settings };

const customSettingsSections = (
    Vencord.Plugins.plugins.Settings as any as { customSections: ((ID: Record<string, unknown>) => any)[] }
).customSections;

customSettingsSections.push(() => ({
    section: "Vesktop",
    label: "Vesktop Settings",
    element: SettingsUi,
    className: "vc-vesktop-settings"
}));
