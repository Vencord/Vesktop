/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { filters, waitFor } from "@vencord/types/webpack";
import { GenericStore, RelationshipStore } from "@vencord/types/webpack/common";

import { VesktopLogger } from "./logger";
import { Settings } from "./settings";

let GuildReadStateStore: GenericStore;
let NotificationSettingsStore: GenericStore;
let SelfPresenceStore: GenericStore;

let lastCount = 0;

export function setBadge() {
    const { appBadge: enableAppBadge, enableTaskbarFlashing } = Settings.store;
    if (!enableAppBadge && !enableTaskbarFlashing) return;

    try {
        const mentionCount = GuildReadStateStore.getTotalMentionCount();
        const pendingRequests = RelationshipStore.getPendingCount();
        const totalCount = mentionCount + pendingRequests;

        if (enableAppBadge) {
            const hasUnread = GuildReadStateStore.hasAnyUnread();
            const disableUnreadBadge = NotificationSettingsStore.getDisableUnreadBadge();
            const badgeValue = !totalCount && hasUnread && !disableUnreadBadge ? -1 : totalCount;
            VesktopNative.app.setBadgeCount(badgeValue);
        }

        if (enableTaskbarFlashing) {
            const canDisturb = SelfPresenceStore.getStatus() !== "dnd";
            if (totalCount > lastCount && canDisturb) {
                VesktopNative.win.flashFrame(true);
            } else if (totalCount === 0 && lastCount !== totalCount) {
                VesktopNative.win.flashFrame(false);
            }
            lastCount = totalCount;
        }
    } catch (e) {
        VesktopLogger.error("Failed to update badge/taskbar state", e);
    }
}

function waitForStore(name: string, cb?: (store: GenericStore) => void) {
    return new Promise<GenericStore>(resolve => {
        waitFor(filters.byStoreName(name), store => {
            cb?.(store);
            resolve(store);
        });
    });
}

Promise.all([
    waitForStore("GuildReadStateStore", store => (GuildReadStateStore = store)),
    waitForStore("NotificationSettingsStore", store => (NotificationSettingsStore = store)),
    waitForStore("SelfPresenceStore", store => (SelfPresenceStore = store)),
    waitForStore("RelationshipStore")
]).then(stores => {
    stores.forEach(store => {
        store.addChangeListener(setBadge);
    });
    setBadge();
});
