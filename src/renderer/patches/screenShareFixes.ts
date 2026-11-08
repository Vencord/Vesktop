/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@vencord/types/utils";
import { FluxDispatcher } from "@vencord/types/webpack/common";
import { currentSettings } from "renderer/components/ScreenSharePicker";
import { State } from "renderer/settings";
import { isLinux } from "renderer/utils";

import { addPatch } from "./shared";

const logger = new Logger("VesktopStreamFixes");

const PRESET_CUSTOM = 3;

// resolution 0 means source resolution
function getStreamQuality() {
    const { resolution = "720", frameRate = "30" } = State.store.screenshareQuality ?? {};
    return { resolution: Number(resolution), frameRate: Number(frameRate) };
}

function getTrackConstraints(resolution: number, frameRate: number): MediaTrackConstraints {
    const constraints: MediaTrackConstraints = { frameRate: { ideal: frameRate, max: frameRate } };
    if (resolution) {
        constraints.width = { max: Math.round((resolution * 16) / 9) };
        constraints.height = { max: resolution };
    }
    return constraints;
}

// Roughly matches Discord's native 9Mbps for 1080p60, scaled by pixel rate
function getMaxBitrate(width: number, height: number, frameRate: number) {
    return Math.round(Math.min(Math.max(width * height * frameRate * 0.08, 3.5e6), 20e6));
}

// conn is the web MediaEngine's connection
function applyStreamQuality(conn: any, track: MediaStreamTrack) {
    const { resolution, frameRate } = getStreamQuality();
    const settings = track.getSettings();

    const width = settings.width ?? Math.round((resolution * 16) / 9);
    const height = settings.height ?? resolution;
    const size = { width, height, framerate: frameRate };
    const bitrateMax = getMaxBitrate(width, height, frameRate);

    conn.videoQualityManager.setGoliveQuality({ capture: size, encode: size, bitrateMax });

    const params = conn.videoStreamParameters.find((p: any) => p.quality === 100) ?? conn.videoStreamParameters[0];
    if (params) {
        params.maxResolution = resolution
            ? { type: "fixed", width: Math.round((resolution * 16) / 9), height: resolution }
            : { type: "source", width: 0, height: 0 };
    }

    logger.info("Applied stream quality", { width, height, frameRate, bitrateMax, track: settings });
}

addPatch({
    patches: [
        {
            // Web MediaEngine connection
            find: "BaseWebRTCConnection.updateVideoQuality",
            replacement: [
                {
                    // Discord derives quality from the track's constraints, ignoring frame rate and using a fixed bitrate
                    match: /(setDesktopInput=(\i)=>\{if\(null!=\2\)\{)let.{0,350}?this\.videoQualityManager\.setGoliveQuality\(\{encode:\i,capture:\i,bitrateMax:\i\}\)/,
                    replace: "$1$self.applyStreamQuality(this,$2.stream.getVideoTracks()[0])"
                },
                {
                    // Changing quality of an ongoing stream, e.g. via the Stream Settings context menu
                    match: /((\i)=this\.desktopInputPool\.get\((\i)\.desktopDescription\.id\);if\(null==\2\))return;/,
                    replace: "$1return $self.updateOngoingStream(this,$3);"
                }
            ]
        },
        {
            // Video quality manager
            find: "getDefaultGoliveQuality(){",
            replacement: {
                // When viewers want a smaller resolution, Discord lowers the bitrate but keeps encoding at the full
                // resolution. Lower the encode resolution too, like the native client does
                match: /(getGoliveQuality\(\i,(\i)\)\{.+?return new \i\(\{encode:)this\.goliveMaxQuality\.encode/,
                replace: "$1$self.scaleEncodeToSinkWants(this.goliveMaxQuality.encode,$2)"
            }
        },
        {
            // Stereo stream audio (sending and receiving) and a higher audio bitrate are behind an experiment
            // Force enable it
            find: 'push("web_screen_share_audio")',
            replacement: {
                match: /\i\.getConfig\(\{location:"RTCConnection"\}\)\.enabled(?=&&\i\.push\("web_screen_share_audio"\))/,
                replace: "true"
            }
        },
        {
            // Stream context menu. The Stream Settings submenu is only shown in the native client
            find: '"stream-settings-audio-enable"',
            replacement: {
                match: /\i\.isPlatformEmbedded(?=\?\(0,\i\.jsx\)\(\i\.\i,\{id:"stream-settings")/,
                replace: "true"
            }
        }
    ],

    applyStreamQuality(conn: any, track: MediaStreamTrack) {
        try {
            applyStreamQuality(conn, track);
        } catch (e) {
            logger.error("Failed to apply stream quality", e);
        }
    },

    scaleEncodeToSinkWants(encode: { width: number; height: number; framerate: number }, sinkPixelCount: number) {
        try {
            const scale = Math.sqrt(sinkPixelCount / (encode.width * encode.height));
            if (!(scale < 1)) return encode;

            return {
                ...encode,
                width: Math.round(encode.width * scale),
                height: Math.round(encode.height * scale)
            };
        } catch (e) {
            logger.error("Failed to scale encode to sink wants", e);
        }
    },

    async updateOngoingStream(engine: any, { quality }: { quality?: { resolution: number; frameRate: number } }) {
        try {
            if (!quality) return;

            State.store.screenshareQuality = {
                resolution: String(quality.resolution),
                frameRate: String(quality.frameRate)
            };

            const conns: any[] = [];
            engine.eachConnection((c: any) => c.streamUserId === c.userId && conns.push(c), "stream");

            for (const conn of conns) {
                const track: MediaStreamTrack | undefined = conn.input.getVideoStream()?.getVideoTracks()[0];
                if (!track) continue;

                try {
                    await track.applyConstraints(getTrackConstraints(quality.resolution, quality.frameRate));
                    applyStreamQuality(conn, track);
                    conn.updateVideoQuality();
                    conn.handleVideo(conn.input.getVideoStreamId());
                } catch (e) {
                    logger.error("Failed to update stream quality", e);
                }
            }
        } catch (e) {
            logger.error("Failed to update ongoing stream", e);
        }
    }
});

async function getVirtmic() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioDevice = devices.find(({ label }) => label === "vencord-screen-share");
        return audioDevice?.deviceId;
    } catch {
        return null;
    }
}

const originalGetDisplayMedia = navigator.mediaDevices.getDisplayMedia;
navigator.mediaDevices.getDisplayMedia = async function (opts) {
    // our picker runs while this is pending, so the quality is final once it resolves
    const stream = await originalGetDisplayMedia.call(this, opts);
    const { resolution, frameRate } = getStreamQuality();
    const track = stream.getVideoTracks()[0];

    if (currentSettings?.contentHint) track.contentHint = currentSettings.contentHint;

    try {
        await track.applyConstraints(getTrackConstraints(resolution, frameRate));
    } catch (e) {
        logger.error("Failed to apply constraints", e);
    }

    FluxDispatcher.dispatch({
        type: "STREAM_UPDATE_SETTINGS",
        preset: PRESET_CUSTOM,
        resolution,
        frameRate
    });

    const virtmicId = isLinux && (await getVirtmic());
    if (virtmicId) {
        const audio = await navigator.mediaDevices.getUserMedia({
            audio: {
                deviceId: {
                    exact: virtmicId
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
