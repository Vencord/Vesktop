/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import "./settings.css";

import { Forms, Switch, Text } from "@vencord/types/webpack/common";
import { ComponentType } from "react";
import { Settings, useSettings } from "renderer/settings";
import { isMac, isWindows } from "renderer/utils";

import { AutoStartToggle } from "./AutoStartToggle";
import { DiscordBranchPicker } from "./DiscordBranchPicker";
import { NotificationBadgeToggle } from "./NotificationBadgeToggle";
import { VencordLocationPicker } from "./VencordLocationPicker";
import { WindowsTransparencyControls } from "./WindowsTransparencyControls";
import { CustomSplashAnimation } from "./CustomSplashAnimation";

interface BooleanSetting {
    key: keyof typeof Settings.store;
    title: string;
    description: string;
    defaultValue: boolean;
    disabled?(): boolean;
    invisible?(): boolean;
}

export type SettingsComponent = ComponentType<{ settings: typeof Settings.store }>;

const SettingsOptions: Record<string, Array<BooleanSetting | SettingsComponent>> = {
    "Discord Branch": [DiscordBranchPicker],
    "System Startup & Performance": [
        AutoStartToggle,
        {
            key: "hardwareAcceleration",
            title: "Hardware Acceleration",
            description: "Enable hardware acceleration",
            defaultValue: true
        }
    ],
    "User Interface": [
        {
            key: "customTitleBar",
            title: "Discord Titlebar",
            description: "Use Discord's custom title bar instead of the native system one. Requires a full restart.",
            defaultValue: isWindows
        },
        {
            key: "staticTitle",
            title: "Static Title",
            description: 'Makes the window title "Vesktop" instead of changing to the current page',
            defaultValue: false
        },
        {
            key: "enableMenu",
            title: "Enable Menu Bar",
            description: "Enables the application menu bar. Press ALT to toggle visibility.",
            defaultValue: false,
            disabled: () => Settings.store.customTitleBar ?? isWindows
        },
        {
            key: "splashTheming",
            title: "Splash theming",
            description: "Adapt the splash window colors to your custom theme",
            defaultValue: false
        },
        WindowsTransparencyControls
    ],
    Behaviour: [
        {
            key: "tray",
            title: "Tray Icon",
            description: "Add a tray icon for Vesktop",
            defaultValue: true,
            invisible: () => isMac
        },
        {
            key: "minimizeToTray",
            title: "Minimize to tray",
            description: "Hitting X will make Vesktop minimize to the tray instead of closing",
            defaultValue: true,
            invisible: () => isMac,
            disabled: () => Settings.store.tray === false
        },
        {
            key: "clickTrayToShowHide",
            title: "Hide/Show on tray click",
            description: "Left clicking tray icon will toggle the vesktop window visibility.",
            defaultValue: false
        },
        {
            key: "disableMinSize",
            title: "Disable minimum window size",
            description: "Allows you to make the window as small as your heart desires",
            defaultValue: false
        },
        {
            key: "disableSmoothScroll",
            title: "Disable smooth scrolling",
            description: "Disables smooth scrolling",
            defaultValue: false
        }
    ],
    Notifications: [NotificationBadgeToggle],
    Miscelleanous: [
        {
            key: "arRPC",
            title: "Rich Presence",
            description: "Enables Rich Presence via arRPC",
            defaultValue: false
        },

        {
            key: "openLinksWithElectron",
            title: "Open Links in app (experimental)",
            description: "Opens links in a new Vesktop window instead of your web browser",
            defaultValue: false
        }
    ],
    "Custom Splash Animation":[CustomSplashAnimation],
    "Vencord Location": [VencordLocationPicker]
};

function SettingsSections() {
    const Settings = useSettings();

    const sections = Object.entries(SettingsOptions).map(([title, settings]) => (
        <Forms.FormSection
            title={title}
            key={title}
            className="vcd-settings-section"
            titleClassName="vcd-settings-title"
        >
            {settings.map(Setting => {
                if (typeof Setting === "function") return <Setting settings={Settings} />;

                const { defaultValue, title, description, key, disabled, invisible } = Setting;
                if (invisible?.()) return null;

                return (
                    <Switch
                        value={Settings[key as any] ?? defaultValue}
                        onChange={v => (Settings[key as any] = v)}
                        note={description}
                        disabled={disabled?.()}
                        key={key}
                    >
                        {title}
                    </Switch>
                );
            })}
        </Forms.FormSection>
    ));

    return <>{sections}</>;
}

export default function SettingsUi() {
    return (
        <Forms.FormSection>
            <Text variant="heading-lg/semibold" style={{ color: "var(--header-primary)" }} tag="h2">
                Vesktop Settings
            </Text>

            <SettingsSections />
        </Forms.FormSection>
    );
}
