/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addPatch } from "./shared";

interface RtpMap {
    codec: string;
    payload: number;
}

interface Fmtp {
    payload: number;
    config: string;
}

addPatch({
    patches: [
        {
            find: '"Unable to find a unique rtx SSRC!"',
            replacement: {
                // Discord takes the first H264 payload type in the offer, but its answer always describes that
                // payload type as packetization-mode=1;profile-level-id=42e01f. Chromium offers 42001f first, so
                // the answer renames it, and Chromium then gives H264 a new payload type on every later video
                // m-section while the voice server keeps sending the old one. Remote video on those m-sections
                // never decodes. Pick the payload type that Chromium itself offers for the codec Discord describes.
                match: /(function \i\((\i),(\i),\i,(\i),\i\)\{let \i=)\2\.find\(\i=>\i\.codec===\4\);/,
                replace: "$1$self.findPayload($2,$3,$4);"
            }
        }
    ],

    findPayload(rtp: RtpMap[], fmtp: Fmtp[], codec: string) {
        const matches = rtp.filter(r => r.codec === codec);
        if (codec !== "H264") return matches[0];

        return (
            matches.find(r =>
                fmtp.some(
                    f =>
                        f.payload === r.payload &&
                        f.config.includes("packetization-mode=1") &&
                        f.config.toLowerCase().includes("profile-level-id=42e01f")
                )
            ) ?? matches[0]
        );
    }
});
