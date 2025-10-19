/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./UserAssets.css";

import { FormSwitch } from "@vencord/types/components";
import {
    Margins,
    ModalCloseButton,
    ModalContent,
    ModalHeader,
    ModalRoot,
    ModalSize,
    openModal,
    wordsFromCamel,
    wordsToTitle
} from "@vencord/types/utils";
import { Button, showToast, Text, useState } from "@vencord/types/webpack/common";
import { UserAssetType } from "main/userAssets";
import { useSettings } from "renderer/settings";

import { SettingsComponent } from "./Settings";

const CUSTOMIZABLE_ASSETS: UserAssetType[] = ["splash", "tray", "trayUnread"];

export const UserAssetsButton: SettingsComponent = () => {
    return <Button onClick={() => openAssetsModal()}>Customize App Assets</Button>;
};

function openAssetsModal() {
    openModal(props => (
        <ModalRoot {...props} size={ModalSize.MEDIUM}>
            <ModalHeader>
                <Text variant="heading-lg/semibold" style={{ flexGrow: 1 }}>
                    User Assets
                </Text>
                <ModalCloseButton onClick={props.onClose} />
            </ModalHeader>

            <ModalContent>
                <div className="vcd-user-assets">
                    {CUSTOMIZABLE_ASSETS.map(asset => (
                        <Asset key={asset} asset={asset} />
                    ))}
                </div>
            </ModalContent>
        </ModalRoot>
    ));
}

function Asset({ asset }: { asset: UserAssetType }) {
    // cache busting
    const [version, setVersion] = useState(Date.now());
    const settings = useSettings();

    const isSplash = asset === "splash";
    const imageRendering = isSplash && settings.splashPixelated ? "pixelated" : "auto";

    const onChooseAsset = (value?: null) => async () => {
        const res = await VesktopNative.fileManager.chooseUserAsset(asset, value);
        if (res === "ok") {
            setVersion(Date.now());
            if (isSplash && value === null) {
                settings.splashPixelated = false;
            }
        } else if (res === "failed") {
            showToast("Something went wrong. Please try again");
        }
    };

    return (
        <section>
            <Text tag="h3" variant="text-md/semibold">
                {wordsToTitle(wordsFromCamel(asset))}
            </Text>
            <div className="vcd-user-assets-asset">
                <img
                    className="vcd-user-assets-image"
                    src={`vesktop://assets/${asset}?v=${version}`}
                    alt=""
                    style={{ imageRendering }}
                />
                <div className="vcd-user-assets-actions">
                    <div className="vcd-user-assets-buttons">
                        <Button onClick={onChooseAsset()}>Customize</Button>
                        <Button color={Button.Colors.PRIMARY} onClick={onChooseAsset(null)}>
                            Reset to default
                        </Button>
                    </div>
                    {isSplash && (
                        <FormSwitch
                            title="Nearest-Neighbor Scaling (for pixel art)"
                            value={settings.splashPixelated ?? false}
                            onChange={val => (settings.splashPixelated = val)}
                            className={Margins.top16}
                            hideBorder
                        />
                    )}
                </div>
            </div>
        </section>
    );
}
