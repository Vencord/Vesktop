/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isMac, isWindows } from "renderer/utils";
import { keyNameToAccelerator, NUMPAD_KEYS } from "shared/utils/keybind";

const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta", "Dead"]);

const DISPLAY_MAP: Record<string, string> = {
    ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`Numpad${i}`, `Num+${i}`])),
    NumpadMultiply: "Num+*",
    NumpadAdd: "Num+Plus",
    NumpadSubtract: "Num+-",
    NumpadDecimal: "Num+.",
    NumpadDivide: "Num+/",
    NumpadEnter: "Num+Enter",
    NumpadEnd: "Num+End",
    NumpadArrowDown: "Num+Down",
    NumpadPageDown: "Num+PgDn",
    NumpadArrowLeft: "Num+Left",
    NumpadArrowRight: "Num+Right",
    NumpadHome: "Num+Home",
    NumpadArrowUp: "Num+Up",
    NumpadPageUp: "Num+PgUp",
    NumpadInsert: "Num+Ins",
    NumpadDelete: "Num+Del",

    Super: isWindows ? "⊞ Win" : isMac ? "⌘ Cmd" : "Meta"
};
export function acceleratorToDisplay(accelerator: string): string {
    return accelerator
        .split("+")
        .map(t => DISPLAY_MAP[t] ?? t)
        .join(" + ");
}

function codeToAcceleratorKey(event: KeyboardEvent): string | null {
    const { code, key } = event;
    if (event.location === 3) {
        // Handle numlock shenanigans
        const last = code.at(-1)!;
        if (/\d/.test(last) && last !== key) {
            const numpad = "Numpad" + key;
            if (NUMPAD_KEYS.has(numpad)) return numpad;
        }
    }

    const letterMatch = /^Key([A-Z])$/.exec(code);
    if (letterMatch) return letterMatch[1]; // KeyA -> "A"
    const digitMatch = /^Digit(\d)$/.exec(code);
    if (digitMatch) return digitMatch[1]; // Digit0 -> "0"

    const fromMap = keyNameToAccelerator(code);
    if (fromMap !== null) return fromMap;

    return null;
}

export async function recordKeybind(signal?: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Recording aborted", "AbortError"));
            return;
        }

        const heldKeys: string[] = [];
        let capturedMods = { meta: false, ctrl: false, shift: false, alt: false };
        function cleanup() {
            document.removeEventListener("keydown", onKeyDown, { capture: true });
            document.removeEventListener("keyup", onKeyUp, { capture: true });
            signal?.removeEventListener("abort", onAbort);
        }

        function onAbort() {
            cleanup();
            reject(new DOMException("Recording aborted", "AbortError"));
        }

        function onKeyDown(event: KeyboardEvent) {
            event.preventDefault();
            event.stopImmediatePropagation();
            if (MODIFIER_KEYS.has(event.key)) return;

            const key = codeToAcceleratorKey(event);
            if (!key || heldKeys.includes(key)) return;

            // Update modifiers on every keydown
            capturedMods = {
                meta: event.metaKey,
                ctrl: event.ctrlKey,
                shift: event.shiftKey,
                alt: event.altKey
            };
            heldKeys.push(key);
        }
        function onKeyUp(event: KeyboardEvent) {
            event.preventDefault();
            event.stopImmediatePropagation();
            if (MODIFIER_KEYS.has(event.key)) return;
            if (heldKeys.length === 0) return;

            cleanup();

            const parts: string[] = [];
            if (capturedMods.meta) parts.push("Super");
            if (capturedMods.ctrl) parts.push("Ctrl");
            if (capturedMods.shift) parts.push("Shift");
            if (capturedMods.alt) parts.push("Alt");
            parts.push(...heldKeys.sort());
            resolve(parts.join("+"));
        }

        signal?.addEventListener("abort", onAbort, { once: true });
        document.addEventListener("keydown", onKeyDown, { capture: true });
        document.addEventListener("keyup", onKeyUp, { capture: true });
    });
}
