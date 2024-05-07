/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { Forms, Switch, Toasts } from "@vencord/types/webpack/common";
import { Settings } from "renderer/settings";

import { SettingsComponent } from "./Settings";

export const TrayIconImagePicker: SettingsComponent = ({ settings }) => {
    return (
        <>
            <div id="vcd-tray-setting">
                <div className="vcd-tray-setting-switch">
                    <Switch
                        key="tray"
                        value={Settings.store.tray ?? false}
                        onChange={v => (Settings.store.tray = v)}
                        note={"Add a tray icon for Vesktop"}
                    >
                        Tray Icon
                    </Switch>
                </div>
                <div className="vcd-tray-setting-reset">
                    <Forms.FormText>
                        <a
                            href="about:blank"
                            onClick={e => {
                                e.preventDefault();
                                settings.trayIconPath = void 0;
                            }}
                        >
                            Reset
                        </a>
                    </Forms.FormText>
                </div>
                <div className="vcd-tray-icon-wrap">
                    <img
                        className="vcd-tray-icon-image"
                        src={VesktopNative.tray.getTrayIcon()}
                        alt="hello"
                        width="48"
                        height="48"
                    ></img>
                    <input
                        className="vcd-edit-button"
                        type="image"
                        src="https://raw.githubusercontent.com/Vencord/Vesktop/main/static/pencil-edit-icon.svg"
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
                            settings.trayIconPath = choice;
                        }}
                    />
                </div>
            </div>
        </>
    );
};
