/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A global keybind. Keys are KeyboardEvent.code names, except that left and right modifiers
 * are merged into "Control", "Shift", "Alt" and "Meta", and mouse buttons are "Mouse3" to "Mouse5"
 */
export interface KeyBind {
    id: string;
    action: ShortcutAction | "unassigned";
    keys: string[];
    enabled: boolean;
}

// Discord's global keybind action for each of our actions
export const ACTION_MAP = {
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
} as const;

export type ShortcutAction = keyof typeof ACTION_MAP;

export const ACTION_DESCRIPTIONS: Record<ShortcutAction, string> = {
    pushToTalk: "Push to Talk (Normal)",
    pushToTalkPriority: "Push to Talk (Priority)",
    pushToMute: "Push to Mute",
    vadPriority: "Voice Activity Priority",
    toggleMute: "Toggle Mute",
    toggleDeafen: "Toggle Deafen",
    toggleVAD: "Toggle Push to Talk / Voice Activity",
    toggleStreamerMode: "Toggle Streamer Mode",
    toggleCamera: "Toggle Camera",
    navigateBack: "Navigate Back",
    navigateForward: "Navigate Forward",
    disconnectFromVoiceChannel: "Disconnect from Voice Channel"
};

export const SHORTCUT_ACTIONS = Object.keys(ACTION_MAP) as ShortcutAction[];

export function isShortcutAction(action: string): action is ShortcutAction {
    return Object.hasOwn(ACTION_MAP, action);
}

/**
 * Parses "action", "action:down" or "action:up", as used by --run-shortcut and the IPC socket.
 * pressed is undefined if the action should be pressed and released
 */
export function parseShortcutCommand(command: string): { action: ShortcutAction; pressed?: boolean } | null {
    const [action, state, ...rest] = command.trim().split(":");
    if (rest.length || !isShortcutAction(action)) return null;

    switch (state) {
        case undefined:
            return { action };
        case "down":
            return { action, pressed: true };
        case "up":
            return { action, pressed: false };
        default:
            return null;
    }
}

export const MODIFIER_KEYS = ["Control", "Shift", "Alt", "Meta"];

// Modifiers first, in a fixed order, then everything else alphabetically
export function sortKeys(keys: string[]) {
    const rank = (key: string) => {
        const i = MODIFIER_KEYS.indexOf(key);
        return i === -1 ? MODIFIER_KEYS.length : i;
    };

    return keys.toSorted((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

export interface PortalShortcut {
    id: string;
    description: string;
    trigger: string;
}

export interface KeybindStatus {
    /** "hook" listens to all input (Windows, macOS, X11). "portal" uses the GlobalShortcuts portal (Wayland) */
    backend: "hook" | "portal";
    error?: string;
    /** macOS only. Accessibility permission is required to listen to input */
    needsPermission?: boolean;
    portalState?: "disabled" | "connecting" | "ready" | "unavailable";
    portalVersion?: number;
    /** Whether we can open the portal's shortcut settings, see configurePortal */
    portalConfigurable?: boolean;
    portalShortcuts?: PortalShortcut[];
}
