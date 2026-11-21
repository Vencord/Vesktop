/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { join } from "path";

import { systemPreferences, utilityProcess } from "electron";
import { KeyBind, KeybindStatus, ShortcutAction } from "shared/utils/keybind";

import { IS_FLATPAK } from "../constants";
import { setStatus, triggerAction } from "./actions";
import { HookInput, HookMessage, startNativeHook } from "./nativeHook";

type ActiveBind = KeyBind & { action: ShortcutAction };

const MODIFIER_FLAGS = {
    Control: "ctrlKey",
    Shift: "shiftKey",
    Alt: "altKey",
    Meta: "metaKey"
} as const;

let stopInput: (() => void) | null = null;
let binds: ActiveBind[] = [];
const heldKeys = new Set<string>();
const activeBinds = new Set<ActiveBind>();

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

function onInput(input: HookInput) {
    const { key, pressed } = input;

    // A modifier release can be missed, e.g. when the lock screen grabs input.
    for (const [modifier, flag] of Object.entries(MODIFIER_FLAGS)) {
        if (modifier !== key && heldKeys.has(modifier) && !input[flag]) {
            release(modifier);
        }
    }

    if (key) {
        if (pressed) {
            press(key);
        } else {
            release(key);
        }
    }
}

function hookError(message: string) {
    console.error("Failed to start input hook:", message);
    return { error: `Failed to listen to input: ${message}` };
}

function startFlatpakHook() {
    // libuiohook can deadlock with Zypak's host preload during dlopen.
    const child = utilityProcess.fork(join(__dirname, "hookProcess.js"), [], {
        serviceName: "Vesktop Global Keybinds"
    });

    function fail(message: string) {
        stopHook();
        setStatus(hookError(message));
    }

    const timeout = setTimeout(() => fail("Input hook startup timed out"), 5000);
    function stop() {
        clearTimeout(timeout);
        child.kill();
    }

    child.once("spawn", () => {
        if (stopInput !== stop) {
            child.kill();
        }
    });

    child.on("message", (message: HookMessage) => {
        if (stopInput !== stop) {
            return;
        }

        switch (message.type) {
            case "ready":
                clearTimeout(timeout);
                break;
            case "input":
                onInput(message.input);
                break;
            case "error":
                fail(message.message);
                break;
        }
    });

    child.on("exit", code => {
        if (stopInput === stop) {
            fail(`Input hook process exited (code ${code})`);
        }
    });

    return stop;
}

export function stopHook() {
    releaseAll();
    const stop = stopInput;
    stopInput = null;
    stop?.();
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
        stopInput ??= IS_FLATPAK ? startFlatpakHook() : startNativeHook(onInput);
        return {};
    } catch (error) {
        return hookError(error instanceof Error ? error.message : String(error));
    }
}
