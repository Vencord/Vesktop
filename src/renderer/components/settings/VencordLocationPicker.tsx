/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2024 Vendicated and Vencord contributors
 */

import { Button, Forms, Toasts } from "@vencord/types/webpack/common";

import { SettingsComponent } from "./Settings";

export const VencordLocationPicker: SettingsComponent = ({ settings }) => {
    return (
        <>
        /* */
        <Forms.FormTitle>Custom Splash Animation</Forms.FormTitle>
            <Forms.FormText>
                The animation on the splash window is loaded from{" "}
                {settings.splashAnimationPath ? (
                    <a
                        href="about:blank"
                        onClick={e => {
                            e.preventDefault();
                            VesktopNative.fileManager.showItemInFolder(settings.splashAnimationPath!);
                        }}
                    >
                        {settings.splashAnimationPath}
                    </a>
                ) : (
                    "the default location"
                )}
            </Forms.FormText>
            <div className="vcd-location-btns" style={{marginBottom: 20}}>
                <Button
                    size={Button.Sizes.SMALL}
                    onClick={async () => {
                        const choice = await VesktopNative.fileManager.selectImagePath();
                        if (choice === "cancelled") return;
                        settings.splashAnimationPath = choice;
                    }}
                >
                    Change
                </Button>
                <Button
                    size={Button.Sizes.SMALL}
                    color={Button.Colors.RED}
                    onClick={() => (settings.splashAnimationPath = void 0)}
                >
                    Reset
                </Button>
            </div>
            /* */

            <Forms.FormText>
                Vencord files are loaded from{" "}
                {settings.vencordDir ? (
                    <a
                        href="about:blank"
                        onClick={e => {
                            e.preventDefault();
                            VesktopNative.fileManager.showItemInFolder(settings.vencordDir!);
                        }}
                    >
                        {settings.vencordDir}
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
                        settings.vencordDir = choice;
                    }}
                >
                    Change
                </Button>
                <Button
                    size={Button.Sizes.SMALL}
                    color={Button.Colors.RED}
                    onClick={() => (settings.vencordDir = void 0)}
                >
                    Reset
                </Button>
            </div>
        </>
    );
};
