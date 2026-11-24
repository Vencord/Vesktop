/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isMac, isWindows } from "renderer/utils";
import { KeyBind, sortKeys } from "shared/utils/keybind";

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

// Maps physical keys (KeyboardEvent.code) to what they type on the user's keyboard layout
let layoutMap: Map<string, string> | undefined;

export async function loadKeyboardLayout() {
    layoutMap = await (navigator as any).keyboard.getLayoutMap();
}

// Layout dependent Windows virtual key codes, named like the input hook reports them
const WINDOWS_OEM_KEYS: Record<number, string> = {
    0xba: "Semicolon",
    0xbb: "Equal",
    0xbc: "Comma",
    0xbd: "Minus",
    0xbe: "Period",
    0xbf: "Slash",
    0xc0: "Backquote",
    0xdb: "BracketLeft",
    0xdc: "Backslash",
    0xdd: "BracketRight",
    0xde: "Quote"
};

// The input hook matches physical keys, except on Windows where it gets the virtual key the layout assigns.
// So store the virtual key there, which keyCode is on Windows
function toBindKey(e: KeyboardEvent) {
    if (!isWindows) return e.code;

    const vk = e.keyCode;
    if (vk >= 0x30 && vk <= 0x39) return "Digit" + String.fromCharCode(vk);
    if (vk >= 0x41 && vk <= 0x5a) return "Key" + String.fromCharCode(vk);
    return WINDOWS_OEM_KEYS[vk] ?? e.code;
}

function keyToDisplay(key: string, label?: string) {
    // Windows binds store virtual keys, which we can't map to what they type, so they come with a label instead
    const typed = label ?? (isWindows ? undefined : layoutMap?.get(key));
    if (typed?.trim()) return typed.toUpperCase();
    if (DISPLAY_NAMES[key]) return DISPLAY_NAMES[key];

    const match = /^(Key|Digit|Arrow|Numpad|Mouse)(.+)$/.exec(key);
    if (!match) return key;

    const [, prefix, rest] = match;
    if (prefix === "Numpad") return `Num ${rest}`;
    if (prefix === "Mouse") return `Mouse ${rest}`;
    return rest;
}

export function keysToDisplay(keys: string[], labels?: Record<string, string>) {
    return keys.map(key => keyToDisplay(key, labels?.[key])).join(" + ");
}

/**
 * Records a keybind: every key and mouse button held down until the first one is released.
 * Modifiers on their own are allowed, since they are popular for push to talk
 */
export function recordKeybind(signal: AbortSignal) {
    return new Promise<Pick<KeyBind, "keys" | "labels">>((resolve, reject) => {
        const keys = new Set<string>();
        const labels: Record<string, string> = {};
        // Aborted once recording finishes, to remove all listeners
        const done = new AbortController();

        const finish = () => {
            if (!keys.size) return;
            done.abort();
            resolve({ keys: sortKeys([...keys]), labels: Object.keys(labels).length ? labels : undefined });
        };

        const onKeyDown = (e: KeyboardEvent) => {
            e.preventDefault();
            e.stopImmediatePropagation();

            const key = MODIFIER_CODES[e.code] ?? toBindKey(e);
            if (!MODIFIER_CODES[e.code] && !SUPPORTED_KEY.test(key)) return;

            keys.add(key);
            if (isWindows && Object.values(WINDOWS_OEM_KEYS).includes(key))
                labels[key] = layoutMap?.get(e.code) ?? e.key;
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
