/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { systemPreferences } from "electron";
import { KeyBind, KeybindStatus, ShortcutAction } from "shared/utils/keybind";
import type { UiohookKeyboardEvent, UiohookMouseEvent } from "uiohook-napi";

import { triggerAction } from "./actions";

type Uiohook = typeof import("uiohook-napi");
type InputEvent = UiohookKeyboardEvent | UiohookMouseEvent;
type ActiveBind = KeyBind & { action: ShortcutAction };

// uiohook key names that differ from our key names (KeyboardEvent.code with merged modifiers)
const KEY_RENAMES: Record<string, string> = {
    Ctrl: "Control",
    CtrlRight: "Control",
    AltRight: "Alt",
    ShiftRight: "Shift",
    MetaRight: "Meta",
    // Numpad keys with NumLock off
    NumpadInsert: "Numpad0",
    NumpadEnd: "Numpad1",
    NumpadArrowDown: "Numpad2",
    NumpadPageDown: "Numpad3",
    NumpadArrowLeft: "Numpad4",
    NumpadArrowRight: "Numpad6",
    NumpadHome: "Numpad7",
    NumpadArrowUp: "Numpad8",
    NumpadPageUp: "Numpad9",
    NumpadDelete: "NumpadDecimal"
};

const MODIFIER_FLAGS = {
    Control: "ctrlKey",
    Shift: "shiftKey",
    Alt: "altKey",
    Meta: "metaKey"
} as const;

let uiohook: Uiohook | null = null;
let keyNames = new Map<number, string>();
let running = false;

let binds: ActiveBind[] = [];
const heldKeys = new Set<string>();
const activeBinds = new Set<ActiveBind>();

function toKeyName(uiohookName: string) {
    if (/^[A-Z]$/.test(uiohookName)) return "Key" + uiohookName;
    if (/^\d$/.test(uiohookName)) return "Digit" + uiohookName;
    return KEY_RENAMES[uiohookName] ?? uiohookName;
}

function loadUiohook() {
    if (!uiohook) {
        uiohook = require("uiohook-napi") as Uiohook;
        keyNames = new Map(Object.entries(uiohook.UiohookKey).map(([name, code]) => [code, toKeyName(name)]));
    }

    return uiohook;
}

function press(key: string) {
    // Held keys repeat their keydown event
    if (heldKeys.has(key)) return;
    heldKeys.add(key);

    // Other keys may be held too, so push to talk keeps working while moving in a game
    for (const bind of binds) {
        if (!activeBinds.has(bind) && bind.keys.includes(key) && bind.keys.every(k => heldKeys.has(k))) {
            activeBinds.add(bind);
            triggerAction(bind.action, true);
        }
    }
}

function release(key: string) {
    heldKeys.delete(key);

    for (const bind of activeBinds) {
        if (bind.keys.includes(key)) {
            activeBinds.delete(bind);
            triggerAction(bind.action, false);
        }
    }
}

function releaseAll() {
    for (const key of heldKeys) release(key);
}

// A modifier release can be missed, for example when the lock screen grabs input. The flags of later events tell us
function syncModifiers(event: InputEvent, key?: string) {
    for (const [modifier, flag] of Object.entries(MODIFIER_FLAGS)) {
        if (modifier !== key && heldKeys.has(modifier) && !event[flag]) release(modifier);
    }
}

function onKeyDown(event: UiohookKeyboardEvent) {
    const key = keyNames.get(event.keycode);
    syncModifiers(event, key);
    if (key) press(key);
}

function onKeyUp(event: UiohookKeyboardEvent) {
    const key = keyNames.get(event.keycode);
    syncModifiers(event, key);
    if (key) release(key);
}

// 1 and 2 are left and right click, which we don't allow binding
const mouseKey = (event: UiohookMouseEvent) => {
    const button = event.button as number;
    return button >= 3 && button <= 5 ? `Mouse${button}` : null;
};

function onMouseDown(event: UiohookMouseEvent) {
    syncModifiers(event);
    const key = mouseKey(event);
    if (key) press(key);
}

function onMouseUp(event: UiohookMouseEvent) {
    syncModifiers(event);
    const key = mouseKey(event);
    if (key) release(key);
}

function start() {
    const { uIOhook } = loadUiohook();
    if (running) return;

    uIOhook.on("keydown", onKeyDown);
    uIOhook.on("keyup", onKeyUp);
    uIOhook.on("mousedown", onMouseDown);
    uIOhook.on("mouseup", onMouseUp);
    try {
        uIOhook.start();
    } catch (err) {
        uIOhook.removeAllListeners();
        throw err;
    }
    running = true;
}

export function stopHook() {
    releaseAll();
    if (!running) return;

    uiohook!.uIOhook.stop();
    uiohook!.uIOhook.removeAllListeners();
    running = false;
}

/** Listens for the given binds, only running the input hook while there are any */
export function setHookBinds(newBinds: KeyBind[]): Omit<KeybindStatus, "backend"> {
    releaseAll();
    binds = newBinds.filter((b): b is ActiveBind => b.enabled && b.action !== "unassigned" && b.keys.length > 0);

    if (!binds.length) {
        stopHook();
        return {};
    }

    if (process.platform === "darwin" && !systemPreferences.isTrustedAccessibilityClient(false)) {
        stopHook();
        return { needsPermission: true };
    }

    try {
        start();
        return {};
    } catch (err) {
        console.error("Failed to start input hook:", err);
        return { error: `Failed to listen to input: ${err instanceof Error ? err.message : err}` };
    }
}
