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
        const url = decodeURI(req.url).slice("vesktop://".length);
        const [channel, ...pathParts] = url.split("/");
        const path = pathParts.join("/");

        if (channel === "assets") {
            return handleVesktopAssetsProtocol(path, req);
        }
        if (channel === "static") {
            return handleVesktopStaticProtocol(path, req);
        }

        return new Response(null, { status: 404 });
    });
});
