/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./fixes.css";

import { localStorage } from "./utils";

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

// Hide "Download Discord Desktop now!!!!" banner
localStorage.setItem("hideNag", "true");
