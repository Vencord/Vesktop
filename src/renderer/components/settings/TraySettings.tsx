/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import "./traySetting.css";

import { Margins, Modals, ModalSize, openModal } from "@vencord/types/utils";
import { findByCodeLazy, findByPropsLazy } from "@vencord/types/webpack";
import { Button, Forms, Select, Switch, Toasts } from "@vencord/types/webpack/common";
import { setCurrentTrayIcon } from "renderer/patches/tray";
import { useSettings } from "renderer/settings";

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

VesktopNative.app.getAccentColor().then(color => {
    if (color) presets.unshift(color);
});

const statusToSettingsKey = {
    icon: { key: "trayMainOverride", label: "Main Icon" },
    idle: { key: "trayIdleOverride", label: "Idle Icon" },
    speaking: { key: "traySpeakingOverride", label: "Speaking Icon" },
    muted: { key: "trayMutedOverride", label: "Muted Icon" },
    deafened: { key: "trayDeafenedOverride", label: "Deafened Icon" }
};

async function changeIcon(iconName, settings) {
    const choice = await VesktopNative.fileManager.selectTrayIcon(iconName);
    switch (choice) {
        case "cancelled":
            return;
        case "invalid":
            Toasts.show({
                message: "Please select a valid .png, .jpg or .svg image!",
                id: Toasts.genId(),
                type: Toasts.Type.FAILURE
            });
            return;
    }

    const updateIcon = () => {
        const iconKey = statusToSettingsKey[iconName as keyof typeof statusToSettingsKey].key;
        settings[iconKey] = true;
        const iconDataURL = VesktopNative.tray.getIconSync(iconName);
        const img = document.getElementById(iconName) as HTMLImageElement;
        if (img) {
            img.src = iconDataURL;
        }
        setCurrentTrayIcon();
    };

    // sometimes new icon may not be generated in time and will be used old icon :c
    if (choice === "svg") setTimeout(updateIcon, 50);
    else updateIcon();
}

function trayEditButton(iconName: string) {
    const Settings = useSettings();
    return (
        <div className="vcd-tray-icon-wrap">
            <img
                className="vcd-tray-icon-image"
                src={VesktopNative.tray.getIconSync(iconName)}
                alt="read if cute :3"
                width="48"
                height="48"
                id={iconName}
            ></img>
            <PencilIcon
                className="vcd-edit-button"
                width="40"
                height="40"
                onClick={async () => {
                    changeIcon(iconName, Settings);
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
                {Object.entries(statusToSettingsKey).map(([iconName, { key, label }]) => (
                    <div key={iconName}>
                        <Forms.FormSection className="vcd-custom-tray-icon-section">
                            <div className="vcd-custom-tray-buttons">
                                {trayEditButton(iconName)}
                                <Button
                                    onClick={async () => {
                                        changeIcon(iconName, Settings);
                                    }}
                                    look={Button.Looks.OUTLINED}
                                >
                                    Choose Icon
                                </Button>
                                {VesktopNative.settings.get()[key] && (
                                    <Button
                                        onClick={() => {
                                            Settings[key] = false;
                                            setCurrentTrayIcon();
                                        }}
                                        look={Button.Looks.LINK}
                                    >
                                        Reset Icon
                                    </Button>
                                )}
                            </div>
                            <div>
                                <Forms.FormText>{label}</Forms.FormText>
                            </div>
                        </Forms.FormSection>
                        <Forms.FormDivider className={`${Margins.top8} ${Margins.bottom8}`} />
                    </div>
                ))}
            </Modals.ModalContent>
            <Modals.ModalFooter></Modals.ModalFooter>
        </Modals.ModalRoot>
    );
}

const openTrayModal = () => {
    openModal(props => <TrayModalComponent modalProps={props} close={() => props.onClose()} />);
};

export const TraySwitch: SettingsComponent = ({ settings }) => {
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
            <div className="vcd-tray-settings">
                <div className="vcd-tray-container">
                    <div className="vcd-tray-settings-labels">
                        <Forms.FormTitle tag="h3">Custom tray icons</Forms.FormTitle>
                        <Forms.FormText>Use custom default and voice status tray icons.</Forms.FormText>
                    </div>
                    <Button
                        onClick={async () => {
                            openTrayModal();
                        }}
                    >
                        Configure
                    </Button>
                </div>
                <Forms.FormDivider className={Margins.top20 + " " + Margins.bottom20} />
            </div>
        </>
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
