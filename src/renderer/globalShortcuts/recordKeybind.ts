/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isMac, isWindows } from "renderer/utils";
import { sortKeys } from "shared/utils/keybind";

const MODIFIER_CODES: Record<string, string> = {
    ControlLeft: "Control",
    ControlRight: "Control",
    ShiftLeft: "Shift",
    ShiftRight: "Shift",
    AltLeft: "Alt",
    AltRight: "Alt",
    MetaLeft: "Meta",
    MetaRight: "Meta"
};

// MouseEvent.button: 1 is middle, 3 is back and 4 is forward. Same numbering as the input hook
const MOUSE_BUTTONS: Record<number, string> = {
    1: "Mouse3",
    3: "Mouse4",
    4: "Mouse5"
};

// Keys the input hook can detect, besides modifiers and mouse buttons
const SUPPORTED_KEY = new RegExp(
    "^(" +
        [
            "Key[A-Z]",
            "Digit\\d",
            "F([1-9]|1\\d|2[0-4])",
            "Numpad(\\d|Add|Subtract|Multiply|Divide|Decimal|Enter)",
            "Arrow(Up|Down|Left|Right)",
            "Backspace|Tab|Enter|CapsLock|Escape|Space|PageUp|PageDown|End|Home|Insert|Delete",
            "Semicolon|Equal|Comma|Minus|Period|Slash|Backquote|BracketLeft|Backslash|BracketRight|Quote",
            "NumLock|ScrollLock|PrintScreen"
        ].join("|") +
        ")$"
);

const DISPLAY_NAMES: Record<string, string> = {
    Control: "Ctrl",
    Alt: isMac ? "Option" : "Alt",
    Meta: isWindows ? "Win" : isMac ? "Cmd" : "Super",
    Escape: "Esc",
    Backquote: "`",
    Minus: "-",
    Equal: "=",
    BracketLeft: "[",
    BracketRight: "]",
    Backslash: "\\",
    Semicolon: ";",
    Quote: "'",
    Comma: ",",
    Period: ".",
    Slash: "/",
    NumpadAdd: "Num +",
    NumpadSubtract: "Num -",
    NumpadMultiply: "Num *",
    NumpadDivide: "Num /",
    NumpadDecimal: "Num .",
    NumpadEnter: "Num Enter"
};

function keyToDisplay(key: string) {
    if (DISPLAY_NAMES[key]) return DISPLAY_NAMES[key];

    const match = /^(Key|Digit|Arrow|Numpad|Mouse)(.+)$/.exec(key);
    if (!match) return key;

    const [, prefix, rest] = match;
    if (prefix === "Numpad") return `Num ${rest}`;
    if (prefix === "Mouse") return `Mouse ${rest}`;
    return rest;
}

export function keysToDisplay(keys: string[]) {
    return keys.map(keyToDisplay).join(" + ");
}

/**
 * Records a keybind: every key and mouse button held down until the first one is released.
 * Modifiers on their own are allowed, since they are popular for push to talk
 */
export function recordKeybind(signal: AbortSignal) {
    return new Promise<string[]>((resolve, reject) => {
        const keys = new Set<string>();
        // Aborted once recording finishes, to remove all listeners
        const done = new AbortController();

        const finish = () => {
            if (!keys.size) return;
            done.abort();
            resolve(sortKeys([...keys]));
        };

        const onKeyDown = (e: KeyboardEvent) => {
            e.preventDefault();
            e.stopImmediatePropagation();

            const key = MODIFIER_CODES[e.code] ?? e.code;
            if (MODIFIER_CODES[e.code] || SUPPORTED_KEY.test(key)) keys.add(key);
        };

        const onKeyUp = (e: KeyboardEvent) => {
            e.preventDefault();
            e.stopImmediatePropagation();
            finish();
        };

        const onMouseDown = (e: MouseEvent) => {
            const key = MOUSE_BUTTONS[e.button];
            if (!key) return;

            e.preventDefault();
            e.stopImmediatePropagation();
            keys.add(key);
        };

        const onMouseUp = (e: MouseEvent) => {
            if (!MOUSE_BUTTONS[e.button]) return;

            e.preventDefault();
            e.stopImmediatePropagation();
            finish();
        };

        const options = { capture: true, signal: AbortSignal.any([signal, done.signal]) };

        document.addEventListener("keydown", onKeyDown, options);
        document.addEventListener("keyup", onKeyUp, options);
        document.addEventListener("mousedown", onMouseDown, options);
        document.addEventListener("mouseup", onMouseUp, options);
        signal.addEventListener("abort", () => reject(signal.reason), { signal: done.signal });
    });
}
