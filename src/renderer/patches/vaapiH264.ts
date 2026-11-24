/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import script from "file://../workers/vaapiH264.js";
import { Settings } from "renderer/settings";
import { isLinux } from "renderer/utils";

import { addPatch } from "./shared";

addPatch({
    patches: [
        {
            find: '"Encoded transforms not supported"',
            predicate: () => isLinux && Settings.store.hardwareVideoEncoding,
            group: true,
            replacement: [
                {
                    match: /(setupEncryptionWorker\(\)\{let \i=)new Worker\(/,
                    replace: "$1$self.createEncryptionWorker("
                },
                {
                    match: /(this\.setupEncodedTransforms\((\i)\.sender,\i\.ENCRYPT)\)/,
                    replace: '$1,$2.receiver?.track?.kind==="video")'
                },
                {
                    match: /(setupEncodedTransforms\(\i,\i)\)(\{.{0,160}?new RTCRtpScriptTransform\(this\.encryptionWorker,\{)operation:/,
                    replace: "$1,vesktopVideoSender)$2vesktopVideoSender,operation:"
                }
            ]
        }
    ],

    createEncryptionWorker(url: URL, options: WorkerOptions) {
        if (options.type === "module" || url.origin !== location.origin) {
            return new Worker(url, options);
        }

        const config = `const workerUrl = ${JSON.stringify(url.href)};\n`;
        const blobUrl = URL.createObjectURL(new Blob([config, script], { type: "text/javascript" }));
        try {
            return new Worker(blobUrl, options);
        } finally {
            URL.revokeObjectURL(blobUrl);
        }
    }
});
