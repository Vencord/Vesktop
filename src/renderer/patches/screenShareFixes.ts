/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@vencord/types/utils";
import { currentSettings } from "renderer/components/ScreenSharePicker";
import { State } from "renderer/settings";
import { isLinux } from "renderer/utils";

const logger = new Logger("VesktopStreamFixes");

if (isLinux) {
    const original = navigator.mediaDevices.getDisplayMedia;

    async function getVirtmic() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioDevice = devices.find(({ label }) => label === "vencord-screen-share");
            return audioDevice?.deviceId;
        } catch (error) {
            return null;
        }
    }

    navigator.mediaDevices.getDisplayMedia = async function (opts) {
        const stream = await original.call(this, opts);
        const id = await getVirtmic();

        const contentHint = String(currentSettings?.contentHint);
        const frameRate = Number(State.store.screenshareQuality?.frameRate ?? 30);
        const height = Number(State.store.screenshareQuality?.resolution ?? 720);
        const width = Math.round(height * (16 / 9));
        const track = stream.getVideoTracks()[0];

        track.contentHint = contentHint;

        const constraints = {
            ...track.getConstraints(),
            ...getContentResolutionSettings(contentHint, { width, height }),
            frameRate: getContentFrameSettings(contentHint, frameRate)
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
                    noiseSuppression: false,
                    channelCount: 2,
                    sampleRate: 48000,
                    sampleSize: 16
                }
            });

            stream.getAudioTracks().forEach(t => stream.removeTrack(t));
            stream.addTrack(audio.getAudioTracks()[0]);
        }

        return stream;
    };
}

function getContentResolutionSettings(contentHint: string, targetResolution: { width: number; height: number }) {
    if (contentHint === "detail") {
        return {
            height: { min: targetResolution.height, ideal: targetResolution.height },
            width: { min: targetResolution.width, ideal: targetResolution.width }
        };
    }
    return {
        height: { ideal: targetResolution.height },
        width: { ideal: targetResolution.width }
    };
}

function getContentFrameSettings(contentHint: string, targetFrameRate: number) {
    if (contentHint === "motion") {
        return { min: targetFrameRate, ideal: targetFrameRate };
    }
    return {
        ideal: targetFrameRate
    };
}
