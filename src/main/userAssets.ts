/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app, dialog, net } from "electron";
import { copyFile, mkdir, rm } from "fs/promises";
import { join } from "path";
import { IpcEvents } from "shared/IpcEvents";
import { STATIC_DIR } from "shared/paths";
import { pathToFileURL } from "url";

import { DATA_DIR } from "./constants";
import { AppEvents } from "./events";
import { mainWin } from "./mainWindow";
import { fileExistsAsync } from "./utils/fileExists";
import { handle } from "./utils/ipcWrappers";

const CUSTOMIZABLE_ASSETS = ["splash", "tray", "trayUnread"] as const;
export type UserAssetType = (typeof CUSTOMIZABLE_ASSETS)[number];

const DEFAULT_ASSETS: Record<UserAssetType, string> = {
    splash: "splash.webp",
    tray: `tray/${process.platform === "darwin" ? "trayTemplate" : "tray"}.png`,
    trayUnread: "tray/trayUnread.png"
};

const UserAssetFolder = join(DATA_DIR, "userAssets");

export async function resolveAssetPath(asset: UserAssetType) {
    if (!CUSTOMIZABLE_ASSETS.includes(asset)) {
        throw new Error(`Invalid asset: ${asset}`);
    }

    const assetPath = join(UserAssetFolder, asset);
    if (await fileExistsAsync(assetPath)) {
        return assetPath;
    }

    return join(STATIC_DIR, DEFAULT_ASSETS[asset]);
}

export async function handleVesktopAssetsProtocol(path: string, req: Request) {
    const asset = path.slice(1);

    // @ts-expect-error dumb types
    if (!CUSTOMIZABLE_ASSETS.includes(asset)) {
        return new Response(null, { status: 404 });
    }

    try {
        const res = await net.fetch(pathToFileURL(join(UserAssetFolder, asset)).href);
        if (res.ok) return res;
    } catch {}

    return net.fetch(pathToFileURL(join(STATIC_DIR, DEFAULT_ASSETS[asset])).href);
}

handle(IpcEvents.CHOOSE_USER_ASSET, async (_event, asset: UserAssetType, value?: null) => {
    if (!CUSTOMIZABLE_ASSETS.includes(asset)) {
        throw `Invalid asset: ${asset}`;
    }

    const assetPath = join(UserAssetFolder, asset);

    if (value === null) {
        try {
            await rm(assetPath, { force: true });
            AppEvents.emit("userAssetChanged", asset);
            return "ok";
        } catch (e) {
            console.error(`Failed to remove user asset ${asset}:`, e);
            return "failed";
        }
    }

    const res = await dialog.showOpenDialog(mainWin, {
        properties: ["openFile"],
        title: `Select an image to use as ${asset}`,
        defaultPath: app.getPath("pictures"),
        filters: [
            {
                name: "Images",
                extensions: ["png", "jpg", "jpeg", "webp", "gif", "avif", "svg"]
            }
        ]
    });

    if (res.canceled || !res.filePaths.length) return "cancelled";

    try {
        await mkdir(UserAssetFolder, { recursive: true });
        await copyFile(res.filePaths[0], assetPath);
        AppEvents.emit("userAssetChanged", asset);
        return "ok";
    } catch (e) {
        console.error(`Failed to copy user asset ${asset}:`, e);
        return "failed";
    }
});
