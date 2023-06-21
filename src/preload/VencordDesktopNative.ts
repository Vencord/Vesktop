/*
 * SPDX-License-Identifier: GPL-3.0
 * Vencord Desktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import type { Settings } from "shared/settings";
import type { LiteralUnion } from "type-fest";

import { IpcEvents } from "../shared/IpcEvents";
import { invoke, sendSync } from "./typedIpcs";

export const VencordDesktopNative = {
    app: {
        relaunch: () => invoke<void>(IpcEvents.RELAUNCH),
        getVersion: () => sendSync<void>(IpcEvents.GET_VERSION)
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
        setLanguages: (languages: readonly string[]) => invoke<void>(IpcEvents.SPELLCHECK_SET_LANGUAGES, languages)
        // todo: perhaps add ways to learn words
    },
    win: {
        focus: () => invoke<void>(IpcEvents.FOCUS)
    },
    capturer: {
        getLargeThumbnail: (id: string) => invoke<string>(IpcEvents.CAPTURER_GET_LARGE_THUMBNAIL, id)
    }
};
