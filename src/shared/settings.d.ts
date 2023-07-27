/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import type { Rectangle } from "electron";

export interface Settings {
    transparencyOption?: "none" | "mica" | "tabbed" | "acrylic";
    maximized?: boolean;
    minimized?: boolean;
    windowBounds?: Rectangle;
    discordBranch?: "stable" | "canary" | "ptb";
    openLinksWithElectron?: boolean;
    vencordDir?: string;
    disableMinSize?: boolean;
    tray?: boolean;
    minimizeToTray?: boolean;
    skippedUpdate?: string;
    staticTitle?: boolean;
    arRPC?: boolean;
    appBadge?: boolean;

    firstLaunch?: boolean;
}
