/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { filters, waitFor } from "@vencord/types/webpack";
import { RelationshipStore } from "@vencord/types/webpack/common";

import { Settings } from "./settings";

let GuildReadStateStore: any;
let NotificationSettingsStore: any;

export function setBadge() {
    const { appBadge, trayBadge } = Settings.store;

    if (appBadge === false && trayBadge === false) return;

    try {
        const mentionCount = GuildReadStateStore.getTotalMentionCount();
        const pendingRequests = RelationshipStore.getPendingCount();
        const hasUnread = GuildReadStateStore.hasAnyUnread();
        const disableUnreadBadge = NotificationSettingsStore.getDisableUnreadBadge();

        let totalCount = mentionCount + pendingRequests;
        if (!totalCount && hasUnread && !disableUnreadBadge) totalCount = -1;

        if (appBadge || trayBadge) VesktopNative.app.setAppBadgeCount(totalCount);
    } catch (e) {
        console.error(e);
    }
}

let toFind = 3;

function waitForAndSubscribeToStore(name: string, cb?: (m: any) => void) {
    waitFor(filters.byStoreName(name), store => {
        cb?.(store);
        store.addChangeListener(setBadge);

        toFind--;
        if (toFind === 0) setBadge();
    });
}

waitForAndSubscribeToStore("GuildReadStateStore", store => (GuildReadStateStore = store));
waitForAndSubscribeToStore("NotificationSettingsStore", store => (NotificationSettingsStore = store));
waitForAndSubscribeToStore("RelationshipStore");
