/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { HookMessage, startNativeHook } from "./nativeHook";

function send(message: HookMessage) {
    process.parentPort.postMessage(message);
}

try {
    startNativeHook(input => send({ type: "input", input }));
    send({ type: "ready" });
} catch (error) {
    send({ type: "error", message: error instanceof Error ? error.message : String(error) });
}
