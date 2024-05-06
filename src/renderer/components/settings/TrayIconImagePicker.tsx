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
            <div id="tray-setting">
                <div id="colLeft">
                    <Switch
                        key="tray"
                        value={Settings.store.tray ?? false}
                        onChange={v => (Settings.store.tray = v)}
                        note={"Add a tray icon for Vesktop"}
                    >
                        {"Tray Icon"}
                    </Switch>
                </div>
                <div id="colMiddle">
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
                <div id="colRight">
                    <div className="tray-icon-wrap">
                        <img
                            className="tray-icon-image"
                            src={VesktopNative.tray.getTrayIcon()}
                            alt="hello"
                            width="48"
                            height="48"
                        ></img>
                        <input
                            className="edit-button"
                            type="image"
                            src="https://cdn.discordapp.com/attachments/895550066453012480/1236925384482619433/I1oxwE7.png?ex=6639c808&is=66387688&hm=5c5f47a0c06b2e0580fd5494386bfbeebc001c20e3fd64f26783f360b12162ed&"
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
            </div>
        </>
    );
};
