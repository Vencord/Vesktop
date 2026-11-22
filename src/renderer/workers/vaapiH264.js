/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* global workerUrl */

function fixKeyframeHeaders(frame) {
    if (frame.type !== "key" || frame.getMetadata().mimeType !== "video/H264") {
        return;
    }

    const bytes = new Uint8Array(frame.data);
    const offsets = [];
    // Affected VA-API encoders emit the IDR slice before its SPS and PPS.
    const expectedTypes = [5, 7, 8];
    for (let i = 0; i + 3 < bytes.length; i++) {
        if (bytes[i] !== 0 || bytes[i + 1] !== 0 || bytes[i + 2] !== 1) {
            continue;
        }
        const start = i > 0 && bytes[i - 1] === 0 ? i - 1 : i;
        const type = bytes[i + 3] & 0x1f;
        if (type !== expectedTypes[offsets.length] || (offsets.length === 0 && start !== 0)) {
            return;
        }
        offsets.push(start);
        i += 2;
    }
    if (offsets.length !== expectedTypes.length) {
        return;
    }

    const sps = offsets[1];
    const ordered = new Uint8Array(bytes.length);
    ordered.set(bytes.subarray(sps));
    ordered.set(bytes.subarray(0, sps), bytes.length - sps);
    frame.data = ordered.buffer;
}

self.addEventListener("rtctransform", ({ transformer }) => {
    if (!transformer.options.vesktopVideoSender) {
        return;
    }

    const readable = transformer.readable.pipeThrough(
        new TransformStream({
            transform(frame, controller) {
                fixKeyframeHeaders(frame);
                controller.enqueue(frame);
            }
        })
    );
    Object.defineProperty(transformer, "readable", { value: readable });
});

// The blob worker must resolve Discord's initial chunks and subsequent WASM imports
// relative to the original worker script.
const load = self.importScripts.bind(self);
self.importScripts = (...urls) => load(...urls.map(path => new URL(path, workerUrl).href));
load(workerUrl);
self.webpackChunkdiscord_app.push([
    [],
    {},
    runtime => {
        runtime.b = workerUrl;
        runtime.p = new URL(runtime.p, workerUrl).href;
    }
]);
self.importScripts = load;
