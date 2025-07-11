/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { setBadge } from "renderer/appBadge";
import { setCurrentTrayIcon } from "renderer/patches/tray";

import { SettingsComponent } from "./Settings";
import { VesktopSettingsSwitch } from "./VesktopSettingsSwitch";

export const NotificationBadgeToggle: SettingsComponent = ({ settings }) => {
    return (
        <VesktopSettingsSwitch
            value={settings.appBadge ?? true}
            onChange={v => {
                settings.appBadge = v;
                if (v) setBadge();
                else VesktopNative.app.setBadgeCount(0);
                setCurrentTrayIcon();
            }}
            note="Show mention badge on the app icon"
        >
            Notification Badge
        </VesktopSettingsSwitch>
    );
};
