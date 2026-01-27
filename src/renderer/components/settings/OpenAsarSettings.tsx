/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BaseText, Button, Paragraph } from "@vencord/types/components";
import { Toasts } from "@vencord/types/webpack/common";
import { Settings, useSettings } from "renderer/settings";

import { SettingsComponent } from "./Settings";
import { VesktopSettingsSwitch } from "./VesktopSettingsSwitch";

function showRestartToast() {
    Toasts.show({
        message: "Restart Vesktop to apply OpenAsar changes",
        id: Toasts.genId(),
        type: Toasts.Type.MESSAGE,
        options: {
            duration: 5000
        }
    });
}

export const OpenAsarSettings: SettingsComponent = () => {
    const settings = useSettings();
    const openAsarEnabled = settings.openAsarEnabled !== false;
    const openAsar = settings.openAsar ?? {};

    const updateOpenAsar = <K extends keyof NonNullable<typeof settings.openAsar>>(
        key: K,
        value: NonNullable<typeof settings.openAsar>[K]
    ) => {
        Settings.store.openAsar = {
            ...openAsar,
            [key]: value
        };
        showRestartToast();
    };

    const toggleOpenAsar = (enabled: boolean) => {
        Settings.store.openAsarEnabled = enabled;
        showRestartToast();
    };

    return (
        <div>
            <Paragraph style={{ marginBottom: "16px" }}>
                Performance optimizations from{" "}
                <a href="https://github.com/GooseMod/OpenAsar" target="_blank" rel="noreferrer">
                    OpenAsar
                </a>
                . Restart required for changes to take effect.
            </Paragraph>

            <VesktopSettingsSwitch
                title="Enable OpenAsar Optimizations"
                description="Master toggle to enable or disable all OpenAsar performance features"
                value={openAsarEnabled}
                onChange={toggleOpenAsar}
            />

            {openAsarEnabled && (
                <>
                    <div style={{ marginTop: "16px", paddingLeft: "8px", borderLeft: "2px solid var(--background-modifier-accent)" }}>
                        <VesktopSettingsSwitch
                            title="Performance Mode"
                            description="Enable GPU rasterization, zero-copy, hardware overlays, and other performance flags"
                            value={openAsar.performanceMode !== false}
                            onChange={v => updateOpenAsar("performanceMode", v)}
                        />

                        <VesktopSettingsSwitch
                            title="Battery Mode"
                            description="Optimize for battery life on laptops (disables some performance features)"
                            value={openAsar.batteryMode ?? false}
                            onChange={v => updateOpenAsar("batteryMode", v)}
                        />

                        <VesktopSettingsSwitch
                            title="Disable Tracking"
                            description="Block Discord analytics, science, and metrics endpoints"
                            value={openAsar.noTrack !== false}
                            onChange={v => updateOpenAsar("noTrack", v)}
                        />

                        <VesktopSettingsSwitch
                            title="Disable Typing Indicator"
                            description="Block the typing indicator from being sent (others won't see when you're typing)"
                            value={openAsar.noTyping ?? false}
                            onChange={v => updateOpenAsar("noTyping", v)}
                        />

                        <VesktopSettingsSwitch
                            title="DOM Optimizer"
                            description="Optimize DOM operations for smoother animations in activity feeds"
                            value={openAsar.domOptimizer !== false}
                            onChange={v => updateOpenAsar("domOptimizer", v)}
                        />

                        <VesktopSettingsSwitch
                            title="Quickstart"
                            description="Skip splash screen and show main window immediately (may show loading state)"
                            value={openAsar.quickstart ?? false}
                            onChange={v => updateOpenAsar("quickstart", v)}
                        />

                        <VesktopSettingsSwitch
                            title="Allow Multiple Instances"
                            description="Allow running multiple Vesktop windows simultaneously"
                            value={openAsar.multiInstance ?? false}
                            onChange={v => updateOpenAsar("multiInstance", v)}
                        />

                        <div style={{ marginTop: "16px" }}>
                            <BaseText size="md" weight="semibold" style={{ marginBottom: "4px" }}>
                                Custom Chromium Flags
                            </BaseText>
                            <Paragraph style={{ marginBottom: "8px", fontSize: "12px" }}>
                                Additional command line flags (space-separated, e.g., --flag1 --flag2=value)
                            </Paragraph>
                            <input
                                type="text"
                                value={openAsar.customFlags ?? ""}
                                onChange={e => updateOpenAsar("customFlags", e.target.value)}
                                placeholder="--custom-flag --another=value"
                                style={{
                                    width: "100%",
                                    padding: "8px 12px",
                                    borderRadius: "4px",
                                    border: "1px solid var(--background-tertiary)",
                                    backgroundColor: "var(--background-secondary)",
                                    color: "var(--text-normal)",
                                    fontSize: "14px"
                                }}
                            />
                        </div>
                    </div>

                    <div style={{ marginTop: "16px" }}>
                        <Button
                            onClick={() => {
                                VesktopNative.app.relaunch();
                            }}
                        >
                            Restart Vesktop
                        </Button>
                    </div>
                </>
            )}
        </div>
    );
};
