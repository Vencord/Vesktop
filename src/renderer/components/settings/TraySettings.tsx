/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import "./traySetting.css";

import { Margins, Modals, ModalSize, openModal } from "@vencord/types/utils";
import { findByCodeLazy, findByPropsLazy } from "@vencord/types/webpack";
import { Forms, Select, Switch, Toasts } from "@vencord/types/webpack/common";
import { setCurrentTrayIcon } from "renderer/patches/tray";
import { useSettings } from "renderer/settings";
import { isLinux, isMac } from "renderer/utils";

import { SettingsComponent } from "./Settings";

const ColorPicker = findByCodeLazy(".Messages.USER_SETTINGS_PROFILE_COLOR_SELECT_COLOR", ".BACKGROUND_PRIMARY)");
const { PencilIcon } = findByPropsLazy("PencilIcon");

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

function trayEditButton(iconName: string) {
    return (
        <div className="vcd-tray-icon-wrap">
            <img
                className="vcd-tray-icon-image"
                src={VesktopNative.tray.getIconSync(iconName)}
                alt="read if cute :3"
                width="48"
                height="48"
            ></img>
            <PencilIcon
                className="vcd-edit-button"
                width="40"
                height="40"
                onClick={async () => {
                    const choice = await VesktopNative.fileManager.selectTrayIcon();
                    switch (choice) {
                        case "cancelled":
                            return;
                        case "invalid":
                            Toasts.show({
                                message: "Please select a valid .png or .jpg image!",
                                id: Toasts.genId(),
                                type: Toasts.Type.FAILURE
                            });
                            return;
                    }
                    console.log("choice:", choice);
                    // copy image and reload
                    // settings.trayIconPath = choice;
                }}
            />
        </div>
    );
}

function TrayModalComponent({ modalProps, close }: { modalProps: any; close: () => void }) {
    const Settings = useSettings();
    return (
        <Modals.ModalRoot {...modalProps} size={ModalSize.MEDIUM}>
            <Modals.ModalHeader className="vcd-custom-tray-header">
                <Forms.FormTitle tag="h2">Custom Tray Icons</Forms.FormTitle>
                <Modals.ModalCloseButton onClick={close} />
            </Modals.ModalHeader>
            <Modals.ModalContent className="vcd-custom-tray-modal">
                <Switch
                    hideBorder
                    value={Settings.trayCustom ?? false}
                    onChange={async v => {
                        Settings.trayCustom = v;
                    }}
                    note="Whether to use custom tray icons"
                >
                    Custom Tray Icons
                </Switch>
                <Forms.FormDivider className={Margins.top8} />
                <Forms.FormSection className="vcd-custom-tray-icon-section">
                    <Forms.FormText className={Margins.top16 + " vcd-custom-tray-icon-form-text"}>
                        Main icon
                    </Forms.FormText>
                    {trayEditButton("icon")}
                </Forms.FormSection>

                <Forms.FormDivider className={(Margins.top8, Margins.bottom8)} />
                <Forms.FormSection className="vcd-custom-tray-icon-section">
                    <Forms.FormText className={Margins.top16 + " vcd-custom-tray-icon-form-text"}>
                        Idle icon
                    </Forms.FormText>
                    {trayEditButton("idle")}
                </Forms.FormSection>

                <Forms.FormDivider className={(Margins.top8, Margins.bottom8)} />
                <Forms.FormSection className="vcd-custom-tray-icon-section">
                    <Forms.FormText className={Margins.top16 + " vcd-custom-tray-icon-form-text"}>
                        Speaking icon
                    </Forms.FormText>
                    {trayEditButton("speaking")}
                </Forms.FormSection>

                <Forms.FormDivider className={(Margins.top8, Margins.bottom8)} />
                <Forms.FormSection className="vcd-custom-tray-icon-section">
                    <Forms.FormText className={Margins.top16 + " vcd-custom-tray-icon-form-text"}>
                        Muted icon
                    </Forms.FormText>
                    {trayEditButton("muted")}
                </Forms.FormSection>

                <Forms.FormDivider className={(Margins.top8, Margins.bottom8)} />
                <Forms.FormSection className="vcd-custom-tray-icon-section">
                    <Forms.FormText className={Margins.top16 + " vcd-custom-tray-icon-form-text"}>
                        Deafened icon
                    </Forms.FormText>
                    {trayEditButton("deafened")}
                </Forms.FormSection>
            </Modals.ModalContent>
            <Modals.ModalFooter></Modals.ModalFooter>
        </Modals.ModalRoot>
    );
}

const openTrayModal = () => {
    const key = openModal(props => <TrayModalComponent modalProps={props} close={() => props.onClose()} />);
};

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

export const CustomizeTraySwitch: SettingsComponent = ({ settings }) => {
    if (!settings.tray) return null;

    return (
        <>
            <div id="vcd-tray-setting">
                <div className="vcd-tray-setting-switch">
                    <Switch
                        key="tray"
                        value={settings.trayCustom ?? false}
                        onChange={v => (settings.trayCustom = v)}
                        note={"Use custom default and voice status tray icons."}
                    >
                        Use custom tray icons
                    </Switch>
                </div>
                <div className="vcd-tray-setting-customize">
                    <Forms.FormText>
                        <a
                            href="about:blank"
                            onClick={e => {
                                e.preventDefault();
                                openTrayModal();
                            }}
                        >
                            Configure
                        </a>
                    </Forms.FormText>
                </div>
            </div>
        </>
    );
};

export const TrayIconPicker: SettingsComponent = ({ settings }) => {
    if (!settings.tray || settings.trayCustom) return null;
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
    if (!settings.tray || settings.trayCustom) return null;
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
