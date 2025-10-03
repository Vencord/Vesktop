/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useState } from "@vencord/types/webpack/common";

import { SettingsComponent } from "./Settings";
import { VesktopSettingsSwitch } from "./VesktopSettingsSwitch";

export const AutoStartToggle: SettingsComponent = ({ settings }) => {
    const [autoStartEnabled, setAutoStartEnabled] = useState(VesktopNative.autostart.isEnabled());

    return (
        <>
            <VesktopSettingsSwitch
                value={autoStartEnabled}
                onChange={async v => {
                    await VesktopNative.autostart[v ? "enable" : "disable"]();
                    setAutoStartEnabled(v);
                }}
                note="Automatically start Vesktop on computer start-up"
            >
                Start With System
            </VesktopSettingsSwitch>

            <VesktopSettingsSwitch
                value={settings.autoStartMinimized ?? false}
                onChange={v => (settings.autoStartMinimized = v)}
                note={"Start Vesktop minimized when starting with system"}
                disabled={!autoStartEnabled}
            >
                Auto Start Minimized
            </VesktopSettingsSwitch>
        </>
    );
};
