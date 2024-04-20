/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { Logger } from "@vencord/types/utils";
import { currentSettings } from "renderer/components/ScreenSharePicker";
import { isLinux } from "renderer/utils";

const logger = new Logger("VesktopStreamFixes");

if (isLinux) {
    const originalMedia = navigator.mediaDevices.getDisplayMedia;
    const originalDevices = navigator.mediaDevices.enumerateDevices;

    async function getVirtmic() {
        try {
            const devices = await originalDevices();
            const audioDevice = devices.find(({ label }) => label === "vencord-screen-share");
            return audioDevice?.deviceId;
        } catch (error) {
            return null;
        }
    }

    navigator.mediaDevices.enumerateDevices = async function () {
        const result = await originalDevices.call(this);
        return result.filter(x => x.label !== "vencord-screen-share");
    };

    navigator.mediaDevices.getDisplayMedia = async function (opts) {
        const stream = await originalMedia.call(this, opts);
        const id = await getVirtmic();

        const frameRate = Number(currentSettings?.fps);
        const height = Number(currentSettings?.resolution);
        const width = Math.round(height * (16 / 9));
        const track = stream.getVideoTracks()[0];

        track.contentHint = String(currentSettings?.contentHint);

        const constraints = {
            ...track.getConstraints(),
            frameRate,
            width: { min: 640, ideal: width, max: width },
            height: { min: 480, ideal: height, max: height },
            advanced: [{ width: width, height: height }],
            resizeMode: "none"
        };

        track
            .applyConstraints(constraints)
            .then(() => {
                logger.info("Applied constraints successfully. New constraints: ", track.getConstraints());
            })
            .catch(e => logger.error("Failed to apply constraints.", e));

        if (id) {
            const audio = await navigator.mediaDevices.getUserMedia({
                audio: {
                    deviceId: {
                        exact: id
                    },
                    autoGainControl: false,
                    echoCancellation: false,
                    noiseSuppression: false
                }
            });
            audio.getAudioTracks().forEach(t => stream.addTrack(t));
        }

        return stream;
    };
}
