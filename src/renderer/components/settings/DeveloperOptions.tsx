/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import {
    Margins,
    ModalCloseButton,
    ModalContent,
    ModalHeader,
    ModalRoot,
    ModalSize,
    openModal,
    useForceUpdater
} from "@vencord/types/utils";
import { Button, Forms, Text, Toasts } from "@vencord/types/webpack/common";
import { Settings } from "shared/settings";

import { cl, SettingsComponent } from "./Settings";

export const DeveloperOptionsButton: SettingsComponent = ({ settings }) => {
    return <Button onClick={() => openDeveloperOptionsModal(settings)}>Open Developer Settings</Button>;
};

function openDeveloperOptionsModal(settings: Settings) {
    openModal(props => (
        <ModalRoot {...props} size={ModalSize.MEDIUM}>
            <ModalHeader>
                <Text variant="heading-lg/semibold" style={{ flexGrow: 1 }}>
                    Vesktop Developer Options
                </Text>
                <ModalCloseButton onClick={props.onClose} />
            </ModalHeader>

            <ModalContent>
                <div style={{ padding: "1em 0" }}>
                    <Forms.FormTitle tag="h5">Vencord Location</Forms.FormTitle>
                    <VencordLocationPicker settings={settings} />

                    <Forms.FormTitle tag="h5" className={Margins.top16}>
                        Debugging
                    </Forms.FormTitle>
                    <div className={cl("button-grid")}>
                        <Button onClick={() => VesktopNative.debug.launchGpu()}>Open chrome://gpu</Button>
                        <Button onClick={() => VesktopNative.debug.launchWebrtcInternals()}>
                            Open chrome://webrtc-internals
                        </Button>
                    </div>
                </div>
            </ModalContent>
        </ModalRoot>
    ));
}

const VencordLocationPicker: SettingsComponent = ({ settings }) => {
    const forceUpdate = useForceUpdater();
    const vencordDir = VesktopNative.fileManager.getVencordDir();

    return (
        <>
            <Forms.FormText>
                Vencord files are loaded from{" "}
                {vencordDir ? (
                    <a
                        href="about:blank"
                        onClick={e => {
                            e.preventDefault();
                            VesktopNative.fileManager.showItemInFolder(vencordDir!);
                        }}
                    >
                        {vencordDir}
                    </a>
                ) : (
                    "the default location"
                )}
            </Forms.FormText>
            <div className={cl("button-grid")}>
                <Button
                    size={Button.Sizes.SMALL}
                    onClick={async () => {
                        const choice = await VesktopNative.fileManager.selectVencordDir();
                        switch (choice) {
                            case "cancelled":
                                break;
                            case "ok":
                                Toasts.show({
                                    message: "Vencord install changed. Fully restart Vesktop to apply.",
                                    id: Toasts.genId(),
                                    type: Toasts.Type.SUCCESS
                                });
                                break;
                            case "invalid":
                                Toasts.show({
                                    message:
                                        "You did not choose a valid Vencord install. Make sure you're selecting the dist dir!",
                                    id: Toasts.genId(),
                                    type: Toasts.Type.FAILURE
                                });
                                break;
                        }
                        forceUpdate();
                    }}
                >
                    Change
                </Button>
                <Button
                    size={Button.Sizes.SMALL}
                    color={Button.Colors.RED}
                    onClick={async () => {
                        await VesktopNative.fileManager.selectVencordDir(null);
                        forceUpdate();
                    }}
                >
                    Reset
                </Button>
            </div>
        </>
    );
};
