/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { UiohookKey } from "uiohook-napi";

// UiohookKey
const KEY_RENAMES: Partial<Record<string, string>> = {
    Enter: "Return",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    Delete: "Del",
    Insert: "Ins",
    PageUp: "PgUp",
    PageDown: "PgDn",
    Escape: "Esc"
} as const;

const EXCLUDED_KEYS = new Set(["Ctrl", "CtrlRight", "Alt", "AltRight", "Shift", "ShiftRight", "Meta", "MetaRight"]);
const KEY_TO_ACCELERATOR: Record<string, string> = Object.fromEntries(
    (Object.keys(UiohookKey) as string[])
        .filter(key => !EXCLUDED_KEYS.has(key))
        .map(key => [key, KEY_RENAMES[key] ?? key])
);

export function keyNameToAccelerator(name: string): string | null {
    return name in KEY_TO_ACCELERATOR ? KEY_TO_ACCELERATOR[name] : null;
}

export const NUMPAD_KEYS = new Set((Object.keys(UiohookKey) as string[]).filter(key => /^Numpad\D/.test(key)));

export const ACTION_MAP: Partial<Record<ShortcutAction, string>> = {
    pushToTalk: "PUSH_TO_TALK",
    pushToTalkPriority: "PUSH_TO_TALK_PRIORITY",
    pushToMute: "PUSH_TO_MUTE",
    vadPriority: "VAD_PRIORITY",
    toggleMute: "TOGGLE_MUTE",
    toggleDeafen: "TOGGLE_DEAFEN",
    toggleVAD: "TOGGLE_VOICE_MODE",
    toggleStreamerMode: "TOGGLE_STREAMER_MODE",
    toggleCamera: "TOGGLE_CAMERA",
    navigateBack: "NAVIGATE_BACK",
    navigateForward: "NAVIGATE_FORWARD",
    disconnectFromVoiceChannel: "DISCONNECT_FROM_VOICE_CHANNEL"
};

export const ACTION_DESCRIPTIONS = {
    unassigned: "Unassigned",
    pushToTalk: "Push-to-talk (Normal)",
    pushToTalkPriority: "Push-to-talk (Priority)",
    pushToMute: "Push-to-mute",
    vadPriority: "Voice Activity Priority",
    toggleMute: "Toggle Mute",
    toggleDeafen: "Toggle Deafen",
    toggleVAD: "Toggle PTT and Voice Activity",
    toggleStreamerMode: "Toggle Streamer Mode",
    toggleCamera: "Toggle Camera",
    navigateBack: "Navigate Back",
    navigateForward: "Navigate Forward",
    // connectToVoiceChannel
    disconnectFromVoiceChannel: "Disconnect from VC"
} as const;

export type ShortcutAction = keyof typeof ACTION_DESCRIPTIONS;
