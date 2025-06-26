/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Settings } from "renderer/settings";

import { addPatch } from "./shared";

if (Settings.store.customTitleBar)
    addPatch({
        patches: [
            {
                find: ".wordmarkWindows",
                replacement: [
                    {
                        // TODO: Fix eslint rule
                        // eslint-disable-next-line no-useless-escape
                        match: /case \i\.\i\.WINDOWS:/,
                        replace: 'case "WEB":'
                    }
                ]
            },
            // Visual Refresh
            {
                find: ".systemBar,",
                replacement: [
                    {
                        // TODO: Fix eslint rule
                        // eslint-disable-next-line no-useless-escape
                        match: /\i===\i\.PlatformTypes\.WINDOWS/g,
                        replace: "true"
                    },
                    {
                        // TODO: Fix eslint rule
                        // eslint-disable-next-line no-useless-escape
                        match: /\i===\i\.PlatformTypes\.WEB/g,
                        replace: "false"
                    }
                ]
            }
        ]
    });
