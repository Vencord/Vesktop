/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./screenSharePicker.css";

import { classNameFactory } from "@vencord/types/api/Styles";
import {
    BaseText,
    Button,
    Card,
    CogWheel,
    FormSwitch,
    Heading,
    HeadingTertiary,
    Margins,
    Paragraph,
    RestartIcon,
    Span
} from "@vencord/types/components";
import {
    closeModal,
    Logger,
    ModalCloseButton,
    Modals,
    ModalSize,
    openModal,
    useAwaiter,
    useForceUpdater
} from "@vencord/types/utils";
import { onceReady } from "@vencord/types/webpack";
import { FluxDispatcher, MediaEngineStore, Select, UserStore, useState } from "@vencord/types/webpack/common";
import { Node } from "@vencord/venmic";
import type { Dispatch, SetStateAction } from "react";
import { addPatch } from "renderer/patches/shared";
import { State, useSettings, useVesktopState } from "renderer/settings";
import { isLinux, isWindows } from "renderer/utils";

import { SimpleErrorBoundary } from "./SimpleErrorBoundary";

const StreamResolutions = ["480", "720", "1080", "1440", "2160"] as const;
const StreamFps = ["15", "30", "60"] as const;
export const screenShareBitrateMin = 500000;
export const screenShareBitrateMaxFloor = 8000000;
export const screenShareBitrateTarget = 600000;
const screenSharePixelCountGuardKey = "__vesktopScreenSharePixelCountGuard";
const screenShareVideoStreamParametersGuardKey = "__vesktopScreenShareVideoStreamParametersGuard";
const screenShareMaxResolutionGuardKey = "__vesktopScreenShareMaxResolutionGuard";
const screenShareVideoStreamParameterListGuardKey = "__vesktopScreenShareVideoStreamParameterListGuard";
const screenShareSyncDelaysMs = [0, 10, 50, 100, 250, 500, 1000];

const cl = classNameFactory("vcd-screen-picker-");

export type StreamResolution = (typeof StreamResolutions)[number];
export type StreamFps = (typeof StreamFps)[number];

type SpecialSource = "None" | "Entire System";

type AudioSource = SpecialSource | Node;
type AudioSources = SpecialSource | Node[];

interface AudioItem {
    name: string;
    value: AudioSource;
}

interface StreamSettings {
    audio: boolean;
    contentHint?: string;
    includeSources?: AudioSources;
    excludeSources?: AudioSources;
}

export interface StreamPick extends StreamSettings {
    id: string;
}

interface Source {
    id: string;
    name: string;
    url: string;
}

interface ScreenShareProfile {
    frameRate: number;
    height: number;
    width: number;
    pixelCount: number;
}

interface ScreenShareBitrateProfile {
    min: number;
    target: number;
    max: number;
}

export interface ScreenShareVideoStreamParameters {
    maxBitrate?: number;
    maxFrameRate?: number;
    maxPixelCount?: number;
    minBitrate?: number;
    targetBitrate?: number;
    maxResolution?: {
        type?: string;
        width?: number;
        height?: number;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

interface MediaEngineConnectionLike {
    streamUserId?: string;
    input?: {
        desktop?: {
            stream?: {
                getVideoTracks?: () => MediaStreamTrack[];
            };
        };
    };
    videoStreamParameters?: Array<ScreenShareVideoStreamParameters | undefined>;
}

export let currentSettings: StreamSettings | null = null;

const logger = new Logger("VesktopScreenShare");
let screenShareParameterSyncSequence = 0;

function getCurrentUserMediaEngineConnections() {
    try {
        const currentUserId = UserStore.getCurrentUser()?.id;
        if (!currentUserId) {
            return [] as MediaEngineConnectionLike[];
        }

        return [...MediaEngineStore.getMediaEngine().connections].filter(
            candidate => candidate.streamUserId === currentUserId
        ) as MediaEngineConnectionLike[];
    } catch (error) {
        logger.error("Failed to enumerate media engine connections for screenshare sync.", error);
        return [];
    }
}

function hasDesktopVideoTrack(connection: MediaEngineConnectionLike) {
    return Boolean(connection.input?.desktop?.stream?.getVideoTracks?.().some(track => track.kind === "video"));
}

function getCurrentUserScreenShareVideoStreamParameterTargets() {
    const connections = getCurrentUserMediaEngineConnections();
    if (!connections.length) {
        return [];
    }

    const preferredConnections = connections.filter(hasDesktopVideoTrack);
    return preferredConnections.length ? preferredConnections : connections.slice(0, 1);
}

export function getSelectedScreenShareProfile(): ScreenShareProfile {
    const { screenshareQuality } = State.store;
    const frameRate = Number(screenshareQuality?.frameRate ?? 30);
    const height = Number(screenshareQuality?.resolution ?? 720);
    const width = Math.round(height * (16 / 9));

    return {
        frameRate,
        height,
        width,
        pixelCount: height * width
    };
}

function normalizeScreenShareBitrate(value: unknown) {
    const bitrate = Number(value);
    return Number.isFinite(bitrate) && bitrate > 0 ? Math.round(bitrate) : void 0;
}

function applyScreenShareBitrateFloor(value: number) {
    return Math.max(screenShareBitrateMin, Math.round(value));
}

export function getSelectedScreenShareBitrateProfile(
    profile: ScreenShareProfile = getSelectedScreenShareProfile()
): ScreenShareBitrateProfile {
    let min = screenShareBitrateMin;
    let target = screenShareBitrateTarget;

    if (profile.height >= 2160) {
        min = 4000000;
        target = 6000000;
    } else if (profile.height >= 1440) {
        min = 3000000;
        target = 5000000;
    } else if (profile.height >= 1080) {
        min = 2000000;
        target = 3500000;
    } else if (profile.height >= 720) {
        min = 1200000;
        target = 2000000;
    } else {
        min = 700000;
        target = 1000000;
    }

    if (profile.frameRate >= 60) {
        min = Math.round(min * 1.25);
        target = Math.round(target * 1.25);
    } else if (profile.frameRate <= 15) {
        min = Math.round(min * 0.9);
        target = Math.round(target * 0.9);
    }

    min = applyScreenShareBitrateFloor(min);
    target = applyScreenShareBitrateFloor(Math.max(target, min));

    return {
        min,
        target,
        max: screenShareBitrateMaxFloor
    };
}

function getScreenShareBitrateValueAtLeast(value: unknown, floor: number) {
    return normalizeScreenShareBitrate(value) ?? applyScreenShareBitrateFloor(floor);
}

function installScreenSharePixelCountGuard(videoStreamParameters: ScreenShareVideoStreamParameters) {
    const guardedStreamParameters = videoStreamParameters as Record<string, unknown>;
    if (guardedStreamParameters[screenSharePixelCountGuardKey]) {
        return;
    }

    Object.defineProperty(videoStreamParameters, "maxPixelCount", {
        configurable: true,
        enumerable: true,
        get() {
            return getSelectedScreenShareProfile().pixelCount;
        },
        set() {
            // Always reflect the currently selected profile on reads.
        }
    });

    Object.defineProperty(videoStreamParameters, screenSharePixelCountGuardKey, {
        configurable: false,
        enumerable: false,
        value: true,
        writable: false
    });
}

function installScreenShareMaxResolutionGuard(
    maxResolution: ScreenShareVideoStreamParameters["maxResolution"]
): NonNullable<ScreenShareVideoStreamParameters["maxResolution"]> {
    const guardedMaxResolution = (
        typeof maxResolution === "object" && maxResolution !== null ? maxResolution : {}
    ) as NonNullable<ScreenShareVideoStreamParameters["maxResolution"]> & Record<string, unknown>;

    if (guardedMaxResolution[screenShareMaxResolutionGuardKey]) {
        return guardedMaxResolution;
    }

    Object.defineProperty(guardedMaxResolution, "type", {
        configurable: true,
        enumerable: true,
        get() {
            return "fixed";
        },
        set() {
            // Always reflect a fixed resolution profile on reads.
        }
    });

    Object.defineProperty(guardedMaxResolution, "width", {
        configurable: true,
        enumerable: true,
        get() {
            return getSelectedScreenShareProfile().width;
        },
        set() {
            // Always reflect the currently selected profile on reads.
        }
    });

    Object.defineProperty(guardedMaxResolution, "height", {
        configurable: true,
        enumerable: true,
        get() {
            return getSelectedScreenShareProfile().height;
        },
        set() {
            // Always reflect the currently selected profile on reads.
        }
    });

    Object.defineProperty(guardedMaxResolution, screenShareMaxResolutionGuardKey, {
        configurable: false,
        enumerable: false,
        value: true,
        writable: false
    });

    return guardedMaxResolution;
}

function installScreenShareVideoStreamParameterGuards(videoStreamParameters: ScreenShareVideoStreamParameters) {
    const guardedStreamParameters = videoStreamParameters as Record<string, unknown>;
    if (guardedStreamParameters[screenShareVideoStreamParametersGuardKey]) {
        return;
    }

    let maxResolution = installScreenShareMaxResolutionGuard(videoStreamParameters.maxResolution);
    let maxBitrate = normalizeScreenShareBitrate(videoStreamParameters.maxBitrate);
    let minBitrate = normalizeScreenShareBitrate(videoStreamParameters.minBitrate);
    let targetBitrate = normalizeScreenShareBitrate(videoStreamParameters.targetBitrate);

    installScreenSharePixelCountGuard(videoStreamParameters);

    Object.defineProperty(videoStreamParameters, "maxBitrate", {
        configurable: true,
        enumerable: true,
        get() {
            return getScreenShareBitrateValueAtLeast(maxBitrate, getSelectedScreenShareBitrateProfile().max);
        },
        set(value) {
            maxBitrate = normalizeScreenShareBitrate(value);
        }
    });

    Object.defineProperty(videoStreamParameters, "minBitrate", {
        configurable: true,
        enumerable: true,
        get() {
            return getScreenShareBitrateValueAtLeast(minBitrate, getSelectedScreenShareBitrateProfile().min);
        },
        set(value) {
            minBitrate = normalizeScreenShareBitrate(value);
        }
    });

    Object.defineProperty(videoStreamParameters, "targetBitrate", {
        configurable: true,
        enumerable: true,
        get() {
            return getScreenShareBitrateValueAtLeast(targetBitrate, getSelectedScreenShareBitrateProfile().target);
        },
        set(value) {
            targetBitrate = normalizeScreenShareBitrate(value);
        }
    });

    Object.defineProperty(videoStreamParameters, "maxFrameRate", {
        configurable: true,
        enumerable: true,
        get() {
            return getSelectedScreenShareProfile().frameRate;
        },
        set() {
            // Always reflect the currently selected profile on reads.
        }
    });

    Object.defineProperty(videoStreamParameters, "maxResolution", {
        configurable: true,
        enumerable: true,
        get() {
            return maxResolution;
        },
        set(value) {
            maxResolution = installScreenShareMaxResolutionGuard(value);
            maxResolution.type = "fixed";
            maxResolution.width = getSelectedScreenShareProfile().width;
            maxResolution.height = getSelectedScreenShareProfile().height;
        }
    });

    Object.defineProperty(videoStreamParameters, screenShareVideoStreamParametersGuardKey, {
        configurable: false,
        enumerable: false,
        value: true,
        writable: false
    });
}

function installScreenShareVideoStreamParameterListGuard(
    videoStreamParameters: Array<ScreenShareVideoStreamParameters | undefined> | undefined
) {
    if (!Array.isArray(videoStreamParameters)) {
        return videoStreamParameters;
    }

    const guardedParameterList = videoStreamParameters as Array<ScreenShareVideoStreamParameters | undefined> &
        Record<string, unknown>;

    if (guardedParameterList[screenShareVideoStreamParameterListGuardKey]) {
        const currentPrimaryParameters = guardedParameterList[0];
        if (currentPrimaryParameters) {
            installScreenShareVideoStreamParameterGuards(currentPrimaryParameters);
        }

        return videoStreamParameters;
    }

    let primaryParameters = guardedParameterList[0];
    if (primaryParameters) {
        installScreenShareVideoStreamParameterGuards(primaryParameters);
    }

    Object.defineProperty(guardedParameterList, "0", {
        configurable: true,
        enumerable: true,
        get() {
            return primaryParameters;
        },
        set(value: ScreenShareVideoStreamParameters | undefined) {
            if (value) {
                installScreenShareVideoStreamParameterGuards(value);
            }

            primaryParameters = value;
        }
    });

    Object.defineProperty(guardedParameterList, screenShareVideoStreamParameterListGuardKey, {
        configurable: false,
        enumerable: false,
        value: true,
        writable: false
    });

    return videoStreamParameters;
}

export function getScreenShareConnectionVideoStreamParameters(
    connection:
        | {
              videoStreamParameters?: Array<ScreenShareVideoStreamParameters | undefined>;
          }
        | null
        | undefined
) {
    const guardedParameterList = installScreenShareVideoStreamParameterListGuard(connection?.videoStreamParameters);
    const currentPrimaryParameters = guardedParameterList?.[0];

    if (currentPrimaryParameters) {
        installScreenShareVideoStreamParameterGuards(currentPrimaryParameters);
    }

    return currentPrimaryParameters;
}

export function syncSelectedScreenShareVideoStreamParameters(
    videoStreamParameters: ScreenShareVideoStreamParameters | null | undefined
) {
    if (!videoStreamParameters) {
        return;
    }

    installScreenShareVideoStreamParameterGuards(videoStreamParameters);

    const profile = getSelectedScreenShareProfile();
    const bitrateProfile = getSelectedScreenShareBitrateProfile(profile);

    videoStreamParameters.maxBitrate = getScreenShareBitrateValueAtLeast(
        videoStreamParameters.maxBitrate,
        bitrateProfile.max
    );
    videoStreamParameters.maxFrameRate = profile.frameRate;
    videoStreamParameters.maxPixelCount = profile.pixelCount;
    videoStreamParameters.minBitrate = getScreenShareBitrateValueAtLeast(
        videoStreamParameters.minBitrate,
        bitrateProfile.min
    );
    videoStreamParameters.targetBitrate = getScreenShareBitrateValueAtLeast(
        videoStreamParameters.targetBitrate,
        bitrateProfile.target
    );

    const maxResolution = videoStreamParameters.maxResolution ?? (videoStreamParameters.maxResolution = {});
    maxResolution.type = "fixed";
    maxResolution.height = profile.height;
    maxResolution.width = profile.width;
}

export function syncCurrentUserScreenShareVideoStreamParameters() {
    if (!isLinux) {
        return;
    }

    for (const connection of getCurrentUserScreenShareVideoStreamParameterTargets()) {
        syncSelectedScreenShareVideoStreamParameters(getScreenShareConnectionVideoStreamParameters(connection));
    }
}

export function scheduleCurrentUserScreenShareVideoStreamParameterSync() {
    if (!isLinux) {
        return;
    }

    const currentSequence = ++screenShareParameterSyncSequence;

    syncCurrentUserScreenShareVideoStreamParameters();

    for (const delayMs of screenShareSyncDelaysMs) {
        window.setTimeout(() => {
            if (currentSequence !== screenShareParameterSyncSequence) {
                return;
            }

            syncCurrentUserScreenShareVideoStreamParameters();
        }, delayMs);
    }
}

addPatch({
    patches: [
        {
            find: "this.getDefaultGoliveQuality()",
            replacement: {
                match: /this\.getDefaultGoliveQuality\(\)/,
                replace: "$self.patchStreamQuality($&)"
            }
        }
    ],
    patchStreamQuality(opts: any) {
        if (!State.store.screenshareQuality) return opts;
        const profile = getSelectedScreenShareProfile();

        Object.assign(opts, {
            // Keep the upstream global bitrate policy stable. Linux-specific
            // runtime parameter recovery happens in the Linux patch path.
            bitrateMin: getScreenShareBitrateValueAtLeast(opts?.bitrateMin, screenShareBitrateMin),
            bitrateMax: getScreenShareBitrateValueAtLeast(opts?.bitrateMax, screenShareBitrateMaxFloor),
            bitrateTarget: getScreenShareBitrateValueAtLeast(opts?.bitrateTarget, screenShareBitrateTarget)
        });
        if (opts?.encode) {
            Object.assign(opts.encode, {
                framerate: profile.frameRate,
                width: profile.width,
                height: profile.height,
                pixelCount: profile.pixelCount
            });
        }
        Object.assign(opts.capture, {
            framerate: profile.frameRate,
            width: profile.width,
            height: profile.height,
            pixelCount: profile.pixelCount
        });
        return opts;
    }
});

if (isLinux) {
    onceReady.then(() => {
        FluxDispatcher.subscribe("STREAM_CLOSE", ({ streamKey }: { streamKey: string }) => {
            const owner = streamKey.split(":").at(-1);

            if (owner !== UserStore.getCurrentUser().id) {
                return;
            }

            VesktopNative.virtmic.stop();
        });
    });
}

export function openScreenSharePicker(screens: Source[], skipPicker: boolean) {
    let didSubmit = false;
    return new Promise<StreamPick>((resolve, reject) => {
        const key = openModal(
            props => (
                <ModalComponent
                    screens={screens}
                    modalProps={props}
                    submit={async v => {
                        didSubmit = true;

                        if (v.includeSources && v.includeSources !== "None") {
                            if (v.includeSources === "Entire System") {
                                await VesktopNative.virtmic.startSystem(
                                    !v.excludeSources || isSpecialSource(v.excludeSources) ? [] : v.excludeSources
                                );
                            } else {
                                await VesktopNative.virtmic.start(v.includeSources);
                            }
                        }

                        resolve(v);
                    }}
                    close={() => {
                        props.onClose();
                        if (!didSubmit) reject("Aborted");
                    }}
                    skipPicker={skipPicker}
                />
            ),
            {
                onCloseRequest() {
                    closeModal(key);
                    reject("Aborted");
                },
                onCloseCallback() {
                    if (!didSubmit) reject("Aborted");
                }
            }
        );
    });
}

function ScreenPicker({ screens, chooseScreen }: { screens: Source[]; chooseScreen: (id: string) => void }) {
    return (
        <div className={cl("screen-grid")}>
            {screens.map(({ id, name, url }) => (
                <label key={id} className={cl("screen-label")}>
                    <input
                        type="radio"
                        className={cl("screen-radio")}
                        name="screen"
                        value={id}
                        onChange={() => chooseScreen(id)}
                    />

                    <img src={url} alt="" />
                    <Paragraph className={cl("screen-name")}>{name}</Paragraph>
                </label>
            ))}
        </div>
    );
}

function AudioSettingsModal({
    modalProps,
    close,
    setAudioSources
}: {
    modalProps: any;
    close: () => void;
    setAudioSources: (s: AudioSources) => void;
}) {
    const Settings = useSettings();

    return (
        <Modals.ModalRoot {...modalProps} size={ModalSize.MEDIUM}>
            <Modals.ModalHeader className={cl("header")}>
                <BaseText size="lg" weight="semibold" tag="h3" style={{ flexGrow: 1 }}>
                    Audio Settings
                </BaseText>
                <ModalCloseButton onClick={close} />
            </Modals.ModalHeader>

            <Modals.ModalContent className={cl("modal", "venmic-settings")}>
                <FormSwitch
                    title="Microphone Workaround"
                    description="Work around an issue that causes the microphone to be shared instead of the correct audio. Only enable if you're experiencing this issue."
                    hideBorder
                    onChange={v => (Settings.audio = { ...Settings.audio, workaround: v })}
                    value={Settings.audio?.workaround ?? false}
                />
                <FormSwitch
                    title="Only Speakers"
                    description={
                        'When sharing entire desktop audio, only share apps that play to a speaker. You may want to disable this when using "mix bussing".'
                    }
                    hideBorder
                    onChange={v => (Settings.audio = { ...Settings.audio, onlySpeakers: v })}
                    value={Settings.audio?.onlySpeakers ?? true}
                />
                <FormSwitch
                    title="Only Default Speakers"
                    description={
                        <>
                            When sharing entire desktop audio, only share apps that play to the <b>default</b> speakers.
                            You may want to disable this when using "mix bussing".
                        </>
                    }
                    hideBorder
                    onChange={v => (Settings.audio = { ...Settings.audio, onlyDefaultSpeakers: v })}
                    value={Settings.audio?.onlyDefaultSpeakers ?? true}
                />
                <FormSwitch
                    title="Ignore Inputs"
                    description="Exclude nodes that are intended to capture audio."
                    hideBorder
                    onChange={v => (Settings.audio = { ...Settings.audio, ignoreInputMedia: v })}
                    value={Settings.audio?.ignoreInputMedia ?? true}
                />
                <FormSwitch
                    title="Ignore Virtual"
                    description={
                        'Exclude virtual nodes, such as nodes belonging to loopbacks. This might be useful when using "mix bussing".'
                    }
                    hideBorder
                    onChange={v => (Settings.audio = { ...Settings.audio, ignoreVirtual: v })}
                    value={Settings.audio?.ignoreVirtual ?? false}
                />
                <FormSwitch
                    title="Ignore Devices"
                    description="Exclude device nodes, such as nodes belonging to microphones or speakers."
                    hideBorder
                    onChange={v =>
                        (Settings.audio = {
                            ...Settings.audio,
                            ignoreDevices: v,
                            deviceSelect: v ? false : Settings.audio?.deviceSelect
                        })
                    }
                    value={Settings.audio?.ignoreDevices ?? true}
                />
                <FormSwitch
                    title="Granular Selection"
                    description="Allow to select applications more granularly."
                    hideBorder
                    onChange={value => {
                        Settings.audio = { ...Settings.audio, granularSelect: value };
                        setAudioSources("None");
                    }}
                    value={Settings.audio?.granularSelect ?? false}
                />
                <FormSwitch
                    title="Device Selection"
                    description={
                        <>
                            Allow to select devices such as microphones. Requires <b>Ignore Devices</b> to be turned
                            off.
                        </>
                    }
                    hideBorder
                    onChange={value => {
                        Settings.audio = { ...Settings.audio, deviceSelect: value };
                        setAudioSources("None");
                    }}
                    value={Settings.audio?.deviceSelect ?? false}
                    disabled={Settings.audio?.ignoreDevices}
                />
            </Modals.ModalContent>
            <Modals.ModalFooter className={cl("footer")}>
                <Button variant="secondary" onClick={close}>
                    Back
                </Button>
            </Modals.ModalFooter>
        </Modals.ModalRoot>
    );
}

function OptionRadio<Settings extends object, Key extends keyof Settings>(props: {
    options: Array<string> | ReadonlyArray<string>;
    labels?: Array<string>;
    settings: Settings;
    settingsKey: Key;
    onChange: (option: string) => void;
}) {
    const { options, settings, settingsKey, labels, onChange } = props;

    return (
        <div className={cl("option-radios")}>
            {(options as string[]).map((option, idx) => (
                <label className={cl("option-radio")} data-checked={settings[settingsKey] === option} key={option}>
                    <Span weight="bold">{labels?.[idx] ?? option}</Span>
                    <input
                        className={cl("option-input")}
                        type="radio"
                        name="fps"
                        value={option}
                        checked={settings[settingsKey] === option}
                        onChange={() => onChange(option)}
                    />
                </label>
            ))}
        </div>
    );
}

function StreamSettingsUi({
    source,
    settings,
    setSettings,
    skipPicker
}: {
    source: Source;
    settings: StreamSettings;
    setSettings: Dispatch<SetStateAction<StreamSettings>>;
    skipPicker: boolean;
}) {
    const Settings = useSettings();
    const qualitySettings = State.store.screenshareQuality!;

    const [thumb] = useAwaiter(
        () => (skipPicker ? Promise.resolve(source.url) : VesktopNative.capturer.getLargeThumbnail(source.id)),
        {
            fallbackValue: source.url,
            deps: [source.id]
        }
    );

    const openSettings = () => {
        openModal(props => (
            <AudioSettingsModal
                modalProps={props}
                close={() => props.onClose()}
                setAudioSources={sources =>
                    setSettings(s => ({ ...s, includeSources: sources, excludeSources: sources }))
                }
            />
        ));
    };

    return (
        <div>
            <HeadingTertiary className={Margins.bottom8}>What you're streaming</HeadingTertiary>
            <Card className={cl("card", "preview")}>
                <img src={thumb} alt="" className={cl(isLinux ? "preview-img-linux" : "preview-img")} />
                <Paragraph>{source.name}</Paragraph>
            </Card>

            <HeadingTertiary className={Margins.bottom8}>Stream Settings</HeadingTertiary>

            <Card className={cl("card")}>
                <div className={cl("quality")}>
                    <section className={cl("quality-section")}>
                        <Heading tag="h5">Resolution</Heading>
                        <OptionRadio
                            options={StreamResolutions}
                            settings={qualitySettings}
                            settingsKey="resolution"
                            onChange={value => (qualitySettings.resolution = value)}
                        />
                    </section>

                    <section className={cl("quality-section")}>
                        <Heading tag="h5">Frame Rate</Heading>
                        <OptionRadio
                            options={StreamFps}
                            settings={qualitySettings}
                            settingsKey="frameRate"
                            onChange={value => (qualitySettings.frameRate = value)}
                        />
                    </section>
                </div>
                <div className={cl("quality")}>
                    <section className={cl("quality-section")}>
                        <Heading tag="h5">Content Type</Heading>
                        <div>
                            <OptionRadio
                                options={["motion", "detail"]}
                                labels={["Prefer Smoothness", "Prefer Clarity"]}
                                settings={settings}
                                settingsKey="contentHint"
                                onChange={option => setSettings(s => ({ ...s, contentHint: option }))}
                            />

                            <Paragraph className={Margins.top8}>
                                Choosing "Prefer Clarity" will result in a significantly lower framerate in exchange for
                                a much sharper and clearer image.
                            </Paragraph>
                        </div>
                        {isWindows && (
                            <FormSwitch
                                title="Stream With Audio"
                                hideBorder
                                value={settings.audio}
                                onChange={checked => setSettings(s => ({ ...s, audio: checked }))}
                                className={cl("audio")}
                            />
                        )}
                    </section>
                </div>

                {isLinux && (
                    <AudioSourcePickerLinux
                        openSettings={openSettings}
                        includeSources={settings.includeSources}
                        excludeSources={settings.excludeSources}
                        deviceSelect={Settings.audio?.deviceSelect}
                        granularSelect={Settings.audio?.granularSelect}
                        setIncludeSources={sources => setSettings(s => ({ ...s, includeSources: sources }))}
                        setExcludeSources={sources => setSettings(s => ({ ...s, excludeSources: sources }))}
                    />
                )}
            </Card>
        </div>
    );
}

function isSpecialSource(value?: AudioSource | AudioSources): value is SpecialSource {
    return typeof value === "string";
}

function hasMatchingProps(value: Node, other: Node) {
    return Object.keys(value).every(key => value[key] === other[key]);
}

function mapToAudioItem(node: AudioSource, granularSelect?: boolean, deviceSelect?: boolean): AudioItem[] {
    if (isSpecialSource(node)) {
        return [{ name: node, value: node }];
    }

    const rtn: AudioItem[] = [];

    const mediaClass = node["media.class"];

    if (mediaClass?.includes("Video") || mediaClass?.includes("Midi")) {
        return rtn;
    }

    if (!deviceSelect && node["device.id"]) {
        return rtn;
    }

    const name = node["application.name"];

    if (name) {
        rtn.push({ name: name, value: { "application.name": name } });
    }

    if (!granularSelect) {
        return rtn;
    }

    const rawName = node["node.name"];

    if (!name) {
        rtn.push({ name: rawName, value: { "node.name": rawName } });
    }

    const binary = node["application.process.binary"];

    if (!name && binary) {
        rtn.push({ name: binary, value: { "application.process.binary": binary } });
    }

    const pid = node["application.process.id"];

    const first = rtn[0];
    const firstValues = first.value as Node;

    if (pid) {
        rtn.push({
            name: `${first.name} (${pid})`,
            value: { ...firstValues, "application.process.id": pid }
        });
    }

    const mediaName = node["media.name"];

    if (mediaName) {
        rtn.push({
            name: `${first.name} [${mediaName}]`,
            value: { ...firstValues, "media.name": mediaName }
        });
    }

    if (mediaClass) {
        rtn.push({
            name: `${first.name} [${mediaClass}]`,
            value: { ...firstValues, "media.class": mediaClass }
        });
    }

    return rtn;
}

function isItemSelected(sources?: AudioSources) {
    return (value: AudioSource) => {
        if (!sources) {
            return false;
        }

        if (isSpecialSource(sources) || isSpecialSource(value)) {
            return sources === value;
        }

        return sources.some(source => hasMatchingProps(source, value));
    };
}

function updateItems(setSources: (s: AudioSources) => void, sources?: AudioSources) {
    return (value: AudioSource) => {
        if (isSpecialSource(value)) {
            setSources(value);
            return;
        }

        if (isSpecialSource(sources)) {
            setSources([value]);
            return;
        }

        if (isItemSelected(sources)(value)) {
            setSources(sources?.filter(x => !hasMatchingProps(x, value)) ?? "None");
            return;
        }

        setSources([...(sources || []), value]);
    };
}

function AudioSourcePickerLinux({
    includeSources,
    excludeSources,
    deviceSelect,
    granularSelect,
    openSettings,
    setIncludeSources,
    setExcludeSources
}: {
    includeSources?: AudioSources;
    excludeSources?: AudioSources;
    deviceSelect?: boolean;
    granularSelect?: boolean;
    openSettings: () => void;
    setIncludeSources: (s: AudioSources) => void;
    setExcludeSources: (s: AudioSources) => void;
}) {
    const [audioSourcesSignal, refreshAudioSources] = useForceUpdater(true);
    const [sources, _, loading] = useAwaiter(() => VesktopNative.virtmic.list(), {
        fallbackValue: { ok: true, targets: [], hasPipewirePulse: true },
        deps: [audioSourcesSignal]
    });

    const hasPipewirePulse = sources.ok ? sources.hasPipewirePulse : true;
    const [ignorePulseWarning, setIgnorePulseWarning] = useState(false);

    if (!sources.ok && sources.isGlibCxxOutdated) {
        return (
            <Paragraph>
                Failed to retrieve Audio Sources because your C++ library is too old to run
                <a href="https://github.com/Vencord/venmic" target="_blank" rel="noreferrer">
                    venmic
                </a>
                . See{" "}
                <a
                    href="https://gist.github.com/Vendicated/b655044ffbb16b2716095a448c6d827a"
                    target="_blank"
                    rel="noreferrer"
                >
                    this guide
                </a>{" "}
                for possible solutions.
            </Paragraph>
        );
    }

    if (!hasPipewirePulse && !ignorePulseWarning) {
        return (
            <Paragraph>
                Could not find pipewire-pulse. See{" "}
                <a
                    href="https://gist.github.com/the-spyke/2de98b22ff4f978ebf0650c90e82027e#install"
                    target="_blank"
                    rel="noreferrer"
                >
                    this guide
                </a>{" "}
                on how to switch to pipewire. <br />
                You can still continue, however, please{" "}
                <b>beware that you can only share audio of apps that are running under pipewire</b>.{" "}
                <a onClick={() => setIgnorePulseWarning(true)}>I know what I'm doing!</a>
            </Paragraph>
        );
    }

    const specialSources: SpecialSource[] = ["None", "Entire System"] as const;

    const uniqueName = (value: AudioItem, index: number, list: AudioItem[]) =>
        list.findIndex(x => x.name === value.name) === index;

    const allSources = sources.ok
        ? [...specialSources, ...sources.targets]
              .map(target => mapToAudioItem(target, granularSelect, deviceSelect))
              .flat()
              .filter(uniqueName)
        : [];

    return (
        <>
            <div className={cl("audio-sources")}>
                <section>
                    <Heading tag="h5">{loading ? "Loading Sources..." : "Audio Sources"}</Heading>
                    <SimpleErrorBoundary>
                        <Select
                            options={allSources.map(({ name, value }) => ({
                                label: name,
                                value: value,
                                default: name === "None"
                            }))}
                            isSelected={isItemSelected(includeSources)}
                            select={updateItems(setIncludeSources, includeSources)}
                            serialize={String}
                            popoutPosition="top"
                            closeOnSelect={false}
                        />
                    </SimpleErrorBoundary>
                </section>
                {includeSources === "Entire System" && (
                    <section>
                        <Heading tag="h5">Exclude Sources</Heading>
                        <SimpleErrorBoundary>
                            <Select
                                options={allSources
                                    .filter(x => x.name !== "Entire System")
                                    .map(({ name, value }) => ({
                                        label: name,
                                        value: value,
                                        default: name === "None"
                                    }))}
                                isSelected={isItemSelected(excludeSources)}
                                select={updateItems(setExcludeSources, excludeSources)}
                                serialize={String}
                                popoutPosition="top"
                                closeOnSelect={false}
                            />
                        </SimpleErrorBoundary>
                    </section>
                )}
            </div>
            <div className={cl("settings-buttons")}>
                <Button variant="secondary" onClick={refreshAudioSources} className={cl("settings-button")}>
                    <RestartIcon className={cl("settings-button-icon")} />
                    Refresh Audio Sources
                </Button>
                <Button variant="secondary" onClick={openSettings} className={cl("settings-button")}>
                    <CogWheel className={cl("settings-button-icon")} />
                    Open Audio Settings
                </Button>
            </div>
        </>
    );
}

function ModalComponent({
    screens,
    modalProps,
    submit,
    close,
    skipPicker
}: {
    screens: Source[];
    modalProps: any;
    submit: (data: StreamPick) => void;
    close: () => void;
    skipPicker: boolean;
}) {
    const [selected, setSelected] = useState<string | undefined>(skipPicker ? screens[0].id : void 0);
    const [settings, setSettings] = useState<StreamSettings>({
        contentHint: "motion",
        audio: true,
        includeSources: "None"
    });
    const qualitySettings = (useVesktopState().screenshareQuality ??= {
        resolution: "720",
        frameRate: "30"
    });

    return (
        <Modals.ModalRoot {...modalProps} size={ModalSize.MEDIUM}>
            <Modals.ModalHeader className={cl("header")}>
                <BaseText size="lg" weight="semibold" tag="h3" style={{ flexGrow: 1 }}>
                    Screen Share Picker
                </BaseText>
                <ModalCloseButton onClick={close} />
            </Modals.ModalHeader>
            <Modals.ModalContent className={cl("modal")}>
                {!selected ? (
                    <ScreenPicker screens={screens} chooseScreen={setSelected} />
                ) : (
                    <StreamSettingsUi
                        source={screens.find(s => s.id === selected)!}
                        settings={settings}
                        setSettings={setSettings}
                        skipPicker={skipPicker}
                    />
                )}
            </Modals.ModalContent>
            <Modals.ModalFooter className={cl("footer")}>
                <Button
                    disabled={!selected}
                    onClick={() => {
                        currentSettings = settings;
                        try {
                            if (isLinux) {
                                scheduleCurrentUserScreenShareVideoStreamParameterSync();
                            } else {
                                const frameRate = Number(qualitySettings.frameRate);
                                const height = Number(qualitySettings.resolution);
                                const width = Math.round(height * (16 / 9));

                                const conn = [...MediaEngineStore.getMediaEngine().connections].find(
                                    connection => connection.streamUserId === UserStore.getCurrentUser().id
                                );

                                if (conn) {
                                    conn.videoStreamParameters[0].maxFrameRate = frameRate;
                                    conn.videoStreamParameters[0].maxResolution.height = height;
                                    conn.videoStreamParameters[0].maxResolution.width = width;
                                }
                            }

                            submit({
                                id: selected!,
                                ...settings
                            });

                            if (!isLinux) {
                                const frameRate = Number(qualitySettings.frameRate);
                                const height = Number(qualitySettings.resolution);
                                const width = Math.round(height * (16 / 9));

                                setTimeout(async () => {
                                    const conn = [...MediaEngineStore.getMediaEngine().connections].find(
                                        connection => connection.streamUserId === UserStore.getCurrentUser().id
                                    );
                                    if (!conn) return;

                                    const track = conn.input.stream.getVideoTracks()[0];

                                    const constraints = {
                                        ...track.getConstraints(),
                                        frameRate: { min: frameRate, ideal: frameRate },
                                        width: { min: 640, ideal: width, max: width },
                                        height: { min: 480, ideal: height, max: height },
                                        advanced: [{ width: width, height: height }],
                                        resizeMode: "none"
                                    };

                                    try {
                                        await track.applyConstraints(constraints);
                                    } catch (error) {
                                        logger.error("Failed to apply constraints.", error);
                                    }
                                }, 100);
                            }
                        } catch (error) {
                            logger.error("Error while submitting stream.", error);
                        }

                        close();
                    }}
                >
                    Go Live
                </Button>

                {selected && !skipPicker ? (
                    <Button variant="secondary" onClick={() => setSelected(void 0)}>
                        Back
                    </Button>
                ) : (
                    <Button variant="secondary" onClick={close}>
                        Cancel
                    </Button>
                )}
            </Modals.ModalFooter>
        </Modals.ModalRoot>
    );
}
