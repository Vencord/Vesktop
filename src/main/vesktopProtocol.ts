/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app, protocol } from "electron";

import { handleVesktopAssetsProtocol } from "./userAssets";
import { handleVesktopStaticProtocol } from "./vesktopStatic";

app.whenReady().then(() => {
    protocol.handle("vesktop", async req => {
        const url = new URL(req.url);

        switch (url.hostname) {
            case "assets":
                return handleVesktopAssetsProtocol(url.pathname, req);
            case "static":
                return handleVesktopStaticProtocol(url.pathname, req);
            default:
                return new Response(null, { status: 404 });
        }
    });
});
