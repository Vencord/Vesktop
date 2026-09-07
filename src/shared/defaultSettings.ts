/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Settings } from "./settings";

export const DefaultVesktopSettings: Settings = {
    discordBranch: "stable",
    hardwareAcceleration: true,
    hardwareVideoAcceleration: false,
    nativeTitleBar: false,
    staticTitle: false,
    enableMenu: false,
    enableShadow: true,
    enableRoundedCorners: true,
    enableSplashScreen: true,
    splashTheming: true,
    tray: true,
    minimizeToTray: true,
    clickTrayToShowHide: false,
    disableMinSize: false,
    disableSmoothScroll: false,
    enableTaskbarFlashing: false,
    arRPC: true,
    openLinksWithElectron: false,
    autoStartMinimized: false,
    splashPixelated: false,
    webRTCIPHandlingPolicy: "default",
    appBadge: true,
    transparencyOption: "none"
};
