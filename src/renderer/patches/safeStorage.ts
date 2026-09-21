/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findByPropsLazy, onceReady } from "@vencord/types/webpack";
import { FluxDispatcher } from "@vencord/types/webpack/common";

import { addPatch } from "./shared";

const SafeStorageModule = findByPropsLazy("encryptAndStoreTokens");

addPatch({
    patches: [
        {
            find: ".safeStorage",
            all: true,
            replacement: {
                match: /&&\((\i)=\i\.safeStorage\)/,
                replace: "||($1=VesktopNative.safeStorage)"
            }
        }
    ]
});

onceReady.then(() => {
    FluxDispatcher.subscribe("CONNECTION_OPEN", () => SafeStorageModule.encryptAndStoreTokens());
});
