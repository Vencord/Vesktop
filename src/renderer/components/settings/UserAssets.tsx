/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./UserAssets.css";

import {
    ModalCloseButton,
    ModalContent,
    ModalHeader,
    ModalRoot,
    ModalSize,
    openModal,
    wordsToTitle
} from "@vencord/types/utils";
import { Button, showToast, Text, useState } from "@vencord/types/webpack/common";
import { UserAssetType } from "main/userAssets";

import { SettingsComponent } from "./Settings";

const CUSTOMIZABLE_ASSETS: UserAssetType[] = ["splash", "tray"];

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

    const onChooseAsset = (value?: null) => async () => {
        const res = await VesktopNative.fileManager.chooseUserAsset(asset, value);
        if (res === "ok") {
            setVersion(Date.now());
        } else if (res === "failed") {
            showToast("Something went wrong. Please try again");
        }
    };

    return (
        <section>
            <Text tag="h3" variant="text-md/semibold">
                {wordsToTitle([asset])}
            </Text>
            <div className="vcd-user-assets-asset">
                <img className="vcd-user-assets-image" src={`vesktop://assets/${asset}?v=${version}`} alt="" />
                <div className="vcd-user-assets-actions">
                    <Button onClick={onChooseAsset()}>Customize</Button>
                    <Button color={Button.Colors.PRIMARY} onClick={onChooseAsset(null)}>
                        Reset to default
                    </Button>
                </div>
            </div>
        </section>
    );
}
