/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { contextBridge, ipcRenderer } from "electron/renderer";
import { IpcEvents } from "shared/IpcEvents";

interface BackgroundAccountContext {
    token: string;
    label: string;
}

function installNotificationBridge(accountLabel: string) {
    const NativeNotification = window.Notification;

    window.Notification = class extends NativeNotification {
        constructor(title: string, options?: NotificationOptions) {
            super(`[${accountLabel}] ${title}`, options);
            this.addEventListener("click", () => {
                setTimeout(() => {
                    const channel = location.pathname.match(/^\/channels\/(?:@me|\d{16,22})\/\d{16,22}/)?.[0];
                    const route =
                        channel && /^\d{16,22}$/.test(this.tag) ? `${channel}/${this.tag}` : location.pathname;
                    (
                        window as typeof window & {
                            VesktopBackgroundNative: { openNotification(route: string): void };
                        }
                    ).VesktopBackgroundNative.openNotification(route);
                });
            });
        }
    };
}

try {
    const storage = window.localStorage;
    const context: unknown = ipcRenderer.sendSync(IpcEvents.GET_BACKGROUND_ACCOUNT_CONTEXT);
    if (
        context != null &&
        typeof context === "object" &&
        typeof (context as BackgroundAccountContext).token === "string" &&
        typeof (context as BackgroundAccountContext).label === "string"
    ) {
        const { token, label } = context as BackgroundAccountContext;
        storage.setItem("token", JSON.stringify(token));
        storage.setItem("notifications", JSON.stringify({ _state: { desktopType: 1 }, _version: 1 }));

        contextBridge.exposeInMainWorld("VesktopBackgroundNative", {
            openNotification: (route: string) => ipcRenderer.invoke(IpcEvents.BACKGROUND_NOTIFICATION_CLICKED, route)
        });
        contextBridge.executeInMainWorld({ func: installNotificationBridge, args: [label] });
    }
} catch {}
