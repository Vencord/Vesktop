/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { app, NativeImage, nativeImage } from "electron";
import { join } from "path";
import { BADGE_DIR } from "shared/paths";
import { execFile } from "child_process";

const imgCache = new Map<number, NativeImage>();
function loadBadge(index: number) {
    const cached = imgCache.get(index);
    if (cached) return cached;

    const img = nativeImage.createFromPath(join(BADGE_DIR, `${index}.ico`));
    imgCache.set(index, img);

    return img;
}

let lastIndex: null | number = -1;

export function setBadgeCount(count: number) {
    switch (process.platform) {
        case "linux":
            if (typeof count !== "number") { //sanitize
                console.log("what the hel- *kaboom*") 
                break;
            }
            
            execFile ("gdbus", [
                "emit",
                "--session",
                "--object-path",
                "/",
                "--signal",
                "com.canonical.Unity.LauncherEntry.Update",
                "application://vesktop.desktop",
                `{\'count\': <int64 ${count === -1 ? 0 : count}>, \'count-visible\': <${count !== 0}>}`
            ]);

            break;
        case "darwin":
            if (count === 0) {
                app.dock.setBadge("");
                break;
            }
            app.dock.setBadge(count === -1 ? "•" : count.toString());
            break;
        case "win32":
            const [index, description] = getBadgeIndexAndDescription(count);
            if (lastIndex === index) break;

            lastIndex = index;

            // circular import shenanigans
            const { mainWin } = require("./mainWindow") as typeof import("./mainWindow");
            mainWin.setOverlayIcon(index === null ? null : loadBadge(index), description);
            break;
    }
}

function getBadgeIndexAndDescription(count: number): [number | null, string] {
    if (count === -1) return [11, "Unread Messages"];
    if (count === 0) return [null, "No Notifications"];

    const index = Math.max(1, Math.min(count, 10));
    return [index, `${index} Notification`];
}
