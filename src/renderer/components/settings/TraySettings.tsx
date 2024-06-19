/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import "./traySetting.css";

import { Margins } from "@vencord/types/utils";
import { findByCodeLazy } from "@vencord/types/webpack";
import { Forms, Select, Switch } from "@vencord/types/webpack/common";
import { setCurrentTrayIcon } from "renderer/patches/tray";
import { isLinux, isMac } from "renderer/utils";

import { SettingsComponent } from "./Settings";

const ColorPicker = findByCodeLazy(".Messages.USER_SETTINGS_PROFILE_COLOR_SELECT_COLOR", ".BACKGROUND_PRIMARY)");

const presets = [
    "#3DB77F", // discord default ~
    "#F6BFAC", // Vesktop inpired
    "#FC2F2F", // red
    "#2FFC33", // green
    "#FCF818", // yellow
    "#2FFCE6", // light-blue
    "#3870FA", // blue
    "#6F32FD", // purple
    "#FC18EC" // pink
];

if (!isLinux)
    VesktopNative.app.getAccentColor().then(color => {
        if (color) presets.unshift(color);
    });

export const TraySwitch: SettingsComponent = ({ settings }) => {
    if (isMac) return null;
    return (
        <Switch
            value={settings.tray ?? true}
            onChange={async v => {
                settings.tray = v;
                setCurrentTrayIcon();
            }}
            note="Add a tray icon for Vesktop"
        >
            Tray Icon
        </Switch>
    );
};

export const TrayIconPicker: SettingsComponent = ({ settings }) => {
    if (!settings.tray) return null;
    return (
        <div className="vcd-tray-settings">
            <div className="vcd-tray-container">
                <div className="vcd-tray-settings-labels">
                    <Forms.FormTitle tag="h3">Tray Icon Color</Forms.FormTitle>
                    <Forms.FormText>Choose a color for your tray icon!</Forms.FormText>
                </div>
                <ColorPicker
                    color={parseInt(settings.trayColor ?? "3DB77F", 16)}
                    onChange={newColor => {
                        const hexColor = newColor.toString(16).padStart(6, "0");
                        settings.trayColor = hexColor;
                        VesktopNative.tray.generateTrayIcons();
                    }}
                    showEyeDropper={false}
                    suggestedColors={presets}
                />
            </div>
            <Forms.FormDivider className={Margins.top20 + " " + Margins.bottom20} />
        </div>
    );
};

export const TrayFillColorSwitch: SettingsComponent = ({ settings }) => {
    if (!settings.tray) return null;
    return (
        <div className="vcd-tray-settings">
            <div className="vcd-tray-container">
                <div className="vcd-tray-settings-labels">
                    <Forms.FormTitle tag="h3">Tray icon fill color</Forms.FormTitle>
                    <Forms.FormText>Choose background fill of Tray Icons in Voice Chat</Forms.FormText>
                </div>

                <Select
                    placeholder="Auto"
                    options={[
                        { label: "Auto", value: "auto", default: true },
                        { label: "Black", value: "black" },
                        { label: "White", value: "white" }
                    ]}
                    closeOnSelect={true}
                    select={v => {
                        settings.trayAutoFill = v;
                        VesktopNative.tray.generateTrayIcons();
                    }}
                    isSelected={v => v === settings.trayAutoFill}
                    serialize={s => s}
                ></Select>
            </div>
            <Forms.FormDivider className={Margins.top20 + " " + Margins.bottom20} />
        </div>
    );
};
