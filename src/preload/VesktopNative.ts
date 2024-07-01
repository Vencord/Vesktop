/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { Node } from "@vencord/venmic";
import { ipcRenderer } from "electron";
import type { Settings } from "shared/settings";
import type { LiteralUnion } from "type-fest";

import { IpcEvents } from "../shared/IpcEvents";
import { invoke, sendSync } from "./typedIpc";

type SpellCheckerResultCallback = (word: string, suggestions: string[]) => void;

const spellCheckCallbacks = new Set<SpellCheckerResultCallback>();

ipcRenderer.on(IpcEvents.SPELLCHECK_RESULT, (_, w: string, s: string[]) => {
    spellCheckCallbacks.forEach(cb => cb(w, s));
});

export const VesktopNative = {
    app: {
        relaunch: () => invoke<void>(IpcEvents.RELAUNCH),
        getVersion: () => sendSync<void>(IpcEvents.GET_VERSION),
        setBadgeCount: (count: number) => invoke<void>(IpcEvents.SET_BADGE_COUNT, count),
        supportsWindowsTransparency: () => sendSync<boolean>(IpcEvents.SUPPORTS_WINDOWS_TRANSPARENCY)
    },
    autostart: {
        isEnabled: () => sendSync<boolean>(IpcEvents.AUTOSTART_ENABLED),
        enable: () => invoke<void>(IpcEvents.ENABLE_AUTOSTART),
        disable: () => invoke<void>(IpcEvents.DISABLE_AUTOSTART)
    },
    fileManager: {
        showItemInFolder: (path: string) => invoke<void>(IpcEvents.SHOW_ITEM_IN_FOLDER, path),
        selectVencordDir: () => invoke<LiteralUnion<"cancelled" | "invalid", string>>(IpcEvents.SELECT_VENCORD_DIR)
    },
    settings: {
        get: () => sendSync<Settings>(IpcEvents.GET_SETTINGS),
        set: (settings: Settings, path?: string) => invoke<void>(IpcEvents.SET_SETTINGS, settings, path)
    },
    spellcheck: {
        getAvailableLanguages: () => sendSync<string[]>(IpcEvents.SPELLCHECK_GET_AVAILABLE_LANGUAGES),
        onSpellcheckResult(cb: SpellCheckerResultCallback) {
            spellCheckCallbacks.add(cb);
        },
        offSpellcheckResult(cb: SpellCheckerResultCallback) {
            spellCheckCallbacks.delete(cb);
        },
        replaceMisspelling: (word: string) => invoke<void>(IpcEvents.SPELLCHECK_REPLACE_MISSPELLING, word),
        addToDictionary: (word: string) => invoke<void>(IpcEvents.SPELLCHECK_ADD_TO_DICTIONARY, word)
    },
    win: {
        focus: () => invoke<void>(IpcEvents.FOCUS),
        close: (key?: string) => invoke<void>(IpcEvents.CLOSE, key),
        minimize: () => invoke<void>(IpcEvents.MINIMIZE),
        maximize: () => invoke<void>(IpcEvents.MAXIMIZE)
    },
    capturer: {
        getLargeThumbnail: (id: string) => invoke<string>(IpcEvents.CAPTURER_GET_LARGE_THUMBNAIL, id)
    },
    /** only available on Linux. */
    virtmic: {
        list: () =>
            invoke<
                { ok: false; isGlibCxxOutdated: boolean } | { ok: true; targets: Node[]; hasPipewirePulse: boolean }
            >(IpcEvents.VIRT_MIC_LIST),
        start: (include: Node[]) => invoke<void>(IpcEvents.VIRT_MIC_START, include),
        startSystem: (exclude: Node[]) => invoke<void>(IpcEvents.VIRT_MIC_START_SYSTEM, exclude),
        stop: () => invoke<void>(IpcEvents.VIRT_MIC_STOP)
    },
    arrpc: {
        onActivity(cb: (data: string) => void) {
            ipcRenderer.on(IpcEvents.ARRPC_ACTIVITY, (_, data: string) => cb(data));
        }
    },
    clipboard: {
        copyImage: (imageBuffer: Uint8Array, imageSrc: string) =>
            invoke<void>(IpcEvents.CLIPBOARD_COPY_IMAGE, imageBuffer, imageSrc)
    },
    keybind: {
        register: (id: number, shortcut: string, options: any) =>
            invoke<void>(IpcEvents.KEYBIND_REGISTER, id, shortcut),
        unregister: (id: number) => invoke<void>(IpcEvents.KEYBIND_UNREGISTER, id)
    }
};
