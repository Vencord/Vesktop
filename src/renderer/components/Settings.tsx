/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import "./settings.css";

import { Margins } from "@vencord/types/utils";
import { Button, Forms, Select, Switch, Text, Toasts, useState } from "@vencord/types/webpack/common";
import { setBadge } from "renderer/appBadge";
import { useSettings } from "renderer/settings";
import { isMac } from "renderer/utils";
import { isTruthy } from "shared/utils/guards";

export default function SettingsUi() {
    const Settings = useSettings();
    const supportsWindowsTransparency = VesktopNative.app.supportsWindowsTransparency();

    const { autostart } = VesktopNative;
    const [autoStartEnabled, setAutoStartEnabled] = useState(autostart.isEnabled());

    type SettingsCategory = "System" | "Performance" | "User Interface" | "Notifications";
    const allSwitches: Array<
        false | [keyof typeof Settings, string, string, boolean?, (() => boolean)?, SettingsCategory?]
    > = [
        [
            "customTitleBar",
            "Discord Titlebar",
            "Use Discord's custom title bar instead of the native system one. Requires a full restart.",
            undefined,
            undefined,
            "User Interface"
        ],
        !isMac && ["tray", "Tray Icon", "Add a tray icon for Vesktop", true],
        !isMac && [
            "minimizeToTray",
            "Minimize to tray",
            "Hitting X will make Vesktop minimize to the tray instead of closing",
            true,
            () => Settings.tray ?? true,
            "User Interface"
        ],
        ["arRPC", "Rich Presence", "Enables Rich Presence via arRPC", false],
        [
            "disableMinSize",
            "Disable minimum window size",
            "Allows you to make the window as small as your heart desires",
            undefined,
            undefined,
            undefined
        ],
        ["staticTitle", "Static Title", 'Makes the window title "Vesktop" instead of changing to the current page'],
        [
            "enableMenu",
            "Enable Menu Bar",
            "Enables the application menu bar. Press ALT to toggle visibility. Incompatible with 'Discord Titlebar'",
            undefined,
            undefined,
            "User Interface"
        ],
        [
            "disableSmoothScroll",
            "Disable smooth scrolling",
            "Disables smooth scrolling in Vesktop",
            false,
            undefined,
            "User Interface"
        ],
        [
            "hardwareAcceleration",
            "Hardware Acceleration",
            "Enable hardware acceleration",
            true,
            undefined,
            "Performance"
        ],
        [
            "splashTheming",
            "Splash theming",
            "Adapt the splash window colors to your custom theme",
            false,
            undefined,
            "User Interface"
        ],
        [
            "openLinksWithElectron",
            "Open Links in app (experimental)",
            "Opens links in a new Vesktop window instead of your web browser"
        ],
        ["checkUpdates", "Check for updates", "Automatically check for Vesktop updates", true, undefined, "System"]
    ];

    const switches = allSwitches.filter(isTruthy);

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

            <Text
                variant="heading-lg/semibold"
                className={Margins.top20 + " " + Margins.bottom20}
                style={{ color: "var(--header-primary)" }}
                tag="h3"
            >
                System Startup & Performance
            </Text>

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

            {switches
                .filter(item => item[5] === "System" || item[5] === "Performance")
                .map(([key, text, note, def, predicate]) => (
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

            <Text
                variant="heading-lg/semibold"
                className={Margins.top20 + " " + Margins.bottom20}
                style={{ color: "var(--header-primary)" }}
                tag="h3"
            >
                User Interface & Experience
            </Text>

            {switches
                .filter(item => item[5] === "User Interface")
                .map(([key, text, note, def, predicate]) => (
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

            <Text
                variant="heading-lg/semibold"
                className={Margins.top20 + " " + Margins.bottom20}
                style={{ color: "var(--header-primary)" }}
                tag="h3"
            >
                Notifications & Updates
            </Text>

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

            {switches
                .filter(item => item[5] === "Notifications")
                .map(([key, text, note, def, predicate]) => (
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

            <Text
                variant="heading-lg/semibold"
                className={Margins.top20 + " " + Margins.bottom20}
                style={{ color: "var(--header-primary)" }}
                tag="h3"
            >
                Miscellaneous
            </Text>

            {switches
                .filter(item => item[5] === undefined)
                .map(([key, text, note, def, predicate]) => (
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
                                return;
                            case "invalid":
                                Toasts.show({
                                    message:
                                        "You did not choose a valid Vencord install. Make sure you're selecting the dist dir!",
                                    id: Toasts.genId(),
                                    type: Toasts.Type.FAILURE
                                });
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
