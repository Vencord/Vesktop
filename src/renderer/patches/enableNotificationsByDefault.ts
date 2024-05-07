/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2024 Vendicated and Vencord contributors
 */

import { addPatch } from "./shared";

addPatch({
    patches: [
        {
            find: '"NotificationSettingsStore',
            replacement: {
                // FIXME: fix eslint rule
                // eslint-disable-next-line no-useless-escape
                match: /\.isPlatformEmbedded(?=\?\i\.DesktopNotificationTypes\.ALL)/g,
                replace: "$&||true"
            }
        }
    ]
});
