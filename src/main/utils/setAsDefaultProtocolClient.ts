/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { execFile } from "child_process";
import { app } from "electron";

export async function setAsDefaultProtocolClient(protocol: string) {
    if (process.platform !== "linux") {
        return app.setAsDefaultProtocolClient(protocol);
    }

    // electron setAsDefaultProtocolClient uses xdg-settings instead of xdg-mime.
    // xdg-settings had a bug where it would also register the app as a handler for text/html,
    // aka become your browser. This bug was fixed years ago (xdg-utils 1.2.0) but Ubuntu ships
    // 7 (YES, SEVEN) years out of date xdg-utils which STILL has the bug.
    // FIXME: remove this workaround when Ubuntu updates their xdg-utils or electron switches to xdg-mime.

    const { CHROME_DESKTOP } = process.env;
    if (!CHROME_DESKTOP) return false;

    return new Promise<boolean>(resolve => {
        execFile("xdg-mime", ["default", CHROME_DESKTOP, `x-scheme-handler/${protocol}`], err => {
            resolve(err == null);
        });
    });
}
