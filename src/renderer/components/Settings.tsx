/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import "./settings.css";

import { Margins } from "@vencord/types/utils";
import { Button, Forms, Select, Switch, Text, useState } from "@vencord/types/webpack/common";
import { setBadge } from "renderer/appBadge";
import { useSettings } from "renderer/settings";

export default function SettingsUi() {
    const Settings = useSettings();
    const supportsWindowsTransparency = VesktopNative.app.supportsWindowsTransparency();

    const { autostart } = VesktopNative;
    const [autoStartEnabled, setAutoStartEnabled] = useState(autostart.isEnabled());

    const switches: [keyof typeof Settings, string, string, boolean?, (() => boolean)?][] = [
        ["tray", "Tray Icon", "Add a tray icon for Vesktop", true],
        [
            "minimizeToTray",
            "Minimize to tray",
            "Hitting X will make Vesktop minimize to the tray instead of closing",
            true,
            () => Settings.tray ?? true
        ],
        ["arRPC", "Rich Presence", "Enables Rich Presence via arRPC", false],
        [
            "disableMinSize",
            "Disable minimum window size",
            "Allows you to make the window as small as your heart desires"
        ],
        [
            "openLinksWithElectron",
            "Open Links in app (experimental)",
            "Opens links in a new Vesktop window instead of your web browser"
        ],
        ["staticTitle", "Static Title", 'Makes the window title "Vencord" instead of changing to the current page']
    ];

    return (
        <Forms.FormSection>
            <Text variant="heading-lg/semibold" style={{ color: "var(--header-primary)" }} tag="h2">
                Vesktop Settings
            </Text>

            <Forms.FormTitle className={Margins.top16 + " " + Margins.bottom8}>Discord Branch</Forms.FormTitle>
            <Select
                placeholder="Stable"
                options={[
                    { label: "Stable", value: "stable", default: true },
                    { label: "Canary", value: "canary" },
                    { label: "PTB", value: "ptb" }
                ]}
                closeOnSelect={true}
                select={v => (Settings.discordBranch = v)}
                isSelected={v => v === Settings.discordBranch}
                serialize={s => s}
            />

            <Forms.FormDivider className={Margins.top16 + " " + Margins.bottom16} />

            <Switch
                value={autoStartEnabled}
                onChange={async v => {
                    await autostart[v ? "enable" : "disable"]();
                    setAutoStartEnabled(v);
                }}
                note="Automatically start Vesktop on computer start-up"
            >
                Start With System
            </Switch>

            <Switch
                value={Settings.appBadge ?? true}
                onChange={v => {
                    Settings.appBadge = v;
                    if (v) setBadge();
                    else VesktopNative.app.setBadgeCount(0);
                }}
                note="Show mention badge on the app icon"
            >
                Notification Badge
            </Switch>

            {switches.map(([key, text, note, def, predicate]) => (
                <Switch
                    value={(Settings[key as any] ?? def ?? false) && predicate?.() !== false}
                    disabled={predicate && !predicate()}
                    onChange={v => (Settings[key as any] = v)}
                    note={note}
                    key={key}
                >
                    {text}
                </Switch>
            ))}

            {supportsWindowsTransparency && (
                <>
                    <Forms.FormTitle className={Margins.top16 + " " + Margins.bottom8}>
                        Transparency Options
                    </Forms.FormTitle>
                    <Forms.FormText className={Margins.bottom8}>
                        Requires a full restart. You will need a theme that supports transparency for this to work.
                    </Forms.FormText>

                    <Select
                        placeholder="None"
                        options={[
                            {
                                label: "None",
                                value: "none",
                                default: true
                            },
                            {
                                label: "Mica (incorporates system theme + desktop wallpaper to paint the background)",
                                value: "mica"
                            },
                            { label: "Tabbed (variant of Mica with stronger background tinting)", value: "tabbed" },
                            {
                                label: "Acrylic (blurs the window behind Vesktop for a translucent background)",
                                value: "acrylic"
                            }
                        ]}
                        closeOnSelect={true}
                        select={v => (Settings.transparencyOption = v)}
                        isSelected={v => v === Settings.transparencyOption}
                        serialize={s => s}
                    />

                    <Forms.FormDivider className={Margins.top16 + " " + Margins.bottom16} />
                </>
            )}

            <Forms.FormTitle>Vencord Location</Forms.FormTitle>
            <Forms.FormText>
                Vencord files are loaded from{" "}
                {Settings.vencordDir ? (
                    <a
                        href="about:blank"
                        onClick={e => {
                            e.preventDefault();
                            VesktopNative.fileManager.showItemInFolder(Settings.vencordDir!);
                        }}
                    >
                        {Settings.vencordDir}
                    </a>
                ) : (
                    "the default location"
                )}
            </Forms.FormText>
            <div className="vcd-location-btns">
                <Button
                    size={Button.Sizes.SMALL}
                    onClick={async () => {
                        const choice = await VesktopNative.fileManager.selectVencordDir();
                        switch (choice) {
                            case "cancelled":
                            case "invalid":
                                // TODO
                                return;
                        }
                        Settings.vencordDir = choice;
                    }}
                >
                    Change
                </Button>
                <Button
                    size={Button.Sizes.SMALL}
                    color={Button.Colors.RED}
                    onClick={() => (Settings.vencordDir = void 0)}
                >
                    Reset
                </Button>
            </div>
        </Forms.FormSection>
    );
}
