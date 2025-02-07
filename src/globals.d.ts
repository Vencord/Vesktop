/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

declare global {
    export var VesktopNative: typeof import("preload/VesktopNative").VesktopNative;
    export var Vesktop: typeof import("renderer/index");
    export var VesktopPatchGlobals: any;

    export var IS_DEV: boolean;
}

export {};
