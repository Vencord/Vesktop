/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Settings } from "./settings";
import { localStorage } from "./utils";

function syncBackgroundAccounts() {
    if (!Settings.store.enableMultiAccountNotifications) return;

    void VesktopNative.app.syncBackgroundAccounts(
        localStorage.getItem("tokens"),
        localStorage.getItem("user_id_cache"),
        localStorage.getItem("MultiAccountStore")
    );
}

VesktopNative.app.onBackgroundNotificationClick((accountId, route) => {
    try {
        const tokens = JSON.parse(localStorage.getItem("tokens") ?? "{}");
        const token = tokens[accountId];
        if (typeof token !== "string") return;

        localStorage.setItem("token", JSON.stringify(token));
        localStorage.setItem("user_id_cache", JSON.stringify(accountId));
        location.replace(route);
    } catch {}
});

setInterval(syncBackgroundAccounts, 5000);
syncBackgroundAccounts();
