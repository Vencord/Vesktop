/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button, ErrorBoundary } from "@vencord/types/components";
import { openKeybindsModal } from "renderer/globalShortcuts/ShortcutSettings";

import { addPatch } from "./shared";

addPatch({
    patches: [
        {
            find: "#{intl::KEYBIND_IN_BROSWER_NOTICE}",
            replacement: {
                match: /:(.{0,10}jsx.{0,50}message:.{0,100}#{intl::KEYBIND_IN_BROSWER_NOTICE})/,
                replace: ":true?$self.renderKeybindsButton():$1"
            }
        },
        // Push to talk in Voice & Video settings
        {
            find: '"PTT Limited Modal"',
            replacement: [
                // Don't warn that push to talk only works while focused
                {
                    match: /(===\i\.\i\.PUSH_TO_TALK&&)\i(?=&&.{0,400}"PTT Limited Modal")/,
                    replace: "$1false"
                },
                // Use the normal title instead of "Push-to-talk (Limited)"
                {
                    match: /(VOICE_PUSH_TO_TALK_SETTING,\{useTitle:function\(\)\{return )\i\.\i(?=\?)/,
                    replace: "$1true"
                },
                // Remove the subtitle telling you to download the desktop app
                {
                    match: /(?<=useSubtitle:function\(\)\{.{0,120}if\()!\i\.\i&&/,
                    replace: "false&&"
                },
                // Replace Discord's in-app recorder with our keybind settings
                {
                    match: /(VOICE_PUSH_TO_TALK_KEYBIND_SETTING,.+?layout:"horizontal-responsive",children:)\(0,\i\.jsxs\)\("div",\{className:\i\.\i,children:\[.+?\(0,\i\.jsx\)\(\i,\{shortcut:\i\}\)\]\}\)/,
                    replace: "$1$self.renderKeybindsButton()"
                }
            ]
        }
    ],

    renderKeybindsButton: ErrorBoundary.wrap(
        () => <Button onClick={() => openKeybindsModal()}>Configure Global Keybinds</Button>,
        { noop: true }
    )
});
