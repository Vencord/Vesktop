/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@vencord/types/utils";
import { filters, onceReady, waitFor } from "@vencord/types/webpack";
import { FluxDispatcher, MediaEngineStore, UserStore } from "@vencord/types/webpack/common";
import {
    currentSettings,
    getScreenShareConnectionVideoStreamParameters,
    getSelectedScreenShareBitrateProfile,
    getSelectedScreenShareProfile,
    scheduleCurrentUserScreenShareVideoStreamParameterSync,
    type ScreenShareVideoStreamParameters,
    syncSelectedScreenShareVideoStreamParameters
} from "renderer/components/ScreenSharePicker";
import { State } from "renderer/settings";
import { isLinux } from "renderer/utils";

const logger = new Logger("VesktopStreamFixes");

const screenShareRecoveryCooldownMs = 1000;
const screenShareTrackConstraintSyncCooldownMs = 1000;
const screenShareProfileChangeSyncDelaysMs = [0, 10, 50, 100, 250, 500, 1000, 2000];
const senderParameterSyncRetryDelayMs = 50;
const viewerAttachRecoveryDelayMs = 1000;
const viewerRejoinRecoveryDelayMs = 250;
const audienceRecoveryHealthProbeDelayMs = 300;

const managedScreenShareTracks = new WeakSet<MediaStreamTrack>();
const detailDisplayTracks = new WeakSet<MediaStreamTrack>();
const trackLocalConnectionHints = new WeakMap<MediaStreamTrack, MediaConnectionLike>();
const trackedPeerConnections = new WeakSet<RTCPeerConnection>();
const trackedScreenSharePeerConnections = new Set<RTCPeerConnection>();
const senderPeerConnections = new WeakMap<RTCRtpSender, RTCPeerConnection>();
const senderParameterSyncFailureCounts = new WeakMap<RTCRtpSender, number>();
const senderParameterSyncTasks = new WeakMap<RTCRtpSender, Promise<void>>();
const senderParameterSyncPending = new WeakMap<RTCRtpSender, boolean>();
const trackConstraintSyncTasks = new WeakMap<MediaStreamTrack, Promise<void>>();
const trackConstraintSyncPending = new WeakMap<MediaStreamTrack, boolean>();
const trackConstraintSyncPendingRequests = new WeakMap<MediaStreamTrack, PendingTrackConstraintSyncRequest>();
const recoveryManagedReplaceTrackSenders = new WeakSet<RTCRtpSender>();
const senderRecoveryStates = new WeakMap<RTCRtpSender, SenderRecoveryState>();
const trackConstraintSyncAttemptAt = new WeakMap<MediaStreamTrack, number>();
const directLocalScreenShareSinkWantsPatchedUpdateVideoQuality = new WeakMap<
    MediaConnectionLike,
    (...args: unknown[]) => unknown
>();
const directScreenShareSinkWantsPropertyPatchStates = new WeakMap<
    MediaConnectionLike,
    DirectScreenShareSinkWantsPropertyPatchState
>();
let activeDetailTrackSyncSequence = 0;
let viewerRejoinRecoveryTimer: number | undefined;
let viewerRejoinRecoverySequence = 0;

interface SenderRecoveryState {
    inRecovery: boolean;
    lastRecoveryAt?: number;
}

interface VideoSenderSnapshot {
    bytesSent: number;
    framesEncoded: number;
    frameWidth?: number;
    frameHeight?: number;
    sampledAt: number;
}

interface MediaConnectionLike {
    streamUserId?: string;
    negotiationNeeded?: boolean;
    handleNegotiationNeeded?: () => void | Promise<void>;
    localVideoSinkWants?: RemoteVideoSinkWantsLike;
    remoteVideoSinkWants?: RemoteVideoSinkWantsLike;
    updateVideoQuality?: (...args: unknown[]) => unknown;
    input?: {
        stream?: {
            getVideoTracks?: () => MediaStreamTrack[];
        };
        desktop?: {
            stream?: MediaStream;
        };
        mergeStreams?: () => void;
    };
    videoStreamParameters?: Array<ScreenShareVideoStreamParameters | undefined>;
}

interface ApplicationStreamLike {
    streamType?: string;
    guildId?: string | null;
    channelId?: string;
    ownerId?: string;
}

interface ApplicationStreamingStoreLike {
    addChangeListener?: (listener: () => void) => void;
    getCurrentUserActiveStream?: () => ApplicationStreamLike | null;
    getViewerIds?: (stream: ApplicationStreamLike) => string[];
}

type DisplayTrackConstraints = MediaTrackConstraints & {
    resizeMode?: ConstrainDOMString;
};

type MutableVideoTrackStreamLike = Pick<MediaStream, "getVideoTracks" | "removeTrack" | "addTrack">;

type MutableRtpSendParameters = RTCRtpSendParameters & {
    degradationPreference?: "balanced" | "maintain-framerate" | "maintain-resolution";
};

interface ScreenShareCaptureProfile {
    frameRate: number;
    height: number;
    width: number;
}

interface SelfStreamViewerMonitorState {
    hadViewer: boolean;
    rejoinArmed: boolean;
    streamIdentity?: string;
    viewerCount: number;
}

interface RemoteSinkMonitorState {
    hadPositiveSink: boolean;
    rejoinArmed: boolean;
}

interface RemoteVideoSinkWantsLike {
    any?: number;
    pixelCounts?: Record<string, number>;
    [key: string]: number | Record<string, number> | undefined;
}

interface RemoteVideoSinkWantsAction {
    wants?: RemoteVideoSinkWantsLike;
}

interface DirectScreenShareSinkWantsPropertyPatchState {
    localPropertyPatched: boolean;
    remotePropertyPatched: boolean;
}

interface PendingTrackConstraintSyncRequest {
    connection: MediaConnectionLike | null | undefined;
    force: boolean;
}

type DisplayMediaStreamOptionsLike = DisplayMediaStreamOptions & {
    video?: boolean | MediaTrackConstraints;
};

const selfStreamViewerMonitorState: SelfStreamViewerMonitorState = {
    hadViewer: false,
    rejoinArmed: false,
    viewerCount: 0
};

const remoteSinkMonitorState: RemoteSinkMonitorState = {
    hadPositiveSink: false,
    rejoinArmed: false
};

function rememberManagedScreenShareTrack(track: MediaStreamTrack | null | undefined) {
    if (track?.kind === "video" && (track.contentHint === "detail" || track.contentHint === "motion")) {
        managedScreenShareTracks.add(track);
    }
}

function isManagedScreenShareTrack(track: MediaStreamTrack | null | undefined) {
    return Boolean(
        track &&
        track.kind === "video" &&
        managedScreenShareTracks.has(track) &&
        (track.contentHint === "detail" || track.contentHint === "motion")
    );
}

function isDetailDisplayTrack(track: MediaStreamTrack | null | undefined) {
    return Boolean(track && track.kind === "video" && track.contentHint === "detail" && detailDisplayTracks.has(track));
}

function getManagedScreenShareDegradationPreference(
    track: MediaStreamTrack
): NonNullable<MutableRtpSendParameters["degradationPreference"]> {
    return isDetailDisplayTrack(track) ? "balanced" : "maintain-framerate";
}

function getManagedScreenShareContentHint(track: MediaStreamTrack | null | undefined) {
    if (!track || track.kind !== "video") {
        return "";
    }

    return track.contentHint === "detail" || track.contentHint === "motion" ? track.contentHint : "";
}

function rememberManagedScreenShareModeTrack(track: MediaStreamTrack | null | undefined) {
    rememberManagedScreenShareTrack(track);

    if (track?.kind === "video" && track.contentHint === "detail") {
        detailDisplayTracks.add(track);
    }
}

function noteSenderParameterSyncFailure(sender: RTCRtpSender, message: string, error: unknown) {
    const nextCount = (senderParameterSyncFailureCounts.get(sender) ?? 0) + 1;
    senderParameterSyncFailureCounts.set(sender, nextCount);

    if (nextCount === 1) {
        logger.error(message, error);
    }
}

function getErrorName(error: unknown) {
    if (typeof error !== "object" || error === null || !("name" in error)) {
        return "";
    }

    return String((error as { name?: unknown }).name ?? "");
}

function getErrorMessage(error: unknown) {
    if (typeof error !== "object" || error === null || !("message" in error)) {
        return "";
    }

    return String((error as { message?: unknown }).message ?? "");
}

function shouldRetrySenderParameterSyncFailure(error: unknown) {
    const name = getErrorName(error);
    const message = getErrorMessage(error);

    return (
        name === "InvalidModificationError" ||
        name === "InvalidStateError" ||
        message.includes("getParameters") ||
        message.includes("setParameters") ||
        message.includes("transaction")
    );
}

function waitSenderParameterSyncRetryDelay() {
    return new Promise<void>(resolve => {
        window.setTimeout(resolve, senderParameterSyncRetryDelayMs);
    });
}

function wait(delayMs: number) {
    return new Promise<void>(resolve => {
        window.setTimeout(resolve, delayMs);
    });
}

function getNumericConstraintValue(value: ConstrainULong | ConstrainDouble | undefined) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }

    if (!value || typeof value !== "object") {
        return void 0;
    }

    const candidates = [value.exact, value.ideal, value.max, value.min];
    return candidates.find(candidate => typeof candidate === "number" && Number.isFinite(candidate));
}

function getRequestedTrackFrameRate(track: MediaStreamTrack) {
    const constraints = track.getConstraints() as DisplayTrackConstraints;
    const constrainedFrameRate = getNumericConstraintValue(constraints.frameRate);
    if (constrainedFrameRate !== void 0) {
        return constrainedFrameRate;
    }

    // `getSettings().frameRate` can reflect transient live capture output on
    // Linux screenshare. Treat the explicit constraint as the requested target
    // first so healthy FPS drift does not trigger another applyConstraints().
    const settings = track.getSettings();
    if (typeof settings.frameRate === "number" && Number.isFinite(settings.frameRate)) {
        return settings.frameRate;
    }

    return void 0;
}

function getCurrentScreenShareCaptureProfile(
    connection: MediaConnectionLike | null | undefined
): ScreenShareCaptureProfile {
    const selectedProfile = getSelectedScreenShareProfile();
    const streamParameters = getScreenShareConnectionVideoStreamParameters(connection);
    const maxResolution = streamParameters?.maxResolution;

    const frameRate = Number(streamParameters?.maxFrameRate);
    const width = Number(maxResolution?.width);
    const height = Number(maxResolution?.height);
    const pixelCount = Number(streamParameters?.maxPixelCount);

    const hasValidFrameRate = Number.isFinite(frameRate) && frameRate > 0;
    const hasValidWidth = Number.isFinite(width) && width > 0;
    const hasValidHeight = Number.isFinite(height) && height > 0;
    const hasValidPixelCount = Number.isFinite(pixelCount) && pixelCount > 0;
    const matchesSelectedDimensions =
        hasValidWidth &&
        hasValidHeight &&
        width === selectedProfile.width &&
        height === selectedProfile.height &&
        (!hasValidPixelCount || pixelCount === selectedProfile.pixelCount);

    return {
        frameRate: hasValidFrameRate && frameRate === selectedProfile.frameRate ? frameRate : selectedProfile.frameRate,
        height: matchesSelectedDimensions ? height : selectedProfile.height,
        width: matchesSelectedDimensions ? width : selectedProfile.width
    };
}

function buildManagedScreenShareConstraints(
    baseConstraints: MediaTrackConstraints,
    profile: ScreenShareCaptureProfile
): DisplayTrackConstraints {
    const advanced = Array.isArray(baseConstraints.advanced) ? [...baseConstraints.advanced] : [];
    advanced.push({ width: profile.width, height: profile.height });

    return {
        ...baseConstraints,
        frameRate: { min: profile.frameRate, ideal: profile.frameRate, max: profile.frameRate },
        width: { min: 640, ideal: profile.width, max: profile.width },
        height: { min: 480, ideal: profile.height, max: profile.height },
        advanced,
        resizeMode: "none"
    };
}

function buildManagedScreenShareRequestConstraints(
    baseConstraints: MediaTrackConstraints,
    profile: ScreenShareCaptureProfile
): DisplayTrackConstraints {
    const { advanced: _advanced, ...requestConstraints } = baseConstraints;

    // Electron rejects `advanced` during getDisplayMedia() request validation.
    // Keep request-time constraints conservative, then tighten them on the live track.
    return {
        ...requestConstraints,
        frameRate: { ideal: profile.frameRate },
        width: { ideal: profile.width },
        height: { ideal: profile.height },
        resizeMode: "none"
    };
}

function buildManagedScreenShareTrackConstraints(
    track: MediaStreamTrack,
    connection: MediaConnectionLike | null | undefined
): DisplayTrackConstraints {
    const profile = getCurrentScreenShareCaptureProfile(connection);
    return buildManagedScreenShareConstraints(track.getConstraints(), profile);
}

function mergeTrackConstraintSyncRequest(
    previous: PendingTrackConstraintSyncRequest | undefined,
    connection: MediaConnectionLike | null | undefined,
    force: boolean
): PendingTrackConstraintSyncRequest {
    return {
        connection: connection ?? previous?.connection,
        force: force || previous?.force || false
    };
}

function notePendingTrackConstraintSyncRequest(
    track: MediaStreamTrack,
    connection: MediaConnectionLike | null | undefined,
    force: boolean
) {
    trackConstraintSyncPendingRequests.set(
        track,
        mergeTrackConstraintSyncRequest(trackConstraintSyncPendingRequests.get(track), connection, force)
    );
    trackConstraintSyncPending.set(track, true);
}

function isExpectedTrackConstraintSyncFailure(track: MediaStreamTrack, error: unknown) {
    const name = getErrorName(error);
    return track.readyState !== "live" || name === "AbortError" || name === "InvalidStateError";
}

async function syncManagedScreenShareTrackConstraintsOnce(
    track: MediaStreamTrack,
    connection: MediaConnectionLike | null | undefined,
    force = false
) {
    if (track.kind !== "video" || !isManagedScreenShareTrack(track) || track.readyState !== "live") {
        return;
    }

    const profile = getCurrentScreenShareCaptureProfile(connection);
    const settings = track.getSettings();
    const constraints = track.getConstraints() as DisplayTrackConstraints;

    const currentWidth = settings.width ?? getNumericConstraintValue(constraints.width);
    const currentHeight = settings.height ?? getNumericConstraintValue(constraints.height);
    const currentFrameRate = getRequestedTrackFrameRate(track);
    const desiredContentHint =
        getManagedScreenShareContentHint(track) ||
        (typeof currentSettings?.contentHint === "string" ? currentSettings.contentHint : "detail");

    const hasTargetDimensions = currentWidth === profile.width && currentHeight === profile.height;
    const hasTargetFrameRate = currentFrameRate !== void 0 && Math.round(currentFrameRate) === profile.frameRate;
    const hasTargetResizeMode = constraints.resizeMode === "none";
    const hasTargetContentHint = track.contentHint === desiredContentHint;

    if (!force && hasTargetDimensions && hasTargetFrameRate && hasTargetResizeMode && hasTargetContentHint) {
        return;
    }

    const now = Date.now();
    const lastAttemptAt = trackConstraintSyncAttemptAt.get(track) ?? 0;
    if (!force && now - lastAttemptAt < screenShareTrackConstraintSyncCooldownMs) {
        return;
    }

    trackConstraintSyncAttemptAt.set(track, now);

    if (track.contentHint !== desiredContentHint) {
        track.contentHint = desiredContentHint;
    }

    try {
        await track.applyConstraints(buildManagedScreenShareTrackConstraints(track, connection));
    } catch (error) {
        if (isExpectedTrackConstraintSyncFailure(track, error)) {
            return;
        }

        logger.error("Failed to sync screenshare track constraints", error);
    }
}

async function syncManagedScreenShareTrackConstraints(
    track: MediaStreamTrack,
    connection: MediaConnectionLike | null | undefined,
    force = false
) {
    const currentTask = trackConstraintSyncTasks.get(track);
    if (currentTask) {
        notePendingTrackConstraintSyncRequest(track, connection, force);
        return currentTask;
    }

    // Coalesce overlapping sync requests per track so applyConstraints() never races itself.
    const task = (async () => {
        let request: PendingTrackConstraintSyncRequest | undefined = { connection, force };

        do {
            trackConstraintSyncPending.set(track, false);
            trackConstraintSyncPendingRequests.delete(track);

            await syncManagedScreenShareTrackConstraintsOnce(track, request.connection, request.force);

            request = trackConstraintSyncPending.get(track) ? trackConstraintSyncPendingRequests.get(track) : void 0;
        } while (request);
    })().finally(() => {
        trackConstraintSyncPending.delete(track);
        trackConstraintSyncPendingRequests.delete(track);
        trackConstraintSyncTasks.delete(track);
    });

    trackConstraintSyncTasks.set(track, task);
    return task;
}

async function syncManagedScreenShareSenderParametersOnce(sender: RTCRtpSender, allowRetry = true) {
    const { track } = sender;
    if (!track || !isManagedScreenShareTrack(track) || track.readyState !== "live") {
        senderParameterSyncFailureCounts.delete(sender);
        return;
    }

    let parameters: MutableRtpSendParameters;

    try {
        parameters = sender.getParameters() as MutableRtpSendParameters;
    } catch (error) {
        noteSenderParameterSyncFailure(sender, "Failed to read screenshare sender RTP parameters", error);
        return;
    }

    const profile = getSelectedScreenShareProfile();
    const bitrateProfile = getSelectedScreenShareBitrateProfile(profile);
    const isDetailTrack = isDetailDisplayTrack(track);
    const degradationPreference = getManagedScreenShareDegradationPreference(track);
    const connectionStreamParameters = getScreenShareConnectionVideoStreamParameters(findLocalStreamConnection(track));
    const desiredMaxBitrate = Number(connectionStreamParameters?.maxBitrate ?? bitrateProfile.max);
    const encodings = parameters.encodings?.length ? [...parameters.encodings] : [{}];
    let changed = !parameters.encodings?.length;

    for (const encoding of encodings) {
        if (encoding.active !== true) {
            encoding.active = true;
            changed = true;
        }

        if (encoding.maxBitrate !== desiredMaxBitrate) {
            encoding.maxBitrate = desiredMaxBitrate;
            changed = true;
        }

        if (encoding.maxFramerate !== profile.frameRate) {
            encoding.maxFramerate = profile.frameRate;
            changed = true;
        }
    }

    if (!parameters.degradationPreference) {
        parameters.degradationPreference = degradationPreference;
        changed = true;
    }

    if (!changed) {
        senderParameterSyncFailureCounts.delete(sender);
        return;
    }

    parameters.encodings = encodings;

    try {
        await sender.setParameters(parameters);
        senderParameterSyncFailureCounts.delete(sender);
    } catch (error) {
        // Discord can mutate the same sender during recovery/reconfigure.
        // Retry once with a fresh getParameters() snapshot if the transaction went stale.
        if (allowRetry && shouldRetrySenderParameterSyncFailure(error)) {
            await waitSenderParameterSyncRetryDelay();
            await syncManagedScreenShareSenderParametersOnce(sender, false);
            return;
        }

        noteSenderParameterSyncFailure(sender, "Failed to sync screenshare sender RTP parameters", error);
    }
}

async function syncManagedScreenShareSenderParameters(sender: RTCRtpSender) {
    const currentTask = senderParameterSyncTasks.get(sender);
    if (currentTask) {
        senderParameterSyncPending.set(sender, true);
        return currentTask;
    }

    const task = (async () => {
        do {
            senderParameterSyncPending.set(sender, false);
            await syncManagedScreenShareSenderParametersOnce(sender);
        } while (senderParameterSyncPending.get(sender));
    })().finally(() => {
        senderParameterSyncPending.delete(sender);
        senderParameterSyncTasks.delete(sender);
    });

    senderParameterSyncTasks.set(sender, task);
    return task;
}

async function syncActiveScreenShareSenderParameters() {
    for (const pc of trackedScreenSharePeerConnections) {
        if (pc.connectionState === "closed" || pc.iceConnectionState === "closed") {
            continue;
        }

        for (const sender of pc.getSenders()) {
            const { track } = sender;
            if (!track || !isManagedScreenShareTrack(track) || track.readyState !== "live") {
                continue;
            }

            await syncManagedScreenShareSenderParameters(sender);
        }
    }
}

function getMediaEngineConnections() {
    try {
        return [...MediaEngineStore.getMediaEngine().connections] as MediaConnectionLike[];
    } catch (error) {
        logger.error("Failed to enumerate media engine connections", error);
        return [];
    }
}

function getRelatedMediaConnectionCandidates(connection: MediaConnectionLike) {
    const candidates = [connection];
    const { videoQualityManager } = connection as Record<string, unknown>;

    if (videoQualityManager && typeof videoQualityManager === "object") {
        const { connection: nestedConnection } = videoQualityManager as Record<string, unknown>;
        if (nestedConnection && typeof nestedConnection === "object" && nestedConnection !== connection) {
            candidates.push(nestedConnection as MediaConnectionLike);
        }
    }

    return candidates;
}

function getMediaEngineConnectionCandidates() {
    const candidates = [] as MediaConnectionLike[];
    const seenConnections = new Set<MediaConnectionLike>();

    for (const connection of getMediaEngineConnections()) {
        for (const candidate of getRelatedMediaConnectionCandidates(connection)) {
            if (seenConnections.has(candidate)) {
                continue;
            }

            seenConnections.add(candidate);
            candidates.push(candidate);
        }
    }

    return candidates;
}

function getConnectionVideoTracks(connection: MediaConnectionLike) {
    const tracks = new Map<string, MediaStreamTrack>();

    const add_tracks = (candidate_tracks: MediaStreamTrack[] | undefined) => {
        for (const track of candidate_tracks ?? []) {
            if (track.kind === "video") {
                tracks.set(track.id, track);
            }
        }
    };

    add_tracks(connection.input?.stream?.getVideoTracks?.());
    add_tracks(connection.input?.desktop?.stream?.getVideoTracks?.());

    return [...tracks.values()];
}

function cloneRemoteVideoSinkWants(wants: RemoteVideoSinkWantsLike) {
    const nextWants = {} as RemoteVideoSinkWantsLike;

    for (const [key, value] of Object.entries(wants)) {
        if (key === "pixelCounts") {
            if (value && typeof value === "object") {
                nextWants.pixelCounts = { ...(value as Record<string, number>) };
            }

            continue;
        }

        if (typeof value === "number" && Number.isFinite(value)) {
            nextWants[key] = value;
        }
    }

    return nextWants;
}

function getConnectionPrimaryScreenShareSsrc(connection: MediaConnectionLike) {
    const streamParameters = connection.videoStreamParameters ?? [];
    const primaryParameter =
        streamParameters.find(
            parameter => Number(parameter?.ssrc ?? 0) > 0 && Number(parameter?.quality ?? 0) >= 100
        ) ??
        streamParameters.find(parameter => Number(parameter?.ssrc ?? 0) > 0) ??
        null;
    const primarySsrc = Number(primaryParameter?.ssrc ?? 0);

    return Number.isFinite(primarySsrc) && primarySsrc > 0 ? String(primarySsrc) : "";
}

function getConnectionScreenSharePixelCount(connection: MediaConnectionLike) {
    const primaryParameter =
        connection.videoStreamParameters?.find(parameter => Number(parameter?.maxPixelCount ?? 0) > 0) ?? null;
    const parameterPixelCount = Number(primaryParameter?.maxPixelCount ?? 0);
    if (Number.isFinite(parameterPixelCount) && parameterPixelCount > 0) {
        return parameterPixelCount;
    }

    const profile = getCurrentScreenShareCaptureProfile(connection);
    const profilePixelCount = profile.width * profile.height;
    return profilePixelCount > 0 ? profilePixelCount : 0;
}

function hasDirectScreenSharePatchTarget(connection: MediaConnectionLike) {
    if (getConnectionPrimaryScreenShareSsrc(connection)) {
        return true;
    }

    return getConnectionVideoTracks(connection).some(track => isManagedScreenShareTrack(track));
}

function promoteGenericDirectScreenShareSinkWants(connection: MediaConnectionLike, wants: RemoteVideoSinkWantsLike) {
    const genericWant = Number(wants.any ?? 0);
    if (!(genericWant > 0)) {
        return null;
    }

    const hasExplicitPositiveSink = Object.entries(wants).some(([key, value]) => {
        return (
            key !== "any" && key !== "pixelCounts" && typeof value === "number" && Number.isFinite(value) && value > 0
        );
    });
    if (hasExplicitPositiveSink) {
        return null;
    }

    const primarySsrc = getConnectionPrimaryScreenShareSsrc(connection);
    if (!primarySsrc) {
        return null;
    }

    const nextWants = cloneRemoteVideoSinkWants(wants);
    nextWants[primarySsrc] = genericWant;

    const pixelCount = getConnectionScreenSharePixelCount(connection);
    if (pixelCount > 0) {
        nextWants.pixelCounts = {
            ...(nextWants.pixelCounts ?? {}),
            [primarySsrc]: pixelCount
        };
    }

    return nextWants;
}

function installDirectScreenShareSinkWantsPropertyPatch(
    connection: MediaConnectionLike,
    propertyName: "localVideoSinkWants" | "remoteVideoSinkWants"
) {
    const connectionRecord = connection as Record<string, unknown>;
    const existingDescriptor = Object.getOwnPropertyDescriptor(connectionRecord, propertyName);

    if (existingDescriptor?.configurable === false) {
        return false;
    }

    if (existingDescriptor?.get || existingDescriptor?.set) {
        return false;
    }

    let storedValue =
        existingDescriptor && "value" in existingDescriptor ? existingDescriptor.value : connectionRecord[propertyName];

    const maybePromote = (candidate: unknown) => {
        if (!candidate || typeof candidate !== "object") {
            return candidate;
        }

        return promoteGenericDirectScreenShareSinkWants(connection, candidate as RemoteVideoSinkWantsLike) ?? candidate;
    };

    Object.defineProperty(connectionRecord, propertyName, {
        configurable: true,
        enumerable: existingDescriptor?.enumerable ?? true,
        get() {
            const promotedValue = maybePromote(storedValue);
            if (promotedValue !== storedValue) {
                storedValue = promotedValue;
            }

            return storedValue;
        },
        set(nextValue: unknown) {
            storedValue = maybePromote(nextValue);
        }
    });

    storedValue = maybePromote(storedValue);
    return true;
}

function installDirectScreenShareSinkWantsPropertyPatches(connection: MediaConnectionLike) {
    const existingState = directScreenShareSinkWantsPropertyPatchStates.get(connection);
    if (existingState) {
        return existingState;
    }

    const nextState: DirectScreenShareSinkWantsPropertyPatchState = {
        localPropertyPatched: installDirectScreenShareSinkWantsPropertyPatch(connection, "localVideoSinkWants"),
        remotePropertyPatched: installDirectScreenShareSinkWantsPropertyPatch(connection, "remoteVideoSinkWants")
    };

    directScreenShareSinkWantsPropertyPatchStates.set(connection, nextState);
    return nextState;
}

function maybeForceDirectLocalStreamParameterActivation(connection: MediaConnectionLike, args: unknown[]) {
    if (!args.length) {
        return args;
    }

    const firstArg = args[0];
    if (!firstArg || typeof firstArg !== "object") {
        return args;
    }

    const options = firstArg as Record<string, unknown>;
    if (!Array.isArray(options.streamParameters) || !options.streamParameters.length) {
        return args;
    }
    const streamParameters = options.streamParameters as unknown[];

    const primarySsrc = getConnectionPrimaryScreenShareSsrc(connection);
    if (!primarySsrc) {
        return args;
    }

    let changed = false;
    const nextStreamParameters = streamParameters.map(parameter => {
        if (!parameter || typeof parameter !== "object") {
            return parameter;
        }

        const record = parameter as Record<string, unknown>;
        const matchesPrimary = String(record.ssrc ?? "") === primarySsrc;
        const shouldActivate = matchesPrimary || streamParameters.length === 1;
        if (!shouldActivate || record.active === true) {
            return parameter;
        }

        changed = true;
        return {
            ...record,
            active: true
        };
    });

    if (!changed) {
        return args;
    }

    const nextArgs = [...args];
    nextArgs[0] = {
        ...options,
        streamParameters: nextStreamParameters
    };

    return nextArgs;
}

function installDirectLocalScreenShareSinkWantsPatch(connection: MediaConnectionLike | null | undefined) {
    if (
        !connection ||
        typeof connection.updateVideoQuality !== "function" ||
        !hasDirectScreenSharePatchTarget(connection)
    ) {
        return;
    }

    const propertyPatchState = installDirectScreenShareSinkWantsPropertyPatches(connection);
    const currentUpdateVideoQuality = connection.updateVideoQuality;
    const installedWrapper = directLocalScreenShareSinkWantsPatchedUpdateVideoQuality.get(connection);
    if (installedWrapper && currentUpdateVideoQuality === installedWrapper) {
        return;
    }

    const originalUpdateVideoQuality = currentUpdateVideoQuality;
    const wrappedUpdateVideoQuality = (...args: unknown[]) => {
        if (!propertyPatchState.localPropertyPatched) {
            const promotedLocalWants = connection.localVideoSinkWants
                ? promoteGenericDirectScreenShareSinkWants(connection, connection.localVideoSinkWants)
                : null;
            if (promotedLocalWants) {
                connection.localVideoSinkWants = promotedLocalWants;
            }
        }

        if (!propertyPatchState.remotePropertyPatched) {
            const promotedRemoteWants = connection.remoteVideoSinkWants
                ? promoteGenericDirectScreenShareSinkWants(connection, connection.remoteVideoSinkWants)
                : null;
            if (promotedRemoteWants) {
                connection.remoteVideoSinkWants = promotedRemoteWants;
            }
        }

        return originalUpdateVideoQuality.apply(
            connection,
            maybeForceDirectLocalStreamParameterActivation(connection, args)
        );
    };
    connection.updateVideoQuality = wrappedUpdateVideoQuality;

    directLocalScreenShareSinkWantsPatchedUpdateVideoQuality.set(connection, wrappedUpdateVideoQuality);
}

function rememberLocalConnectionTrack(
    track: MediaStreamTrack | null | undefined,
    connection: MediaConnectionLike | null | undefined
) {
    if (!track || track.kind !== "video" || !connection) {
        return;
    }

    trackLocalConnectionHints.set(track, connection);
}

async function syncActiveScreenShareTracks(force = false) {
    const currentUserId = UserStore.getCurrentUser()?.id;
    if (!currentUserId) {
        return;
    }

    const connections = getMediaEngineConnectionCandidates().filter(
        connection => connection.streamUserId === currentUserId
    );

    for (const connection of connections) {
        installDirectLocalScreenShareSinkWantsPatch(connection);
        syncSelectedScreenShareVideoStreamParameters(getScreenShareConnectionVideoStreamParameters(connection));

        for (const track of getConnectionVideoTracks(connection)) {
            rememberManagedScreenShareModeTrack(track);

            if (!isManagedScreenShareTrack(track)) {
                continue;
            }

            rememberLocalConnectionTrack(track, connection);
            await syncManagedScreenShareTrackConstraints(track, connection, force);
        }
    }

    await syncActiveScreenShareSenderParameters();
}

function scheduleActiveScreenShareTrackSync(force = false) {
    const currentSequence = ++activeDetailTrackSyncSequence;
    let allowForcedWave = force;

    for (const delayMs of screenShareProfileChangeSyncDelaysMs) {
        const waveForce = allowForcedWave;
        allowForcedWave = false;

        window.setTimeout(() => {
            if (currentSequence !== activeDetailTrackSyncSequence) {
                return;
            }

            // A full forced applyConstraints() wave is expensive on Linux screenshare.
            // Keep one immediate hard reapply, then let delayed waves only verify/correct drift.
            void syncActiveScreenShareTracks(waveForce);
        }, delayMs);
    }
}

function getSenderRecoveryState(sender: RTCRtpSender) {
    const existingState = senderRecoveryStates.get(sender);
    if (existingState) {
        return existingState;
    }

    const nextState: SenderRecoveryState = {
        inRecovery: false
    };

    senderRecoveryStates.set(sender, nextState);
    return nextState;
}

function findLocalStreamConnection(track: MediaStreamTrack) {
    try {
        const currentUserId = UserStore.getCurrentUser()?.id;
        const connections = getMediaEngineConnectionCandidates();
        const hintedConnection = trackLocalConnectionHints.get(track);

        for (const connection of connections) {
            if (getConnectionVideoTracks(connection).some(candidate => candidate.id === track.id)) {
                rememberLocalConnectionTrack(track, connection);
                installDirectLocalScreenShareSinkWantsPatch(connection);
                return connection;
            }
        }

        if (hintedConnection && connections.includes(hintedConnection)) {
            installDirectLocalScreenShareSinkWantsPatch(hintedConnection);
            return hintedConnection;
        }

        const fallbackConnection = connections.find(connection => connection.streamUserId === currentUserId) ?? null;
        installDirectLocalScreenShareSinkWantsPatch(fallbackConnection);
        return fallbackConnection;
    } catch (error) {
        logger.error("Failed to resolve local media engine connection", error);
        return null;
    }
}

async function tryKickConnectionNegotiation(connection: MediaConnectionLike | null) {
    if (!connection || typeof connection.handleNegotiationNeeded !== "function") {
        return;
    }

    try {
        connection.negotiationNeeded = true;
        await Promise.resolve(connection.handleNegotiationNeeded());
    } catch (error) {
        logger.error("Local connection negotiation hook failed", error);
    }
}

function clearViewerRejoinRecoveryTimer() {
    if (viewerRejoinRecoveryTimer !== void 0) {
        clearTimeout(viewerRejoinRecoveryTimer);
        viewerRejoinRecoveryTimer = void 0;
    }
}

function getApplicationStreamIdentity(stream: ApplicationStreamLike | null | undefined) {
    if (!stream?.ownerId || !stream.channelId || !stream.streamType) {
        return "";
    }

    return `${stream.streamType}:${stream.guildId ?? "noguild"}:${stream.channelId}:${stream.ownerId}`;
}

function resetRemoteSinkMonitorState() {
    remoteSinkMonitorState.hadPositiveSink = false;
    remoteSinkMonitorState.rejoinArmed = false;
}

function resetSelfStreamViewerState() {
    clearViewerRejoinRecoveryTimer();
    selfStreamViewerMonitorState.hadViewer = false;
    selfStreamViewerMonitorState.rejoinArmed = false;
    selfStreamViewerMonitorState.streamIdentity = void 0;
    selfStreamViewerMonitorState.viewerCount = 0;
    resetRemoteSinkMonitorState();
}

function hasActiveScreenShareSender() {
    for (const pc of trackedScreenSharePeerConnections) {
        if (pc.connectionState === "closed" || pc.iceConnectionState === "closed") {
            continue;
        }

        for (const sender of pc.getSenders()) {
            const { track } = sender;
            if (track && isManagedScreenShareTrack(track) && track.readyState === "live") {
                return true;
            }
        }
    }

    return false;
}

function hasPositiveRemoteSinkDemand(wants: RemoteVideoSinkWantsLike | undefined) {
    if (!wants) {
        return false;
    }

    return Object.entries(wants).some(([key, value]) => {
        return key !== "pixelCounts" && typeof value === "number" && Number.isFinite(value) && value > 0;
    });
}

function isMutableVideoTrackStream(stream: unknown): stream is MutableVideoTrackStreamLike {
    return Boolean(
        stream &&
        typeof stream === "object" &&
        "getVideoTracks" in stream &&
        typeof stream.getVideoTracks === "function" &&
        "removeTrack" in stream &&
        typeof stream.removeTrack === "function" &&
        "addTrack" in stream &&
        typeof stream.addTrack === "function"
    );
}

function replaceVideoTrackInStream(
    stream: MutableVideoTrackStreamLike,
    originalTrack: MediaStreamTrack,
    nextTrack: MediaStreamTrack
) {
    const videoTracks = stream.getVideoTracks();
    const hasRelevantTrack = videoTracks.some(track => track.id === originalTrack.id || track.id === nextTrack.id);
    if (!hasRelevantTrack) {
        return false;
    }

    for (const videoTrack of videoTracks) {
        if (videoTrack.id !== nextTrack.id) {
            stream.removeTrack(videoTrack);
        }
    }

    if (!stream.getVideoTracks().some(track => track.id === nextTrack.id)) {
        stream.addTrack(nextTrack);
    }

    return true;
}

function retireReplacedScreenShareTrack(originalTrack: MediaStreamTrack, nextTrack: MediaStreamTrack) {
    if (originalTrack.id === nextTrack.id) {
        return;
    }

    managedScreenShareTracks.delete(originalTrack);
    detailDisplayTracks.delete(originalTrack);
    trackLocalConnectionHints.delete(originalTrack);
    trackConstraintSyncAttemptAt.delete(originalTrack);

    if (originalTrack.readyState !== "live") {
        return;
    }

    try {
        originalTrack.stop();
    } catch (error) {
        logger.error("Failed to stop replaced detail screenshare track", error);
    }
}

function trySyncLocalDesktopTrack(
    connection: MediaConnectionLike | null,
    originalTrack: MediaStreamTrack,
    nextTrack: MediaStreamTrack
) {
    const input = connection?.input;
    const streams = [input?.desktop?.stream, input?.stream].filter(isMutableVideoTrackStream);
    if (!streams.length) {
        return false;
    }

    let synchronizedStream = false;
    const seenStreams = new Set<MutableVideoTrackStreamLike>();

    for (const stream of streams) {
        if (seenStreams.has(stream)) {
            continue;
        }

        seenStreams.add(stream);
        synchronizedStream = replaceVideoTrackInStream(stream, originalTrack, nextTrack) || synchronizedStream;
    }

    if (!synchronizedStream) {
        return false;
    }

    input?.mergeStreams?.();
    rememberLocalConnectionTrack(nextTrack, connection);
    return true;
}

async function replaceTrackDuringRecovery(sender: RTCRtpSender, track: MediaStreamTrack | null) {
    recoveryManagedReplaceTrackSenders.add(sender);

    try {
        await sender.replaceTrack(track);
    } finally {
        recoveryManagedReplaceTrackSenders.delete(sender);
    }
}

async function syncRecoveredScreenShareSender(
    sender: RTCRtpSender,
    track: MediaStreamTrack,
    connection: MediaConnectionLike | null | undefined
) {
    syncSelectedScreenShareVideoStreamParameters(getScreenShareConnectionVideoStreamParameters(connection));
    await syncManagedScreenShareTrackConstraints(track, connection, true);
    await syncManagedScreenShareSenderParameters(sender);
}

function attachManagedScreenShareSender(pc: RTCPeerConnection, sender: RTCRtpSender, track: MediaStreamTrack | null) {
    senderPeerConnections.set(sender, pc);

    if (!isManagedScreenShareTrack(track)) {
        return;
    }

    trackPeerConnection(pc);
    void syncManagedScreenShareSenderParameters(sender);
}

function untrackPeerConnection(pc: RTCPeerConnection) {
    trackedScreenSharePeerConnections.delete(pc);
}

function trackPeerConnection(pc: RTCPeerConnection) {
    trackedScreenSharePeerConnections.add(pc);

    if (trackedPeerConnections.has(pc)) {
        return;
    }

    trackedPeerConnections.add(pc);

    const stopIfClosed = () => {
        if (pc.connectionState === "closed" || pc.iceConnectionState === "closed") {
            untrackPeerConnection(pc);
        }
    };

    pc.addEventListener("connectionstatechange", stopIfClosed);
    pc.addEventListener("iceconnectionstatechange", stopIfClosed);
}

function isVideoOutboundRtpStreamStats(report: RTCStats): report is RTCOutboundRtpStreamStats {
    if (report.type !== "outbound-rtp") {
        return false;
    }

    const outbound = report as RTCOutboundRtpStreamStats & { mediaType?: string };
    return outbound.kind === "video" || outbound.mediaType === "video";
}

function selectPrimaryVideoOutboundReport(outboundReports: RTCOutboundRtpStreamStats[]) {
    return outboundReports.reduce((bestReport, currentReport) => {
        const bestScore = (bestReport.bytesSent ?? 0) + (bestReport.framesEncoded ?? 0) * 1024;
        const currentScore = (currentReport.bytesSent ?? 0) + (currentReport.framesEncoded ?? 0) * 1024;

        return currentScore > bestScore ? currentReport : bestReport;
    });
}

function makeVideoSenderSnapshot(outbound: RTCOutboundRtpStreamStats): VideoSenderSnapshot {
    return {
        bytesSent: outbound.bytesSent ?? 0,
        framesEncoded: outbound.framesEncoded ?? 0,
        frameWidth: outbound.frameWidth,
        frameHeight: outbound.frameHeight,
        sampledAt: performance.now()
    };
}

function hasRenderableDimensions(snapshot: VideoSenderSnapshot) {
    return (snapshot.frameWidth ?? 0) > 0 && (snapshot.frameHeight ?? 0) > 0;
}

function hasSenderSnapshotProgress(
    previousSnapshot: VideoSenderSnapshot | null,
    currentSnapshot: VideoSenderSnapshot | null
) {
    if (!previousSnapshot || !currentSnapshot) {
        return false;
    }

    return (
        currentSnapshot.framesEncoded > previousSnapshot.framesEncoded ||
        currentSnapshot.bytesSent > previousSnapshot.bytesSent
    );
}

async function getPrimaryVideoSenderSnapshot(sender: RTCRtpSender) {
    const senderStats = await sender.getStats();
    const outboundReports = [...senderStats.values()].filter(isVideoOutboundRtpStreamStats);
    if (!outboundReports.length) {
        return null;
    }

    return makeVideoSenderSnapshot(selectPrimaryVideoOutboundReport(outboundReports));
}

async function hasRecentSenderOutputHealth(sender: RTCRtpSender) {
    const firstSnapshot = await getPrimaryVideoSenderSnapshot(sender);
    if (!firstSnapshot) {
        return false;
    }

    await wait(audienceRecoveryHealthProbeDelayMs);

    const secondSnapshot = await getPrimaryVideoSenderSnapshot(sender);
    const latestSnapshot = secondSnapshot ?? firstSnapshot;
    if (!hasRenderableDimensions(latestSnapshot) || latestSnapshot.framesEncoded === 0) {
        return false;
    }

    return latestSnapshot.bytesSent > 0 || hasSenderSnapshotProgress(firstSnapshot, secondSnapshot);
}

async function shouldRecoverSenderForAudienceEvent(sender: RTCRtpSender, _reason: string) {
    const { track } = sender;
    if (!track || !isManagedScreenShareTrack(track) || track.readyState !== "live") {
        return false;
    }

    /*
     * Viewer attach/rejoin already primes the safe constraint/parameter resync
     * path. Only escalate to replaceTrack-based recovery when the sender still
     * looks stalled afterwards; otherwise healthy detail-share sessions get
     * churned precisely when a viewer joins.
     */
    return !(await hasRecentSenderOutputHealth(sender));
}

async function tryRecoverStalledVideoSender(sender: RTCRtpSender, reason: string) {
    if (!senderPeerConnections.get(sender)) {
        return false;
    }

    const state = getSenderRecoveryState(sender);
    if (state.inRecovery) {
        return false;
    }

    const { track } = sender;
    if (!track || !isManagedScreenShareTrack(track)) {
        return false;
    }

    const now = Date.now();
    if (state.lastRecoveryAt !== void 0 && now - state.lastRecoveryAt < screenShareRecoveryCooldownMs) {
        return false;
    }

    state.inRecovery = true;
    state.lastRecoveryAt = now;

    try {
        const localConnection = findLocalStreamConnection(track);

        try {
            const clonedTrack = track.clone();
            clonedTrack.contentHint = track.contentHint;
            clonedTrack.enabled = track.enabled;
            rememberManagedScreenShareModeTrack(clonedTrack);

            await replaceTrackDuringRecovery(sender, clonedTrack);
            await syncRecoveredScreenShareSender(sender, clonedTrack, localConnection);

            const synchronizedDesktopTrack = trySyncLocalDesktopTrack(localConnection, track, clonedTrack);
            if (!synchronizedDesktopTrack) {
                await tryKickConnectionNegotiation(localConnection);
            }

            scheduleActiveScreenShareTrackSync();

            if (synchronizedDesktopTrack) {
                retireReplacedScreenShareTrack(track, clonedTrack);
            }
        } catch (cloneReplaceError) {
            logger.error("Cloned-track recovery step failed, trying null-track rebound fallback", cloneReplaceError);

            await replaceTrackDuringRecovery(sender, null);
            await replaceTrackDuringRecovery(sender, track);
            await syncRecoveredScreenShareSender(sender, track, localConnection);

            await tryKickConnectionNegotiation(localConnection);
            scheduleActiveScreenShareTrackSync();
        }

        return true;
    } catch (error) {
        logger.error(`Failed screenshare sender recovery (${reason})`, error);
        return false;
    } finally {
        state.inRecovery = false;
    }
}

async function recoverActiveScreenShareSenders(reason: string) {
    const recoveries = [] as Array<Promise<boolean>>;

    for (const pc of trackedScreenSharePeerConnections) {
        if (pc.connectionState === "closed" || pc.iceConnectionState === "closed") {
            trackedScreenSharePeerConnections.delete(pc);
            continue;
        }

        for (const sender of pc.getSenders()) {
            const { track } = sender;
            if (!track || !isManagedScreenShareTrack(track) || track.readyState !== "live") {
                continue;
            }

            if (!(await shouldRecoverSenderForAudienceEvent(sender, reason))) {
                continue;
            }

            recoveries.push(tryRecoverStalledVideoSender(sender, reason));
        }
    }

    if (!recoveries.length) {
        return false;
    }

    const results = await Promise.all(recoveries);
    return results.some(Boolean);
}

function primeActiveScreenShareProfileSync() {
    scheduleCurrentUserScreenShareVideoStreamParameterSync();
    scheduleActiveScreenShareTrackSync(true);
}

function scheduleViewerAudienceRecovery(reason: "viewer-attach" | "viewer-rejoin", streamIdentity: string) {
    clearViewerRejoinRecoveryTimer();

    const currentSequence = ++viewerRejoinRecoverySequence;

    primeActiveScreenShareProfileSync();

    viewerRejoinRecoveryTimer = window.setTimeout(
        () => {
            viewerRejoinRecoveryTimer = void 0;

            if (
                currentSequence !== viewerRejoinRecoverySequence ||
                selfStreamViewerMonitorState.streamIdentity !== streamIdentity ||
                selfStreamViewerMonitorState.viewerCount === 0
            ) {
                return;
            }

            void recoverActiveScreenShareSenders(reason);
        },
        reason === "viewer-attach" ? viewerAttachRecoveryDelayMs : viewerRejoinRecoveryDelayMs
    );
}

function scheduleRemoteSinkRecovery(reason: "viewer-attach" | "viewer-rejoin") {
    clearViewerRejoinRecoveryTimer();

    const currentSequence = ++viewerRejoinRecoverySequence;

    primeActiveScreenShareProfileSync();

    viewerRejoinRecoveryTimer = window.setTimeout(
        () => {
            viewerRejoinRecoveryTimer = void 0;

            if (currentSequence !== viewerRejoinRecoverySequence || !remoteSinkMonitorState.hadPositiveSink) {
                return;
            }

            void recoverActiveScreenShareSenders(reason);
        },
        reason === "viewer-attach" ? viewerAttachRecoveryDelayMs : viewerRejoinRecoveryDelayMs
    );
}

function handleRemoteVideoSinkWants(action: RemoteVideoSinkWantsAction) {
    try {
        if (!hasActiveScreenShareSender()) {
            resetRemoteSinkMonitorState();
            return;
        }

        const { hadPositiveSink } = remoteSinkMonitorState;
        const hasPositiveSinkDemand = hasPositiveRemoteSinkDemand(action.wants);

        if (!hasPositiveSinkDemand) {
            if (remoteSinkMonitorState.hadPositiveSink) {
                remoteSinkMonitorState.hadPositiveSink = false;
                remoteSinkMonitorState.rejoinArmed = true;
            }

            return;
        }

        remoteSinkMonitorState.hadPositiveSink = true;

        if (remoteSinkMonitorState.rejoinArmed) {
            remoteSinkMonitorState.rejoinArmed = false;
            selfStreamViewerMonitorState.rejoinArmed = false;
            scheduleRemoteSinkRecovery("viewer-rejoin");
            return;
        }

        if (!hadPositiveSink) {
            scheduleRemoteSinkRecovery("viewer-attach");
        }
    } catch (error) {
        logger.error("Failed to evaluate remote video sink wants", error);
    }
}

function handleSelfStreamViewerStateChange(streamingStore: ApplicationStreamingStoreLike) {
    try {
        const currentUserId = UserStore.getCurrentUser()?.id;
        const stream = streamingStore.getCurrentUserActiveStream?.();
        const hasTrackedScreenShareSender = hasActiveScreenShareSender();

        if (!currentUserId) {
            resetSelfStreamViewerState();
            return;
        }

        if (!stream || stream.ownerId !== currentUserId) {
            if (
                hasTrackedScreenShareSender &&
                selfStreamViewerMonitorState.streamIdentity &&
                selfStreamViewerMonitorState.viewerCount > 0
            ) {
                selfStreamViewerMonitorState.rejoinArmed = true;
                selfStreamViewerMonitorState.viewerCount = 0;
                clearViewerRejoinRecoveryTimer();
                return;
            }

            if (hasTrackedScreenShareSender && selfStreamViewerMonitorState.streamIdentity) {
                return;
            }

            resetSelfStreamViewerState();
            return;
        }

        const streamIdentity = getApplicationStreamIdentity(stream);
        if (!streamIdentity) {
            if (hasTrackedScreenShareSender && selfStreamViewerMonitorState.streamIdentity) {
                return;
            }

            resetSelfStreamViewerState();
            return;
        }

        const viewerIds = streamingStore.getViewerIds?.(stream) ?? [];
        const viewerCount = viewerIds.length;

        if (selfStreamViewerMonitorState.streamIdentity !== streamIdentity) {
            clearViewerRejoinRecoveryTimer();
            selfStreamViewerMonitorState.hadViewer = viewerCount > 0;
            selfStreamViewerMonitorState.rejoinArmed = false;
            selfStreamViewerMonitorState.streamIdentity = streamIdentity;
            selfStreamViewerMonitorState.viewerCount = viewerCount;
            return;
        }

        const previousViewerCount = selfStreamViewerMonitorState.viewerCount;
        selfStreamViewerMonitorState.viewerCount = viewerCount;

        if (previousViewerCount > 0 && viewerCount === 0) {
            selfStreamViewerMonitorState.rejoinArmed = true;
            clearViewerRejoinRecoveryTimer();
            return;
        }

        if (previousViewerCount === 0 && viewerCount > 0) {
            const recoveryReason = selfStreamViewerMonitorState.hadViewer ? "viewer-rejoin" : "viewer-attach";
            selfStreamViewerMonitorState.rejoinArmed = false;
            scheduleViewerAudienceRecovery(recoveryReason, streamIdentity);
        }

        if (viewerCount > 0) {
            selfStreamViewerMonitorState.hadViewer = true;
        }
    } catch (error) {
        logger.error("Failed to evaluate screenshare viewer state", error);
    }
}

function attachPeerConnectionFixes() {
    const originalAddTrack = RTCPeerConnection.prototype.addTrack;
    RTCPeerConnection.prototype.addTrack = function (track, ...streams) {
        const sender = originalAddTrack.call(this, track, ...streams);
        attachManagedScreenShareSender(this, sender, track);
        return sender;
    };

    const originalAddTransceiver = RTCPeerConnection.prototype.addTransceiver;
    RTCPeerConnection.prototype.addTransceiver = function (trackOrKind, init) {
        const transceiver =
            init === void 0
                ? originalAddTransceiver.call(this, trackOrKind)
                : originalAddTransceiver.call(this, trackOrKind, init);

        attachManagedScreenShareSender(this, transceiver.sender, typeof trackOrKind === "string" ? null : trackOrKind);
        return transceiver;
    };

    const originalReplaceTrack = RTCRtpSender.prototype.replaceTrack;
    RTCRtpSender.prototype.replaceTrack = function (track) {
        const isRecoveryManagedReplace = recoveryManagedReplaceTrackSenders.has(this);
        const previousTrack = this.track;

        if (!track || !isManagedScreenShareTrack(track)) {
            senderRecoveryStates.delete(this);
        } else {
            rememberManagedScreenShareModeTrack(track);

            if (previousTrack) {
                rememberLocalConnectionTrack(track, trackLocalConnectionHints.get(previousTrack));
            }

            if (!isRecoveryManagedReplace) {
                scheduleCurrentUserScreenShareVideoStreamParameterSync();
            }
        }

        if (isManagedScreenShareTrack(track)) {
            const pc = senderPeerConnections.get(this);
            if (pc) {
                trackPeerConnection(pc);
            }
        }

        const replaceTrackResult = originalReplaceTrack.call(this, track);

        if (track && isManagedScreenShareTrack(track) && !isRecoveryManagedReplace) {
            void Promise.resolve(replaceTrackResult)
                .then(async () => {
                    await syncManagedScreenShareTrackConstraints(track, findLocalStreamConnection(track), true);
                    await syncManagedScreenShareSenderParameters(this);
                })
                .catch(error => logger.error("Failed to resync screenshare sender after replaceTrack", error));
        }

        return replaceTrackResult;
    };
}

function buildDisplayMediaRequestOptions(opts: DisplayMediaStreamOptionsLike | undefined, desiredContentHint: string) {
    if (desiredContentHint !== "detail" && desiredContentHint !== "motion") {
        return opts;
    }

    const nextOptions = { ...(opts ?? {}) } as DisplayMediaStreamOptionsLike;
    if (nextOptions.video === false) {
        return opts;
    }

    const baseVideoConstraints =
        typeof nextOptions.video === "object" && nextOptions.video !== null ? nextOptions.video : {};

    nextOptions.video = buildManagedScreenShareRequestConstraints(
        baseVideoConstraints,
        getSelectedScreenShareProfile()
    );
    return nextOptions;
}

if (isLinux) {
    attachPeerConnectionFixes();

    onceReady.then(() => {
        if (!FluxDispatcher?.subscribe) {
            logger.error("FluxDispatcher unavailable for screenshare remote sink monitoring");
            return;
        }

        FluxDispatcher.subscribe("STREAM_CLOSE", ({ streamKey }: { streamKey: string }) => {
            const owner = streamKey.split(":").at(-1);

            if (owner === UserStore.getCurrentUser()?.id) {
                resetSelfStreamViewerState();
            }
        });

        FluxDispatcher.subscribe("RTC_CONNECTION_REMOTE_VIDEO_SINK_WANTS", (action: RemoteVideoSinkWantsAction) => {
            handleRemoteVideoSinkWants(action);
        });
    });

    waitFor(filters.byStoreName("ApplicationStreamingStore"), store => {
        const streamingStore = store as ApplicationStreamingStoreLike;

        if (typeof streamingStore.addChangeListener === "function") {
            streamingStore.addChangeListener(() => handleSelfStreamViewerStateChange(streamingStore));
        }

        handleSelfStreamViewerStateChange(streamingStore);
    });

    State.addGlobalChangeListener((_data, path) => {
        if (path !== "screenshareQuality" && !path.startsWith("screenshareQuality.")) {
            return;
        }

        scheduleCurrentUserScreenShareVideoStreamParameterSync();
        scheduleActiveScreenShareTrackSync(true);
    });

    const originalGetDisplayMedia = navigator.mediaDevices.getDisplayMedia;

    async function getVirtmic() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioDevice = devices.find(({ label }) => label === "vencord-screen-share");
            return audioDevice?.deviceId;
        } catch {
            return null;
        }
    }

    navigator.mediaDevices.getDisplayMedia = async function (opts) {
        const desiredContentHint =
            typeof currentSettings?.contentHint === "string" ? currentSettings.contentHint : "detail";
        resetSelfStreamViewerState();
        const stream = await originalGetDisplayMedia.call(
            this,
            buildDisplayMediaRequestOptions(opts, desiredContentHint)
        );
        const id = await getVirtmic();
        const [track] = stream.getVideoTracks();

        if (!track) {
            return stream;
        }

        track.contentHint = desiredContentHint;

        rememberManagedScreenShareModeTrack(track);

        scheduleCurrentUserScreenShareVideoStreamParameterSync();
        scheduleActiveScreenShareTrackSync();
        void syncManagedScreenShareTrackConstraints(track, null, true);

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

            const [audioTrack] = audio.getAudioTracks();
            if (audioTrack) {
                stream.getAudioTracks().forEach(track => stream.removeTrack(track));
                stream.addTrack(audioTrack);
            }
        }

        return stream;
    };
}
