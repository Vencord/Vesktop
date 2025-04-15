/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { filters, waitFor } from "@vencord/types/webpack";
import { RelationshipStore } from "@vencord/types/webpack/common";

import { VesktopLogger } from "./logger";
import { Settings } from "./settings";

let GuildReadStateStore: any;
let NotificationSettingsStore: any;

export function setBadge() {
    if (Settings.store.appBadge === false) return;

    try {
        const mentionCount = GuildReadStateStore.getTotalMentionCount();
        const pendingRequests = RelationshipStore.getPendingCount();
        const hasUnread = GuildReadStateStore.hasAnyUnread();
        const disableUnreadBadge = NotificationSettingsStore.getDisableUnreadBadge();

        let totalCount = mentionCount + pendingRequests;
        if (!totalCount && hasUnread && !disableUnreadBadge) totalCount = -1;

        VesktopNative.app.setBadgeCount(totalCount);
    } catch (e) {
        VesktopLogger.error("Failed to update badge count", e);
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
