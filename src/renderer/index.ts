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

import { findByPropsLazy } from "@vencord/types/webpack";

import SettingsUi from "./components/settings/Settings";
import { VesktopLogger } from "./logger";
import { Settings } from "./settings";
export { Settings };

VesktopLogger.log("read if cute :3");
VesktopLogger.log("Vesktop v" + VesktopNative.app.getVersion());

const customSettingsSections = (
    Vencord.Plugins.plugins.Settings as any as { customSections: ((ID: Record<string, unknown>) => any)[] }
).customSections;

customSettingsSections.push(() => ({
    section: "Vesktop",
    label: "Vesktop Settings",
    element: SettingsUi,
    className: "vc-vesktop-settings"
}));

const VoiceActions = findByPropsLazy("toggleSelfMute");

VesktopNative.voice.onToggleSelfMute(() => VoiceActions.toggleSelfMute());
VesktopNative.voice.onToggleSelfDeaf(() => VoiceActions.toggleSelfDeaf());
