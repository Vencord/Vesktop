/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import type { Rectangle } from "electron";

export interface SettingsV1 {
    formatVersion: 1;
    discordBranch?: "stable" | "canary" | "ptb";
    vencordDir?: string;
    transparencyOption?: "none" | "mica" | "tabbed" | "acrylic";
    tray?: boolean;
    minimizeToTray?: boolean;
    openLinksWithElectron?: boolean;
    staticTitle?: boolean;
    enableMenu?: boolean;
    arRPC?: boolean;
    appBadge?: boolean;
    discordWindowsTitleBar?: boolean;
    disableMinSize?: boolean;

    checkUpdates?: boolean;

    splashTheming?: boolean;
    splashColor?: string;
    splashBackground?: string;
}

export interface StateV1 {
    formatVersion: 1;
    maximized?: boolean;
    minimized?: boolean;
    windowBounds?: Rectangle;

    skippedUpdate?: string;
    firstLaunch?: boolean;

    steamOSLayoutVersion?: number;
}
