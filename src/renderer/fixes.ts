/*
 * SPDX-License-Identifier: GPL-3.0
 * Vencord Desktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import "./hideGarbage.css";

import { isFirstRun, localStorage } from "./utils";

// Make clicking Notifications focus the window
const originalSetOnClick = Object.getOwnPropertyDescriptor(Notification.prototype, "onclick")!.set!;
Object.defineProperty(Notification.prototype, "onclick", {
    set(onClick) {
        originalSetOnClick.call(this, function (this: unknown) {
            onClick.apply(this, arguments);
            VencordDesktopNative.win.focus();
        });
    },
    configurable: true
});

// Enable Desktop Notifications by default
if (isFirstRun) {
    // Hide "Download Discord Desktop now!!!!" banner
    localStorage.setItem("hideNag", "true");

    Vencord.Webpack.waitFor("setDesktopType", m => {
        m.setDesktopType("all");
    });
}
