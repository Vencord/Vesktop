/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import type { Rectangle } from "electron";

export interface Settings {
    discordBranch?: "stable" | "canary" | "ptb";
    vencordDir?: string;
    transparencyOption?: "none" | "mica" | "tabbed" | "acrylic";
    tray?: boolean;
    minimizeToTray?: boolean;
    middleClickAutoscroll?: boolean;
    openLinksWithElectron?: boolean;
    staticTitle?: boolean;
    enableMenu?: boolean;
    arRPC?: boolean;
    appBadge?: boolean;
    discordWindowsTitleBar?: boolean;

    maximized?: boolean;
    minimized?: boolean;
    windowBounds?: Rectangle;
    disableMinSize?: boolean;

    checkUpdates?: boolean;
    skippedUpdate?: string;
    firstLaunch?: boolean;

    splashTheming?: boolean;
    splashColor?: string;
    splashBackground?: string;

    steamOSLayoutVersion?: number;
}
