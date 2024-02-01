/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { globalShortcut } from "electron";

import { IpcEvents } from "../shared/IpcEvents";
import { handle } from "./utils/ipcWrappers";

// mapping the discord ids to the electron accelerators
const registeredKeybinds = new Map<string, string>();

export function registerKeybindsHandler() {
    handle(IpcEvents.KEYBIND_REGISTER, async (_, id: string, shortcut: number[][], callback: () => void) => {
        const accelerator = discordShortcutToElectronAccelerator(shortcut);
        globalShortcut.register(accelerator, callback);
        registeredKeybinds.set(id, accelerator);
        console.log("Registered keybind", id, shortcut, accelerator);
    });
    handle(IpcEvents.KEYBIND_UNREGISTER, async (_, id: string) => {
        const keybind = registeredKeybinds.get(id);
        if (keybind) {
            globalShortcut.unregister(keybind);
            registeredKeybinds.delete(id);
            console.log("Unregistered keybind", id, keybind);
        } else {
            console.warn("Tried to unregister keybind", id, "but it was not registered");
        }
    });
}

function discordShortcutToElectronAccelerator(shortcut: number[][]): string {
    // discords shortcuts are an array of an array of numbers, where each number is a key code
    // electron expects strings like "Control+Shift+B"

    let accelerator = "";

    // for some reason array[0] is always 0 and array[2] is always 4 TODO: investigate what these are for
    const keyCodes = shortcut.map(keybind => keybind[1]);

    // convert modifier keys to strings
    // 16 = shift, 17 = control, 18 = alt
    for (const keyCode of keyCodes) {
        switch (keyCode) {
            case 16:
                accelerator += "Shift+";
                break;
            case 17:
                accelerator += "Control+";
                break;
            case 18:
                accelerator += "Alt+";
                break;
        }
    }

    // convert other keys to strings
    // numbers are from 48 to 57
    // letters are from 65 to 90
    for (const keyCode of keyCodes) {
        if ((keyCode >= 48 && keyCode <= 57) || (keyCode >= 65 && keyCode <= 90)) {
            // String.fromCharCode only works for numbers and letters so only those are support as of now
            // TODO: improve this method to add support for more keys
            accelerator += String.fromCharCode(keyCode);
        }
    }

    return accelerator;
}
