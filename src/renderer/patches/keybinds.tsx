/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Card } from "@vencord/types/webpack/common";
import { KeybindsSettingsPage } from "renderer/components/KeybindsSettings";
import { actionCallbacks, actionReadableNames } from "renderer/keybinds";

import { addPatch } from "./shared";

addPatch({
    patches: [
        {
            find: "keybindActionTypes",
            replacement: [
                {
                    // eslint-disable-next-line no-useless-escape
                    match: /\i\.isPlatformEmbedded\?.+renderEmpty\(\i\)\]\}\)\]\}\)/,
                    replace: "true?[$self.keybindsPage()]"
                }
            ]
        },
        {
            find: "[kb store] KeybindStore",
            replacement: [
                {
                    // eslint-disable-next-line no-useless-escape
                    match: /let{keybinds:(\i)}=\i;/,
                    replace: "$&$self.addActions($1);"
                }
            ]
        }
    ],

    addActions: function (allActions: {
        [action: string]: {
            onTrigger: Function;
            keyEvents: {
                keyup: boolean;
                keydown: boolean;
            };
        };
    }) {
        Object.entries(allActions).forEach(([key, val]) => {
            if (actionReadableNames[key] == null) return;

            actionCallbacks[key] = {
                onTrigger: (keyState: boolean) =>
                    val.onTrigger(keyState, {
                        // switch to channel also requires some extra properties that would have to be supplied here
                        context: undefined
                    }),
                keyEvents: val.keyEvents
            };
        });
        if (VesktopNative.keybind.needsXdp())
            VesktopNative.keybind.setKeybinds(
                Object.entries(actionReadableNames).map(a => ({
                    id: a[0],
                    name: a[1]
                }))
            );
    },
    keybindsPage: function () {
        return VesktopNative.keybind.needsXdp() ? (
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
                    {Object.entries(actionReadableNames).map(a => (
                        <li>
                            {a[0]}: {a[1]}
                        </li>
                    ))}
                </ul>
            </Card>
        ) : (
            <KeybindsSettingsPage />
        );
    }
});
