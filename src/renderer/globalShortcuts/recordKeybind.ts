/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta", "Dead"]);

const VALID_PUNCTUATION = new Set(')!@#$%^&*(;:=<,_-.>?/~`{][|\\}"');

// Codes whose accelerator name matches the code value exactly
const PASSTHROUGH_CODES = new Set([
    "Space",
    "Tab",
    "Backspace",
    "Delete",
    "Insert",
    "Home",
    "End",
    "PageUp",
    "PageDown",
    "PrintScreen",
    "Escape"
]);

// Codes that need an explicit rename
const CODE_MAP: Record<string, string> = {
    Enter: "Return",
    NumpadEnter: "Return",
    NumpadDecimal: "numdec",
    NumpadAdd: "numadd",
    NumpadSubtract: "numsub",
    NumpadMultiply: "nummult",
    NumpadDivide: "numdiv",
    CapsLock: "Capslock",
    NumLock: "Numlock",
    ScrollLock: "Scrolllock",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right"
};

const MEDIA_KEY_MAP: Record<string, string> = {
    AudioVolumeUp: "VolumeUp",
    AudioVolumeDown: "VolumeDown",
    AudioVolumeMute: "VolumeMute",
    MediaTrackNext: "MediaNextTrack",
    MediaTrackPrevious: "MediaPreviousTrack",
    MediaStop: "MediaStop",
    MediaPlayPause: "MediaPlayPause"
};

function codeToAcceleratorKey(event: KeyboardEvent): string | null {
    const { code, key } = event;

    // Letters: KeyA -> A
    const letterMatch = /^Key([A-Z])$/.exec(code);
    if (letterMatch) return letterMatch[1];

    // Digits: Digit0 -> 0
    const digitMatch = /^Digit(\d)$/.exec(code);
    if (digitMatch) return digitMatch[1];

    // Function keys: F1-F24
    if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code;

    // Numpad digits: Numpad0 -> num0
    const numpadDigitMatch = /^Numpad(\d)$/.exec(code);
    if (numpadDigitMatch) return "num" + numpadDigitMatch[1];

    if (PASSTHROUGH_CODES.has(code)) return code;
    if (code in CODE_MAP) return CODE_MAP[code];

    // Media / audio keys (identified by event.key)
    if (key in MEDIA_KEY_MAP) return MEDIA_KEY_MAP[key];

    // Punctuation keys
    if (key === "+") return "Plus";
    if (VALID_PUNCTUATION.has(key)) return key;

    return null;
}

export async function recordKeybind(signal?: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Recording aborted", "AbortError"));
            return;
        }

        function cleanup() {
            document.removeEventListener("keydown", onKeyDown, { capture: true });
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
            if (key === null) return;

            cleanup();

            const parts: string[] = [];
            if (event.ctrlKey) parts.push("Ctrl");
            if (event.shiftKey) parts.push("Shift");
            if (event.altKey) parts.push("Alt");
            if (event.metaKey) parts.push("Super");
            parts.push(key);

            resolve(parts.join("+"));
        }

        signal?.addEventListener("abort", onAbort, { once: true });
        document.addEventListener("keydown", onKeyDown, { capture: true });
    });
}
