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

function getExactDeviceId(deviceId?: string) {
    if (!deviceId || deviceId === "None" || deviceId === "default") {
        return void 0;
    }

    return {
        exact: deviceId
    };
}

async function replaceAudioTrack(stream: MediaStream, deviceId: string) {
    const exactDeviceId = getExactDeviceId(deviceId);
    const audio = await navigator.mediaDevices.getUserMedia({
        audio: {
            ...(exactDeviceId ? { deviceId: exactDeviceId } : {}),
            autoGainControl: false,
            echoCancellation: false,
            noiseSuppression: false,
            channelCount: 2,
            sampleRate: 48000,
            sampleSize: 16
        }
    });

    stream.getAudioTracks().forEach(track => {
        stream.removeTrack(track);
        track.stop();
    });
    stream.addTrack(audio.getAudioTracks()[0]);
}

async function replaceVideoTrackWithCamera(
    stream: MediaStream,
    deviceId: string,
    width: number,
    height: number,
    frameRate: number
) {
    const exactDeviceId = getExactDeviceId(deviceId);
    const cameraStream = await navigator.mediaDevices.getUserMedia({
        video: {
            ...(exactDeviceId ? { deviceId: exactDeviceId } : {}),
            frameRate: { ideal: frameRate },
            width: { ideal: width },
            height: { ideal: height }
        }
    });

    stream.getVideoTracks().forEach(track => {
        stream.removeTrack(track);
        track.stop();
    });
    stream.addTrack(cameraStream.getVideoTracks()[0]);
}

navigator.mediaDevices.getDisplayMedia = async function (opts) {
    const stream = await original.call(this, opts);

    const frameRate = Number(State.store.screenshareQuality?.frameRate ?? 30);
    const height = Number(State.store.screenshareQuality?.resolution ?? 720);
    const width = Math.round(height * (16 / 9));

    if (currentSettings?.cameraDeviceId && currentSettings.cameraDeviceId !== "None") {
        await replaceVideoTrackWithCamera(stream, currentSettings.cameraDeviceId, width, height, frameRate).catch(e =>
            logger.error("Failed to replace stream video with selected camera.", e)
        );
    }

    const track = stream.getVideoTracks()[0];
    track.contentHint = String(currentSettings?.contentHint);

    const constraints = {
        ...track.getConstraints(),
        frameRate: { min: frameRate, ideal: frameRate },
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

    const audioInputDeviceId = currentSettings?.audioInputDeviceId;
    if (currentSettings?.audio !== false && audioInputDeviceId && audioInputDeviceId !== "None") {
        await replaceAudioTrack(stream, audioInputDeviceId).catch(e =>
            logger.error("Failed to replace stream audio with selected microphone.", e)
        );
        return stream;
    }

    if (isLinux) {
        const id = await getVirtmic();
        if (id) {
            await replaceAudioTrack(stream, id).catch(e => logger.error("Failed to replace stream audio.", e));
        }
    }

    return stream;
};
