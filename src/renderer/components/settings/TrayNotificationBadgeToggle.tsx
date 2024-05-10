/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { Switch } from "@vencord/types/webpack/common";
import { setBadge } from "renderer/appBadge";

import { SettingsComponent } from "./Settings";

export const TrayNotificationBadgeToggle: SettingsComponent = ({ settings }) => {
    return (
        <Switch
            value={settings.trayBadge ?? true}
            onChange={v => {
                settings.trayBadge = v;
                if (v) setBadge();
                else VesktopNative.app.setBadgeCount(0);
            }}
            note="Show mention badge on the tray icon"
        >
            Tray Notification Badge
        </Switch>
    );
};
