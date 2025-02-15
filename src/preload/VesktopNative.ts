/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Node } from "@vencord/venmic";
import { ipcRenderer } from "electron";
import { IpcMessage, IpcResponse } from "main/ipcCommands";
import type { Settings } from "shared/settings";

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
        supportsWindowsTransparency: () => sendSync<boolean>(IpcEvents.SUPPORTS_WINDOWS_TRANSPARENCY),
        getAccentColor: () => invoke<string>(IpcEvents.GET_SYSTEM_ACCENT_COLOR)
    },
    autostart: {
        isEnabled: () => sendSync<boolean>(IpcEvents.AUTOSTART_ENABLED),
        enable: () => invoke<void>(IpcEvents.ENABLE_AUTOSTART),
        disable: () => invoke<void>(IpcEvents.DISABLE_AUTOSTART)
    },
    fileManager: {
        showItemInFolder: (path: string) => invoke<void>(IpcEvents.SHOW_ITEM_IN_FOLDER, path),
        selectTrayIcon: (iconName: string) =>
            invoke<"cancelled" | "invalid" | string>(IpcEvents.SELECT_TRAY_ICON, iconName),
        getVencordDir: () => sendSync<string | undefined>(IpcEvents.GET_VENCORD_DIR),
        selectVencordDir: (value?: null) => invoke<"cancelled" | "invalid" | "ok">(IpcEvents.SELECT_VENCORD_DIR, value)
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
    clipboard: {
        copyImage: (imageBuffer: Uint8Array, imageSrc: string) =>
            invoke<void>(IpcEvents.CLIPBOARD_COPY_IMAGE, imageBuffer, imageSrc)
    },
    tray: {
        setIcon: (iconURI: string) => invoke<void>(IpcEvents.SET_TRAY_ICON, iconURI),
        getIcon: (iconName: string) => invoke<string>(IpcEvents.GET_TRAY_ICON, iconName),
        getIconSync: (iconName: string) => sendSync<string>(IpcEvents.GET_TRAY_ICON_SYNC, iconName),
        createIconResponse: (
            iconName: string,
            iconDataURL: string,
            isCustomIcon: boolean = true,
            isSvg: boolean = true
        ) => invoke<void>(IpcEvents.CREATE_TRAY_ICON_RESPONSE, iconName, iconDataURL, isCustomIcon, isSvg),
        createIconRequest: (listener: (iconName: string, svg: string) => void) => {
            ipcRenderer.on(IpcEvents.CREATE_TRAY_ICON_REQUEST, (_, iconPath: string, svg: string) =>
                listener(iconPath, svg)
            );
        },
        generateTrayIcons: () => invoke<void>(IpcEvents.GENERATE_TRAY_ICONS),
        setCurrentVoiceIcon: (listener: (...args: any[]) => void) => {
            ipcRenderer.on(IpcEvents.SET_CURRENT_VOICE_TRAY_ICON, listener);
        },
        addBadgeToIcon: (listener: (iconDataURL: string, badgeDataURL: string) => void) => {
            ipcRenderer.on(IpcEvents.ADD_BADGE_TO_ICON, (_, iconDataURL: string, badgeDataURL: string) =>
                listener(iconDataURL, badgeDataURL)
            );
        },
        returnIconWithBadge: (dataURL: string) => invoke<void>(IpcEvents.GET_ICON_WITH_BADGE, dataURL)
    },
    debug: {
        launchGpu: () => invoke<void>(IpcEvents.DEBUG_LAUNCH_GPU),
        launchWebrtcInternals: () => invoke<void>(IpcEvents.DEBUG_LAUNCH_WEBRTC_INTERNALS)
    },
    commands: {
        onCommand(cb: (message: IpcMessage) => void) {
            ipcRenderer.on(IpcEvents.IPC_COMMAND, (_, message) => cb(message));
        },
        respond: (response: IpcResponse) => ipcRenderer.send(IpcEvents.IPC_COMMAND, response)
    }
};
