/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { findByCodeLazy } from "@vencord/types/webpack";
import { keybindCallbacks } from "renderer";

import { addPatch } from "./shared";
import { Card } from "@vencord/types/webpack/common";
const toShortcutString = findByCodeLazy('.MOUSE_BUTTON?"mouse".concat(');
const actionReadableNames: { [key: string]: string } = {
    PUSH_TO_TALK: "Push To Talk",
    PUSH_TO_TALK_PRIORITY: "Push To Talk (Priority)",
    PUSH_TO_MUTE: "Push To Mute",
    TOGGLE_MUTE: "Toggle Mute",
    TOGGLE_DEAFEN: "Toggle Deafen",
    TOGGLE_VOICE_MODE: "Toggle Voice Activity Mode",
    TOGGLE_STREAMER_MODE: "Toggle Streamer Mode",
    TOGGLE_CAMERA: "Toggle Camera",
    NAVIGATE_BACK: "Navigate Back",
    NAVIGATE_FORWARD: "Navigate Forward",
    DISCONNECT_FROM_VOICE_CHANNEL: "Disconnect From Voice Channel"
};
const keybinds: { id: string; name?: string; shortcut?: string }[] = [];
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
                    // eslint-disable-next-line no-useless-escape
                    match: /\.keybindGroup,\i.card\),children:\[/g,
                    replace: "$&$self.keybindIdComponent(this.props.keybind.id),"
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
                    match: /:\(\i\.\i\.disable\(\)(.*?)\i\(\)\)/,
                    replace: "$&;$self.setKeybinds();" // for when the user opens and closes the keybinds settings page
                },
                {
                    // eslint-disable-next-line no-useless-escape
                    match: /let{keybinds:(\i)}=\i;/,
                    replace: "$&$self.xdpRegisterKeybinds($1);"
                },
                {
                    // eslint-disable-next-line no-useless-escape
                    match: /location:"KeybindsStore"},\q\)\)/, // same function as above (where xdpRegisterKeybinds is called)
                    replace: "$&;$self.setKeybinds();" // for when discord is opened
                }
            ]
        }
    ],

    registerKeybind: function (
        id: number,
        shortcut,
        callback: Function,
        options: {
            keyup: boolean;
            keydown: boolean;
        }
    ) {
        if (VesktopNative.keybind.needsXdp()) return;

        var idStr = id.toString();
        keybindCallbacks[idStr] = {
            onTrigger: callback,
            keyEvents: options
        };

        keybinds.push({
            id: idStr,
            shortcut: toShortcutString(shortcut)
        });
    },
    unregisterKeybind: function (id: number) {
        if (VesktopNative.keybind.needsXdp()) return;

        var idStr = id.toString();
        delete keybindCallbacks[idStr];
        keybinds.splice(
            keybinds.findIndex(x => x.id === idStr),
            1
        );
    },
    setKeybinds: function () {
        if (VesktopNative.keybind.needsXdp()) return;
        VesktopNative.keybind.setKeybinds(keybinds);
    },
    // only used for wayland/xdg-desktop-portal globalshortcuts
    xdpRegisterKeybinds: function (allActions: {
        [action: string]: {
            onTrigger: Function;
            keyEvents: {
                keyup: boolean;
                keydown: boolean;
            };
        };
    }) {
        if (!VesktopNative.keybind.needsXdp()) return;
        Object.entries(allActions).forEach(([key, val]) => {
            if (actionReadableNames[key] == null) {
                return;
            }
            keybindCallbacks[key] = {
                onTrigger: (keyState: boolean) =>
                    val.onTrigger(keyState, {
                        // switch to channel also requires some extra properties that would have to be supplied here
                        context: undefined
                    }),
                keyEvents: val.keyEvents
            };
            keybinds.push({ id: key, name: actionReadableNames[key] || key });
        });
        VesktopNative.keybind.setKeybinds(keybinds);
    },
    keybindIdComponent: function (id) {
        return <span style={{ color: "var(--text-muted)" }}>ID: {id}</span>;
    },
    xdpWarning: function (keybinds) {
        if (!VesktopNative.keybind.needsXdp()) {
            return (
                <>
                    {keybinds}
                    <Card
                        style={{
                            padding: "1rem",
                            color: "var(--text-normal)",
                            backgroundColor: "var(--info-warning-background)",
                            border: "1px solid var(--info-warning-foreground)"
                        }}
                    >
                        The ID specified for each keybind is for use in the keybind CLI. You don't have to use this for
                        configuring keybinds. This is just in case you want to trigger keybinds from external programs.
                    </Card>
                </>
            );
        }
        return (
            <Card
                style={{
                    padding: "1rem",
                    color: "var(--text-normal)",
                    backgroundColor: "var(--info-warning-background)",
                    border: "1px solid var(--info-warning-foreground)"
                }}
            >
                <p>
                    You appear to be using Vesktop on a platform that requires XDG desktop portals for using keybinds.
                    You can configure keybinds using your desktop environment's settings.
                </p>
                <p>
                    If your desktop environment does not support the GlobalShortcuts portal you can manually bind your
                    desired keybinds to CLI triggers.
                </p>
                <p>List of valid keybind IDs to use with the CLI:</p>
                <ul>
                    {keybinds.map(keybind => (
                        <li>
                            {keybind.id}: {keybind.name}
                        </li>
                    ))}
                </ul>
            </Card>
        );
    }
});
