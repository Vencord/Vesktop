/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app } from "electron";
import { XDPShortcut } from "libvesktop";
import { IpcCommands } from "shared/IpcEvents";
import { ACTION_DESCRIPTIONS, keyNameToAccelerator, ShortcutAction } from "shared/utils/keybind";
import { EventType as UioET, uIOhook, UiohookKey, UiohookKeyboardEvent } from "uiohook-napi";

import { bindXDPShortcuts, destroyXDPShortcuts, initXDPGlobalShortcuts, onXDPShortcutEvent } from "./dbus";
import { sendRendererCommand } from "./ipcCommands";
import { Settings } from "./settings";

const isWayland =
    process.platform === "linux" &&
    (process.env.XDG_SESSION_TYPE === "wayland" || !!process.env.WAYLAND_DISPLAY) &&
    app.commandLine.getSwitchValue("ozone-platform") === "wayland";

const KEYCODE_TO_ACCELERATOR = new Map<number, string>();
for (const [name, code] of Object.entries(UiohookKey) as [string, number][]) {
    const key = keyNameToAccelerator(name);
    if (key !== null) KEYCODE_TO_ACCELERATOR.set(code, key);
}

interface KeyBind {
    key: string;
    mods: string[];
    callback: (keyup: boolean) => void;
}

const MODIFIER_NAMES = ["Ctrl", "Shift", "Alt", "Super"] as const;

/**
 * Splits an accelerator like "Ctrl+Shift+M" into the main key and the modifiers it requires.
 * Everything that isn't a modifier is the main key, which may itself be a multi-character name
 * such as "NumpadAdd".
 */
function parseAccelerator(accelerator: string): Omit<KeyBind, "callback"> {
    const mods: string[] = [];
    const keys: string[] = [];

    for (const part of accelerator.split("+")) {
        if ((MODIFIER_NAMES as readonly string[]).includes(part)) mods.push(part);
        else keys.push(part);
    }

    return { key: keys.join("+"), mods: mods.sort() };
}

function eventModifiers(event: UiohookKeyboardEvent): string[] {
    const mods: string[] = [];
    if (event.ctrlKey) mods.push("Ctrl");
    if (event.shiftKey) mods.push("Shift");
    if (event.altKey) mods.push("Alt");
    if (event.metaKey) mods.push("Super");
    return mods.sort();
}

function sameModifiers(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((mod, i) => mod === b[i]);
}

/** main key -> every bind that uses it */
const registeredKeys = new Map<string, KeyBind[]>();
/** binds whose keydown already fired and which are waiting for their keyup */
const activeKeyBinds = new Set<KeyBind>();
let running = false;

function handleKeyEvent(event: UiohookKeyboardEvent) {
    const key = KEYCODE_TO_ACCELERATOR.get(event.keycode);
    if (!key) return;

    const binds = registeredKeys.get(key);
    if (!binds?.length) return;

    const isRelease = event.type === UioET.EVENT_KEY_RELEASED;

    if (isRelease) {
        // Only release binds that actually fired on keydown. Checking the modifiers again here
        // would lose the keyup as soon as the user lets go of Ctrl/Shift first, which leaves
        // push-to-talk stuck open.
        for (const bind of binds) {
            if (!activeKeyBinds.delete(bind)) continue;
            bind.callback(true);
        }
        return;
    }

    const mods = eventModifiers(event);
    for (const bind of binds) {
        // Already held: this is the OS auto-repeat, ignore it
        if (activeKeyBinds.has(bind) || !sameModifiers(bind.mods, mods)) continue;
        activeKeyBinds.add(bind);
        bind.callback(false);
    }
}

const onKeyDown = (e: UiohookKeyboardEvent) => handleKeyEvent(e);
const onKeyUp = (e: UiohookKeyboardEvent) => handleKeyEvent(e);

function registerKey(accelerator: string, callback: (keyup: boolean) => void): boolean {
    if (isWayland) return false;

    const { key, mods } = parseAccelerator(accelerator);
    const bind: KeyBind = { key, mods, callback };

    const existing = registeredKeys.get(key);
    if (existing) existing.push(bind);
    else registeredKeys.set(key, [bind]);

    if (!running) {
        running = true;
        uIOhook.on("keydown", onKeyDown);
        uIOhook.on("keyup", onKeyUp);
        uIOhook.start();
    }
    return true;
}

function unregisterAllKeys(): void {
    registeredKeys.clear();
    activeKeyBinds.clear();
    if (running) {
        uIOhook.stop();
        uIOhook.off("keydown", onKeyDown);
        uIOhook.off("keyup", onKeyUp);
        running = false;
    }
}

const XDP_PREFFERED: Partial<Record<ShortcutAction, string>> = {
    toggleDeafen: "CTRL+SHIFT+D",
    toggleMute: "CTRL+SHIFT+M"
};
export const XDP_SHORTCUTS: XDPShortcut[] = (Object.entries(ACTION_DESCRIPTIONS) as [ShortcutAction, string][])
    .filter(([id]) => id !== "unassigned")
    .map(([id, description]) => ({
        id,
        description,
        ...(XDP_PREFFERED[id] && { preferred_trigger: XDP_PREFFERED[id] })
    }));

async function registerXDPKeyBinds() {
    if (running) return;
    try {
        await initXDPGlobalShortcuts();
        onXDPShortcutEvent("portalVersion", ver => {
            sendRendererCommand(IpcCommands.KEY_BINDS_SET_STATUS, ver);
        });
        bindXDPShortcuts(XDP_SHORTCUTS);
        onXDPShortcutEvent("shortcutEvent", (id, pressed) => {
            sendRendererCommand(IpcCommands.KEY_BINDS_HANDLE, { action: id, keyup: !pressed });
        });
        onXDPShortcutEvent("shortcutsBound", arr => {
            sendRendererCommand(IpcCommands.KEY_BINDS_WUPDATE, arr);
        });
        onXDPShortcutEvent("error", err => console.error(err));
        sendRendererCommand(IpcCommands.KEY_BINDS_SET_STATUS, true);
        running = true;
    } catch (e) {
        console.error("Failed to initialize XDP global shortcuts:", e);
        sendRendererCommand(IpcCommands.KEY_BINDS_SET_STATUS, false);
    }
}

export async function registerKeyBinds() {
    await app.whenReady();
    unregisterAllKeys();

    if (isWayland) {
        // we dont care what the user creates
        registerXDPKeyBinds();
        return;
    }

    {
        // X11/Win/Mac
        let success = true;
        for (const { action, enabled, key } of Settings.store.keyBinds || []) {
            if (!enabled || !key || action === "unassigned") continue;
            success &&= registerKey(key, keyup => sendRendererCommand(IpcCommands.KEY_BINDS_HANDLE, { action, keyup }));
        }
        sendRendererCommand(IpcCommands.KEY_BINDS_SET_STATUS, success);
    }
}

Settings.addChangeListener("keyBinds", registerKeyBinds);
app.on("will-quit", () => {
    unregisterAllKeys();
    destroyXDPShortcuts();
});
