/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addPatch } from "./shared";

addPatch({
    patches: [
        {
            find: '"NotificationSettingsStore',
            replacement: {
                // FIXME: fix eslint rule
                // eslint-disable-next-line no-useless-escape
                match: /\.isPlatformEmbedded(?=\?\i\.\i\.ALL)/g,
                replace: "$&||true"
            }
        }
    ]
});
