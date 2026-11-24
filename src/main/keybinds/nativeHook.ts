/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { UiohookKeyboardEvent, UiohookMouseEvent } from "uiohook-napi";

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

export interface HookInput {
    key: string | null;
    pressed: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
    metaKey: boolean;
}

export type HookMessage = { type: "ready" } | { type: "input"; input: HookInput } | { type: "error"; message: string };

function toKeyName(uiohookName: string) {
    if (/^[A-Z]$/.test(uiohookName)) {
        return "Key" + uiohookName;
    }
    if (/^\d$/.test(uiohookName)) {
        return "Digit" + uiohookName;
    }
    return KEY_RENAMES[uiohookName] ?? uiohookName;
}

export function startNativeHook(onInput: (input: HookInput) => void) {
    const { UiohookKey, uIOhook } = require("uiohook-napi") as typeof import("uiohook-napi");
    const keyNames = new Map(Object.entries(UiohookKey).map(([name, code]) => [code, toKeyName(name)]));

    function sendInput(key: string | null, pressed: boolean, event: UiohookKeyboardEvent | UiohookMouseEvent) {
        const { ctrlKey, shiftKey, altKey, metaKey } = event;
        onInput({ key, pressed, ctrlKey, shiftKey, altKey, metaKey });
    }

    function onKeyboard(event: UiohookKeyboardEvent, pressed: boolean) {
        sendInput(keyNames.get(event.keycode) ?? null, pressed, event);
    }

    function onMouse(event: UiohookMouseEvent, pressed: boolean) {
        const button = event.button as number;
        // Ignore left and right click, which cannot be bound.
        sendInput(button >= 3 && button <= 5 ? `Mouse${button}` : null, pressed, event);
    }

    uIOhook.on("keydown", event => onKeyboard(event, true));
    uIOhook.on("keyup", event => onKeyboard(event, false));
    uIOhook.on("mousedown", event => onMouse(event, true));
    uIOhook.on("mouseup", event => onMouse(event, false));
    try {
        uIOhook.start();
    } catch (error) {
        uIOhook.removeAllListeners();
        throw error;
    }

    return () => {
        uIOhook.stop();
        uIOhook.removeAllListeners();
    };
}
