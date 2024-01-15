/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { BrowserWindow, shell } from "electron";

import { Settings } from "../settings";
import { execSteamURL, isDeckGameMode, steamOpenURL } from "./steamOS";

const DISCORD_HOSTNAMES = ["discord.com", "canary.discord.com", "ptb.discord.com"];
export function makeLinksOpenExternally(win: BrowserWindow) {
    win.webContents.setWindowOpenHandler(({ url, frameName }) => {
        try {
            var { protocol, hostname, pathname } = new URL(url);
        } catch {
            return { action: "deny" };
        }

        if (
            url === "about:blank" ||
            (pathname === "/popout" && DISCORD_HOSTNAMES.includes(hostname)) ||
            (frameName === "authorize" && DISCORD_HOSTNAMES.includes(hostname))
        )
            return { action: "allow" };

        switch (protocol) {
            case "http:":
            case "https:":
                if (Settings.store.openLinksWithElectron) {
                    return { action: "allow" };
                }
            // eslint-disable-next-line no-fallthrough
            case "mailto:":
            case "spotify:":
                if (isDeckGameMode) {
                    steamOpenURL(url);
                } else {
                    shell.openExternal(url);
                }
                break;
            case "steam:":
                if (isDeckGameMode) {
                    execSteamURL(url);
                } else {
                    shell.openExternal(url);
                }
                break;
        }

        return { action: "deny" };
    });
}
