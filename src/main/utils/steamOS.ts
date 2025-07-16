/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BrowserWindow, dialog } from "electron";
import { writeFile } from "fs/promises";
import { join } from "path";

import { MessageBoxChoice } from "../constants";
import { State } from "../settings";

// Bump this to re-show the prompt
const layoutVersion = 2;
// Get this from "show details" on the profile after exporting as a shared personal layout or using share with community
const layoutId = "3080264545"; // Vesktop Layout v2
const numberRegex = /^[0-9]*$/;

let steamPipeQueue = Promise.resolve();

export const isDeckGameMode = process.env.SteamOS === "1" && process.env.SteamGamepadUI === "1";

export function applyDeckKeyboardFix() {
    if (!isDeckGameMode) return;
    // Prevent constant virtual keyboard spam that eventually crashes Steam.
    process.env.GTK_IM_MODULE = "None";
}

// For some reason SteamAppId is always 0 for non-steam apps so we do this insanity instead.
function getAppId(): string | null {
    // /home/deck/.local/share/Steam/steamapps/shadercache/APPID/fozmediav1
    const path = process.env.STEAM_COMPAT_MEDIA_PATH;
    if (!path) return null;
    const pathElems = path?.split("/");
    const appId = pathElems[pathElems.length - 2];
    if (appId.match(numberRegex)) {
        console.log(`Got Steam App ID ${appId}`);
        return appId;
    }
    return null;
}

export function execSteamURL(url: string) {
    // This doesn't allow arbitrary execution despite the weird syntax.
    steamPipeQueue = steamPipeQueue.then(() =>
        writeFile(
            join(process.env.HOME || "/home/deck", ".steam", "steam.pipe"),
            // replace ' to prevent argument injection
            `'${process.env.HOME}/.local/share/Steam/ubuntu12_32/steam' '-ifrunning' '${url.replaceAll("'", "%27")}'\n`,
            "utf-8"
        )
    );
}

export function steamOpenURL(url: string) {
    execSteamURL(`steam://openurl/${url}`);
}

export async function showGamePage() {
    const appId = getAppId();
    if (!appId) return;
    await execSteamURL(`steam://nav/games/details/${appId}`);
}

async function showLayout(appId: string) {
    execSteamURL(`steam://controllerconfig/${appId}/${layoutId}`);
}

export async function askToApplySteamLayout(win: BrowserWindow) {
    const appId = getAppId();
    if (!appId) return;
    if (State.store.steamOSLayoutVersion === layoutVersion) return;
    const update = Boolean(State.store.steamOSLayoutVersion);

    // Touch screen breaks in some menus when native touch mode is enabled on latest SteamOS beta, remove most of the update specific text once that's fixed.
    const { response } = await dialog.showMessageBox(win, {
        message: `${update ? "Update" : "Apply"} Vesktop Steam Input Layout?`,
        detail: `Would you like to ${update ? "Update" : "Apply"} Vesktop's recommended Steam Deck controller settings?
${update ? "Click yes using the touchpad" : "Tap yes"}, then press the X button or tap Apply Layout to confirm.${
            update ? " Doing so will undo any customizations you have made." : ""
        }
${update ? "Click" : "Tap"} no to keep your current layout.`,
        buttons: ["Yes", "No"],
        cancelId: MessageBoxChoice.Cancel,
        defaultId: MessageBoxChoice.Default,
        type: "question"
    });

    if (State.store.steamOSLayoutVersion !== layoutVersion) {
        State.store.steamOSLayoutVersion = layoutVersion;
    }

    if (response === MessageBoxChoice.Cancel) return;

    await showLayout(appId);
}
