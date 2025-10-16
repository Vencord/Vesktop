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
                title="Start With System"
                description="Automatically start Vesktop on computer start-up"
                value={autoStartEnabled}
                onChange={async v => {
                    await VesktopNative.autostart[v ? "enable" : "disable"]();
                    setAutoStartEnabled(v);
                }}
            />

            <VesktopSettingsSwitch
                title="Auto Start Minimized"
                description={"Start Vesktop minimized when starting with system"}
                value={settings.autoStartMinimized ?? false}
                onChange={v => (settings.autoStartMinimized = v)}
                disabled={!autoStartEnabled}
            />
        </>
    );
};
