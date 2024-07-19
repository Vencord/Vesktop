/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { Button, Forms } from "@vencord/types/webpack/common";

import { SettingsComponent } from "./Settings";

export const CustomSplashAnimation: SettingsComponent = ({ settings }) => {
    return (
        <>
        
        <Forms.FormText>
            {settings.splashAnimationPath ? (
                <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "16px"
                }}>
                    <img src="splash-animation:///" width="64px" height="64px"></img>
                    <p>The custom splash animation is enabled. It is loaded from 
                        <a
                            href="about:blank"
                            onClick={e => {
                                e.preventDefault();
                                VesktopNative.fileManager.showItemInFolder(settings.splashAnimationPath!);
                            }}
                        >
                            {" " + settings.splashAnimationPath}
                        </a>
                    </p>
                </div>
            ) : (
                "A custom splash animation is not set."
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
            
        </>
    );
};
