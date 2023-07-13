/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import "./hideGarbage.css";

import { waitFor } from "@vencord/types/webpack";

import { isFirstRun, localStorage } from "./utils";

// Make clicking Notifications focus the window
const originalSetOnClick = Object.getOwnPropertyDescriptor(Notification.prototype, "onclick")!.set!;
Object.defineProperty(Notification.prototype, "onclick", {
    set(onClick) {
        originalSetOnClick.call(this, function (this: unknown) {
            onClick.apply(this, arguments);
            VesktopNative.win.focus();
        });
    },
    configurable: true
});

if (isFirstRun) {
    // Hide "Download Discord Desktop now!!!!" banner
    localStorage.setItem("hideNag", "true");

    // Enable Desktop Notifications by default
    waitFor("setDesktopType", m => {
        m.setDesktopType("all");
    });
}
