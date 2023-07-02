/*
 * SPDX-License-Identifier: GPL-3.0
 * Vencord Desktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import "./hideGarbage.css";

import { waitFor } from "@vencord/types/webpack";

import { isFirstRun, localStorage } from "./utils";

import { Settings } from "./settings";

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

if (isFirstRun) {
    // Hide "Download Discord Desktop now!!!!" banner
    localStorage.setItem("hideNag", "true");

    // Enable Desktop Notifications by default
    waitFor("setDesktopType", m => {
        m.setDesktopType("all");
    });
}

// Prevent pressing Alt from opening the menu bar
document.addEventListener("keyup", e => {
    console.log(e);
    if (e.key !== "Alt") return;
    if (!Settings.store.disableAltMenu) return;
    e.preventDefault();
});

