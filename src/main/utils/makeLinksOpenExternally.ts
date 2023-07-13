/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { BrowserWindow, shell } from "electron";

import { Settings } from "../settings";

export function makeLinksOpenExternally(win: BrowserWindow) {
    win.webContents.setWindowOpenHandler(({ url }) => {
        switch (url) {
            case "about:blank":
            case "https://discord.com/popout":
                return { action: "allow" };
        }

        try {
            var { protocol } = new URL(url);
        } catch {
            return { action: "deny" };
        }

        switch (protocol) {
            case "http:":
            case "https:":
                if (Settings.store.openLinksWithElectron) {
                    return { action: "allow" };
                }
            // eslint-disable-next-line no-fallthrough
            case "mailto:":
            case "steam:":
            case "spotify:":
                shell.openExternal(url);
        }

        return { action: "deny" };
    });
}
