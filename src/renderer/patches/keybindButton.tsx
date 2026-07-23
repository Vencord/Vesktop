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
                match: /:(.{0,10}jsx.{0,50}messageType:.{0,100}#{intl::KEYBIND_IN_BROSWER_NOTICE})/,
                replace: ":true?$self.renderKeybindsButton():$1"
            }
        }
    ],

    renderKeybindsButton: ErrorBoundary.wrap(
        () => <Button onClick={() => openKeybindsModal()}>Configure Vesktop Keybinds</Button>,
        { noop: true }
    )
});
