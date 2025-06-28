/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./traySetting.css";

import { Margins } from "@vencord/types/utils";
import { Forms, Select, Switch } from "@vencord/types/webpack/common";
import { setCurrentTrayIcon } from "renderer/patches/tray";

import { SettingsComponent } from "./Settings";

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

export const TraySwitch: SettingsComponent = ({ settings }) => {
    return (
        <Switch
            value={settings.tray ?? true}
            onChange={async v => {
                settings.tray = v;
                setCurrentTrayIcon();
            }}
            note="Add a system tray entry for Vesktop"
        >
            Enable Tray Icon
        </Switch>
    );
};

export const TrayFillColorSwitch: SettingsComponent = ({ settings }) => {
    if (!settings.tray) return null;
    return (
        <div className="vcd-tray-settings">
            <div className="vcd-tray-settings-labels">
                <Forms.FormTitle tag="h1" style={{ textTransform: "none", fontWeight: "normal" }}>
                    Tray Icon Main Color
                </Forms.FormTitle>
            </div>

            <Select
                placeholder="Auto"
                options={[
                    { label: "Auto", value: "auto" },
                    { label: "Black", value: "black" },
                    { label: "White", value: "white", default: true }
                ]}
                closeOnSelect={true}
                select={v => {
                    settings.trayAutoFill = v;
                    setCurrentTrayIcon();
                }}
                isSelected={v => v === settings.trayAutoFill}
                serialize={s => s}
            ></Select>
            <Forms.FormDivider className={Margins.top20 + " " + Margins.bottom20} />
        </div>
    );
};
