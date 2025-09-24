/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./screenSharePicker.css";

import { closeModal, Logger, Modals, ModalSize, openModal, useAwaiter } from "@vencord/types/utils";
import { onceReady } from "@vencord/types/webpack";
import {
    Button,
    Card,
    FluxDispatcher,
    Forms,
    Select,
    Switch,
    Text,
    useEffect,
    UserStore,
    useState
} from "@vencord/types/webpack/common";
import { Node } from "@vencord/venmic";
import type { Dispatch, SetStateAction } from "react";
import { MediaEngineStore } from "renderer/common";
import { patchOverrideDevices } from "renderer/patches/screenShareFixes";
import { addPatch } from "renderer/patches/shared";
import { State, useSettings, useVesktopState } from "renderer/settings";
import { classNameFactory, isLinux, isWindows } from "renderer/utils";

const StreamResolutions = ["480", "720", "1080", "1440"] as const;
const StreamFps = ["15", "30", "60"] as const;

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
    overrideAudioDevice?: string;
    overrideVideoDevice?: string;
    contentHint?: string;
    includeSources?: AudioSources;
    excludeSources?: AudioSources;
    bitrate?: number;
}

export interface StreamPick extends StreamSettings {
    id: string;
}

interface Source {
    id: string;
    name: string;
    url: string;
}

export let currentSettings: StreamSettings | null = null;

// Export current quality settings for the showStreamQuality patch
export const currentQualitySettings = {
    resolution: 1080,
    frameRate: 30,
    maxResolution: 2160,
    maxFrameRate: 60
};

const logger = new Logger("VesktopScreenShare");

addPatch({
    patches: [
        {
            find: "this.localWant=",
            replacement: {
                match: /this.localWant=/,
                replace: "$self.patchStreamQuality(this);$&"
            }
        }
    ],
    patchStreamQuality(opts: any) {
        try {
            const { screenshareQuality } = State.store;
            if (!screenshareQuality) return;

            const bitrateTarget = State.store.streamBitrate || 800000;

            if (!bitrateTarget || isNaN(bitrateTarget) || bitrateTarget <= 0) {
                logger.warn("Invalid bitrate value, skipping bitrate patch");
                return;
            }

            const maxDiscordBitrate = 8000000;
            const effectiveBitrate = Math.min(bitrateTarget, maxDiscordBitrate);

            const bitrateSettings = {
                bitrateMin: Math.max(Math.round(effectiveBitrate * 0.8), 100000),
                bitrateMax: effectiveBitrate,
                bitrateTarget: effectiveBitrate
            };

            Object.assign(opts, bitrateSettings);

            if (opts.encode) Object.assign(opts.encode, bitrateSettings);
            if (opts.capture) Object.assign(opts.capture, bitrateSettings);

            logger.info(`Applied bitrate: ${effectiveBitrate}`);
        } catch (error) {
            logger.error("Error in patchStreamQuality:", error);
        }
    },

    enforceOnMediaEngine(targetBitrate: number) {
        try {
            const connections = [...(MediaEngineStore.getMediaEngine()?.connections || [])];
            connections.forEach((conn: any) => {
                if (conn?.connection?.getSenders) {
                    conn.connection.getSenders().forEach((sender: RTCRtpSender) => {
                        if (sender.track?.kind === "video") {
                            const params = sender.getParameters();
                            if (params.encodings && params.encodings.length > 0) {
                                let changed = false;
                                params.encodings.forEach((encoding: any) => {
                                    if (encoding.maxBitrate !== targetBitrate) {
                                        encoding.maxBitrate = targetBitrate;
                                        encoding.minBitrate = Math.round(targetBitrate * 0.95);
                                        changed = true;
                                    }
                                });
                                if (changed) {
                                    sender.setParameters(params).catch(() => {});
                                }
                            }
                        }
                    });
                }
            });
        } catch (error) {
            // Silently continue
        }
    },

    enforceOnWebRTCConnections(targetBitrate: number) {
        try {
            // Find all RTCPeerConnection instances
            const rtcConnections = document.querySelectorAll("*");
            rtcConnections.forEach((element: any) => {
                if (element._rtcConnection || element.connection) {
                    const conn = element._rtcConnection || element.connection;
                    if (conn.getSenders) {
                        conn.getSenders().forEach((sender: RTCRtpSender) => {
                            if (sender.track?.kind === "video") {
                                const params = sender.getParameters();
                                if (params.encodings) {
                                    params.encodings.forEach((encoding: any) => {
                                        encoding.maxBitrate = targetBitrate;
                                        encoding.minBitrate = Math.round(targetBitrate * 0.95);
                                    });
                                    sender.setParameters(params).catch(() => {});
                                }
                            }
                        });
                    }
                }
            });
        } catch (error) {
            // Silently continue
        }
    },

    enforceOnRTCPeerConnections(targetBitrate: number) {
        try {
            // Hook into global RTCPeerConnection if available
            if (window.RTCPeerConnection) {
                const connections = (window as any).__rtcConnections || [];
                connections.forEach((conn: RTCPeerConnection) => {
                    if (conn.getSenders) {
                        conn.getSenders().forEach((sender: RTCRtpSender) => {
                            if (sender.track?.kind === "video") {
                                const params = sender.getParameters();
                                if (params.encodings) {
                                    params.encodings.forEach((encoding: any) => {
                                        encoding.maxBitrate = targetBitrate;
                                    });
                                    sender.setParameters(params).catch(() => {});
                                }
                            }
                        });
                    }
                });
            }
        } catch (error) {
            // Silently continue
        }
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

                        patchOverrideDevices({
                            audio: v.overrideAudioDevice,
                            video: v.overrideVideoDevice
                        });

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
                    <Text className={cl("screen-name")} variant="text-sm/normal">
                        {name}
                    </Text>
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
                <Forms.FormTitle tag="h2" className={cl("header-title")}>
                    Venmic Settings
                </Forms.FormTitle>
                <Modals.ModalCloseButton onClick={close} />
            </Modals.ModalHeader>
            <Modals.ModalContent className={cl("modal")}>
                <Switch
                    hideBorder
                    onChange={v => (Settings.audio = { ...Settings.audio, workaround: v })}
                    value={Settings.audio?.workaround ?? false}
                    note={
                        <>
                            Work around an issue that causes the microphone to be shared instead of the correct audio.
                            Only enable if you're experiencing this issue.
                        </>
                    }
                >
                    Microphone Workaround
                </Switch>
                <Switch
                    hideBorder
                    onChange={v => (Settings.audio = { ...Settings.audio, onlySpeakers: v })}
                    value={Settings.audio?.onlySpeakers ?? true}
                    note={
                        <>
                            When sharing entire desktop audio, only share apps that play to a speaker. You may want to
                            disable this when using "mix bussing".
                        </>
                    }
                >
                    Only Speakers
                </Switch>
                <Switch
                    hideBorder
                    onChange={v => (Settings.audio = { ...Settings.audio, onlyDefaultSpeakers: v })}
                    value={Settings.audio?.onlyDefaultSpeakers ?? true}
                    note={
                        <>
                            When sharing entire desktop audio, only share apps that play to the <b>default</b> speakers.
                            You may want to disable this when using "mix bussing".
                        </>
                    }
                >
                    Only Default Speakers
                </Switch>
                <Switch
                    hideBorder
                    onChange={v => (Settings.audio = { ...Settings.audio, ignoreInputMedia: v })}
                    value={Settings.audio?.ignoreInputMedia ?? true}
                    note={<>Exclude nodes that are intended to capture audio.</>}
                >
                    Ignore Inputs
                </Switch>
                <Switch
                    hideBorder
                    onChange={v => (Settings.audio = { ...Settings.audio, ignoreVirtual: v })}
                    value={Settings.audio?.ignoreVirtual ?? false}
                    note={
                        <>
                            Exclude virtual nodes, such as nodes belonging to loopbacks. This might be useful when using
                            "mix bussing".
                        </>
                    }
                >
                    Ignore Virtual
                </Switch>
                <Switch
                    hideBorder
                    onChange={v =>
                        (Settings.audio = {
                            ...Settings.audio,
                            ignoreDevices: v,
                            deviceSelect: v ? false : Settings.audio?.deviceSelect
                        })
                    }
                    value={Settings.audio?.ignoreDevices ?? true}
                    note={<>Exclude device nodes, such as nodes belonging to microphones or speakers.</>}
                >
                    Ignore Devices
                </Switch>
                <Switch
                    hideBorder
                    onChange={value => {
                        Settings.audio = { ...Settings.audio, granularSelect: value };
                        setAudioSources("None");
                    }}
                    value={Settings.audio?.granularSelect ?? false}
                    note={<>Allow to select applications more granularly.</>}
                >
                    Granular Selection
                </Switch>
                <Switch
                    hideBorder
                    onChange={value => {
                        Settings.audio = { ...Settings.audio, deviceSelect: value };
                        setAudioSources("None");
                    }}
                    value={Settings.audio?.deviceSelect ?? false}
                    disabled={Settings.audio?.ignoreDevices}
                    note={
                        <>
                            Allow to select devices such as microphones. Requires <b>Ignore Devices</b> to be turned
                            off.
                        </>
                    }
                >
                    Device Selection
                </Switch>
            </Modals.ModalContent>
            <Modals.ModalFooter className={cl("footer")}>
                <Button color={Button.Colors.TRANSPARENT} onClick={close}>
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
                    <Text variant="text-sm/bold">{labels?.[idx] ?? option}</Text>
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
    const [thumb, setThumb] = useState(source.url);
    const [bitrate, setBitrate] = useState(State.store.streamBitrate || 800000);

    useEffect(() => {
        if (skipPicker) {
            setThumb(source.url);
            return;
        }

        const fetchThumbnail = async () => {
            try {
                const newThumb = await VesktopNative.capturer.getLargeThumbnail(source.id);
                setThumb(newThumb);
            } catch (error) {
                console.error("Failed to fetch thumbnail:", error);
                setThumb(source.url);
            }
        };

        // Fetch once when component mounts or source changes
        fetchThumbnail();
    }, [skipPicker, source.id, source.url]);

    const [audioDevices, , audioDevicesPending] = useAwaiter(
        () => navigator.mediaDevices.enumerateDevices().then(g => g.filter(d => d.kind === "audioinput")),
        { fallbackValue: [] }
    );

    const [videoDevices, , videoDevicesPending] = useAwaiter(
        () => navigator.mediaDevices.enumerateDevices().then(g => g.filter(d => d.kind === "videoinput")),
        { fallbackValue: [] }
    );

    const openSettings = () => {
        const key = openModal(props => (
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
            <Forms.FormTitle>What you're streaming</Forms.FormTitle>
            <Card className={cl("card", "preview")}>
                <img src={thumb} alt="" className={cl(isLinux ? "preview-img-linux" : "preview-img")} />
                <Text variant="text-sm/normal">{source.name}</Text>
            </Card>

            <Forms.FormTitle>Stream Settings</Forms.FormTitle>

            <Card className={cl("card")}>
                <div className={cl("quality")}>
                    <section className={cl("quality-section")}>
                        <Forms.FormTitle>Resolution</Forms.FormTitle>
                        <OptionRadio
                            options={StreamResolutions}
                            settings={qualitySettings}
                            settingsKey="resolution"
                            onChange={value => (qualitySettings.resolution = value)}
                        />
                    </section>

                    <section className={cl("quality-section")}>
                        <Forms.FormTitle>Frame Rate</Forms.FormTitle>
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
                        <Forms.FormTitle>Content Type</Forms.FormTitle>
                        <div>
                            <OptionRadio
                                options={["motion", "detail"]}
                                labels={["Prefer Smoothness", "Prefer Clarity"]}
                                settings={settings}
                                settingsKey="contentHint"
                                onChange={option => setSettings(s => ({ ...s, contentHint: option }))}
                            />
                            <div className={cl("hint-description")}>
                                <p>
                                    Choosing "Prefer Clarity" will result in a significantly lower framerate in exchange
                                    for a much sharper and clearer image.
                                </p>
                            </div>
                        </div>

                        <div>
                            <Forms.FormTitle>
                                {audioDevicesPending ? "Loading audio devices..." : "Audio devices"}
                            </Forms.FormTitle>
                            <Select
                                options={audioDevices.map(({ label, deviceId }) => ({
                                    label,
                                    value: deviceId
                                }))}
                                isSelected={d => settings.overrideAudioDevice === d}
                                select={d => {
                                    setSettings(v => ({ ...v, overrideAudioDevice: d }));
                                }}
                                serialize={String}
                                popoutPosition="top"
                                closeOnSelect={true}
                                isDisabled={audioDevicesPending}
                            />
                        </div>

                        <div>
                            <Forms.FormTitle>
                                {videoDevicesPending ? "Loading video devices..." : "Video devices"}
                            </Forms.FormTitle>
                            <Select
                                options={videoDevices.map(({ label, deviceId }) => ({
                                    label,
                                    value: deviceId
                                }))}
                                isSelected={d => settings.overrideVideoDevice === d}
                                select={d => {
                                    setSettings(v => ({ ...v, overrideVideoDevice: d }));
                                }}
                                serialize={String}
                                popoutPosition="top"
                                closeOnSelect={true}
                                isDisabled={videoDevicesPending}
                            />
                        </div>

                        {isWindows && (
                            <Switch
                                value={settings.audio}
                                onChange={checked => setSettings(s => ({ ...s, audio: checked }))}
                                hideBorder
                                className={cl("audio")}
                            >
                                Stream With Audio
                            </Switch>
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

                <div className={cl("bitrate-section")}>
                    <Forms.FormTitle>Bitrate</Forms.FormTitle>
                    <div className={cl("bitrate-container")}>
                        <input
                            type="range"
                            min="100000"
                            max="8000000"
                            step="100000"
                            value={bitrate}
                            onChange={e => {
                                const value = parseInt(e.target.value);
                                setBitrate(value);
                                State.store.streamBitrate = value;
                                setSettings(s => ({ ...s, bitrate: value }));
                            }}
                            className={cl("bitrate-slider")}
                            style={
                                {
                                    width: "100%",
                                    height: "8px",
                                    borderRadius: "4px",
                                    background: `linear-gradient(to right, #5865f2 0%, #5865f2 ${((bitrate - 100000) / 7900000) * 100}%, #4f545c ${((bitrate - 100000) / 7900000) * 100}%, #4f545c 100%)`,
                                    WebkitAppearance: "none",
                                    appearance: "none",
                                    outline: "none",
                                    cursor: "pointer"
                                } as React.CSSProperties
                            }
                        />
                        <div className={cl("bitrate-labels")}>
                            <span className={cl("bitrate-value")} style={{ fontSize: "16px", fontWeight: 600 }}>
                                {(bitrate / 800000).toFixed(1)} Mbps
                            </span>
                        </div>
                    </div>
                </div>
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
    const [refreshTrigger, setRefreshTrigger] = useState(0);
    const [sources, _, loading] = useAwaiter(() => VesktopNative.virtmic.list(), {
        fallbackValue: { ok: true, targets: [], hasPipewirePulse: true },
        deps: [refreshTrigger]
    });

    useEffect(() => {
        const interval = setInterval(() => {
            setRefreshTrigger(prev => prev + 1);
        }, 5000);

        return () => clearInterval(interval);
    }, []);

    const hasPipewirePulse = sources.ok ? sources.hasPipewirePulse : true;
    const [ignorePulseWarning, setIgnorePulseWarning] = useState(false);

    if (!sources.ok && sources.isGlibCxxOutdated) {
        return (
            <Forms.FormText>
                Failed to retrieve Audio Sources because your C++ library is too old to run
                <a href="https://github.com/Vencord/venmic" target="_blank">
                    venmic
                </a>
                . See{" "}
                <a href="https://gist.github.com/Vendicated/b655044ffbb16b2716095a448c6d827a" target="_blank">
                    this guide
                </a>{" "}
                for possible solutions.
            </Forms.FormText>
        );
    }

    if (!hasPipewirePulse && !ignorePulseWarning) {
        return (
            <Text variant="text-sm/normal">
                Could not find pipewire-pulse. See{" "}
                <a href="https://gist.github.com/the-spyke/2de98b22ff4f978ebf0650c90e82027e#install" target="_blank">
                    this guide
                </a>{" "}
                on how to switch to pipewire. <br />
                You can still continue, however, please{" "}
                <b>beware that you can only share audio of apps that are running under pipewire</b>.{" "}
                <a onClick={() => setIgnorePulseWarning(true)}>I know what I'm doing!</a>
            </Text>
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
            <div className={cl({ quality: includeSources === "Entire System" })}>
                <section>
                    <Forms.FormTitle>{loading ? "Loading Sources..." : "Audio Sources"}</Forms.FormTitle>
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
                </section>
                {includeSources === "Entire System" && (
                    <section>
                        <Forms.FormTitle>Exclude Sources</Forms.FormTitle>
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
                    </section>
                )}
            </div>
            <Button color={Button.Colors.TRANSPARENT} onClick={openSettings} className={cl("settings-button")}>
                Open Audio Settings
            </Button>
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
        includeSources: "Entire System"
    });
    const qualitySettings = (useVesktopState().screenshareQuality ??= {
        resolution: "1080",
        frameRate: "60"
    });

    return (
        <Modals.ModalRoot {...modalProps} size={ModalSize.MEDIUM}>
            <Modals.ModalHeader className={cl("header")}>
                <Forms.FormTitle tag="h2">ScreenShare</Forms.FormTitle>
                <Modals.ModalCloseButton onClick={close} />
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
                            const frameRate = Number(qualitySettings.frameRate);
                            const height = Number(qualitySettings.resolution);
                            const width = Math.round(height * (16 / 9));

                            // Update exported quality settings for the showStreamQuality patch
                            currentQualitySettings.resolution = height;
                            currentQualitySettings.frameRate = frameRate;

                            const conn = [...MediaEngineStore.getMediaEngine().connections].find(
                                connection => connection.streamUserId === UserStore.getCurrentUser().id
                            );

                            if (conn) {
                                conn.videoStreamParameters[0].maxFrameRate = frameRate;
                                conn.videoStreamParameters[0].maxResolution.height = height;
                                conn.videoStreamParameters[0].maxResolution.width = width;
                            }

                            submit({
                                id: selected!,
                                ...settings
                            });

                            setTimeout(async () => {
                                const conn = [...MediaEngineStore.getMediaEngine().connections].find(
                                    connection => connection.streamUserId === UserStore.getCurrentUser().id
                                );
                                if (!conn) return;

                                const track = conn.input.stream.getVideoTracks()[0];

                                const constraints = {
                                    ...track.getConstraints(),
                                    frameRate: { min: frameRate, ideal: frameRate },
                                    width: { min: width, ideal: width, max: width },
                                    height: { min: height, ideal: height, max: height },
                                    advanced: [{ width: width, height: height }],
                                    resizeMode: "none"
                                };

                                try {
                                    await track.applyConstraints(constraints);

                                    logger.info(
                                        "Applied constraints successfully. New constraints:",
                                        track.getConstraints()
                                    );
                                } catch (e) {
                                    logger.error("Failed to apply constraints.", e);
                                }
                            }, 100);
                        } catch (error) {
                            logger.error("Error while submitting stream.", error);
                        }

                        close();
                    }}
                >
                    Go Live
                </Button>

                {selected && !skipPicker ? (
                    <Button color={Button.Colors.TRANSPARENT} onClick={() => setSelected(void 0)}>
                        Back
                    </Button>
                ) : (
                    <Button color={Button.Colors.TRANSPARENT} onClick={close}>
                        Cancel
                    </Button>
                )}
            </Modals.ModalFooter>
        </Modals.ModalRoot>
    );
}
