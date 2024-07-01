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
    trayColor?: string;
    trayAutoFill?: "auto" | "white" | "black";
    trayMainOverride?: boolean;
    trayIdleOverride?: boolean;
    trayMutedOverride?: boolean;
    traySpeakingOverride?: boolean;
    trayDeafenedOverride?: boolean;
    minimizeToTray?: boolean;
    openLinksWithElectron?: boolean;
    staticTitle?: boolean;
    enableMenu?: boolean;
    disableSmoothScroll?: boolean;
    hardwareAcceleration?: boolean;
    arRPC?: boolean;
    appBadge?: boolean;
    disableMinSize?: boolean;
    clickTrayToShowHide?: boolean;
    customTitleBar?: boolean;

    checkUpdates?: boolean;

    splashTheming?: boolean;
    splashColor?: string;
    splashBackground?: string;

    spellCheckLanguages?: string[];

    audio?: {
        workaround?: boolean;
        granularSelect?: boolean;

        ignoreVirtual?: boolean;
        ignoreDevices?: boolean;
        ignoreInputMedia?: boolean;

        onlySpeakers?: boolean;
        onlyDefaultSpeakers?: boolean;
    };
}

export interface State {
    maximized?: boolean;
    minimized?: boolean;
    windowBounds?: Rectangle;
    displayid: int;

    skippedUpdate?: string;
    firstLaunch?: boolean;

    steamOSLayoutVersion?: number;
}
