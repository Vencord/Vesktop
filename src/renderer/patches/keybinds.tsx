/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { findByCodeLazy } from "@vencord/types/webpack";
import { keybindCallbacks } from "renderer";

import { addPatch } from "./shared";
import { ErrorCard } from "@vencord/types/components";
const toShortcutString = findByCodeLazy('return"gamepad".');
const actionReadableNames: { [key: string]: string } = {
    PUSH_TO_TALK: "Push To Talk",
    PUSH_TO_TALK_PRIORITY: "Push To Talk (Priority)",
    PUSH_TO_MUTE: "Push To Mute",
    TOGGLE_MUTE: "Toggle Mute",
    TOGGLE_DEAFEN: "Toggle Deafen",
    TOGGLE_VOICE_MODE: "Toggle Voice Activity Mode",
    TOGGLE_STREAMER_MODE: "Toggle Streamer Mode",
    NAVIGATE_BACK: "Navigate Back",
    NAVIGATE_FORWARD: "Navigate Forward",
    DISCONNECT_FROM_VOICE_CHANNEL: "Disconnect From Voice Channel"
};
addPatch({
    patches: [
        {
            find: "keybindActionTypes",
            replacement: [
                {
                    // eslint-disable-next-line no-useless-escape
                    match: /(\i\.isPlatformEmbedded\?)(.+renderEmpty\(\i\)\]\}\)\]\}\))/,
                    replace: "$1$self.xdpWarning($2)"
                },
                {
                    // eslint-disable-next-line no-useless-escape
                    match: /\i\.isPlatformEmbedded/g,
                    replace: "true"
                },
                {
                    // eslint-disable-next-line no-useless-escape
                    match: /\(0,\i\.isDesktop\)\(\)/g,
                    replace: "true"
                },
                {
                    // THIS PATCH IS TEMPORARY
                    // eslint-disable-next-line no-useless-escape
                    match: /\.keybindGroup,\i.card\),children:\[/g,
                    replace: "$&`ID: ${this.props.keybind.id}`,"
                }
            ]
        },
        {
            find: "[kb store] KeybindStore",
            replacement: [
                {
                    // eslint-disable-next-line no-useless-escape
                    match: /inputEventRegister\((parseInt\(\i\),\i,\i,\i)\);else\{/,
                    replace: "$&$self.registerKeybind($1);return;"
                },
                {
                    // eslint-disable-next-line no-useless-escape
                    match: /inputEventUnregister\((parseInt\(\i,10\))\);else/,
                    replace: "$&{$self.unregisterKeybind($1);return;}"
                },
                {
                    // eslint-disable-next-line no-useless-escape
                    match: /let{keybinds:(\i)}=\i;/,
                    replace: "$&$self.preRegisterKeybinds($1);"
                }
            ]
        }
    ],

    registerKeybind: function (id, shortcut, callback, options) {
        if (VesktopNative.keybind.shouldPreRegister()) {
            return;
        }
        keybindCallbacks[id] = callback;
        VesktopNative.keybind.register(id, toShortcutString(shortcut), options);
    },
    unregisterKeybind: function (id) {
        if (VesktopNative.keybind.shouldPreRegister()) {
            return;
        }
        delete keybindCallbacks[id];
        VesktopNative.keybind.unregister(id);
    },
    // only used for wayland/xdg-desktop-portal globalshortcuts
    preRegisterKeybinds: function (allActions: {
        [action: string]: {
            onTrigger: Function;
        };
    }) {
        const actions: { id: number; name: string }[] = [];
        if (!VesktopNative.keybind.shouldPreRegister()) {
            return;
        }
        let id = 1;
        Object.entries(allActions).forEach(([key, val]) => {
            if (
                [
                    "UNASSIGNED",
                    "SWITCH_TO_VOICE_CHANNEL",
                    "TOGGLE_OVERLAY",
                    "TOGGLE_OVERLAY_INPUT_LOCK",
                    "TOGGLE_PRIORITY_SPEAKER",
                    "OVERLAY_ACTIVATE_REGION_TEXT_WIDGET",
                    "TOGGLE_GO_LIVE_STREAMING", // ???
                    "SOUNDBOARD",
                    "SOUNDBOARD_HOLD",
                    "SAVE_CLIP"
                    // most of these aren't available to change through discord as far as i can tell
                ].includes(key)
            ) {
                return;
            }
            // the second argument in onTrigger seems to hold some context in some specific actions
            // as far as i can tell these are the only actions that use it: push to talk (except it doesn't seem to do anything there??)
            // and switch to voice channel which requires a channel parameter which is provided through discord's ui
            // except we can't really provide that with xdp so i'll just skip it for now
            keybindCallbacks[id] = (keyState: boolean) => val.onTrigger(keyState, undefined);
            actions.push({ id, name: actionReadableNames[key] || key });
            id++;
        });
        VesktopNative.keybind.preRegister(actions);
    },
    xdpWarning: function (keybinds) {
        if (!VesktopNative.keybind.shouldPreRegister()) {
            return keybinds;
        }
        return (
            <ErrorCard>
                <p>
                    You appear to be using Vesktop on a platform that requires XDG desktop portals for using keybinds.
                    You can configure keybinds using your desktop environment's built-in settings page.
                </p>
                <p>
                    If your desktop environment does not support the GlobalShortcuts portal you have to manually bind
                    your desired keybinds to CLI triggers.
                </p>
            </ErrorCard>
        );
    }
});
