/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { Margins, Modals, ModalSize, openModal } from "@vencord/types/utils";
import { Button, Forms, TextInput } from "@vencord/types/webpack/common";
import { useSettings } from "renderer/settings";
import { isLinux } from "renderer/utils";

import { SettingsComponent } from "./Settings";

export const Arguments: SettingsComponent = ({ settings }) => {
    if (!isLinux) return null;

    const settingsStore = useSettings();

    const openTextModal = () => {
        let Arguments = settingsStore.arguments;

        openModal(props => (
            <Modals.ModalRoot {...props} size={ModalSize.SMALL}>
                <Modals.ModalHeader className="vcd-custom-tray-header">
                    <Forms.FormTitle tag="h2">Configure Arguments</Forms.FormTitle>
                    <Modals.ModalCloseButton onClick={props.onClose} />
                </Modals.ModalHeader>
                <Modals.ModalContent>
                    <TextInput
                        type="text"
                        defaultValue={Arguments}
                        onChange={value => (Arguments = value)}
                        placeholder="--ozone-platform=auto"
                    />
                </Modals.ModalContent>
                <Modals.ModalFooter>
                    <Button
                        style={{ marginLeft: "10px" }}
                        color={Button.Colors.RED}
                        onClick={() => {
                            settingsStore.arguments = Arguments;
                            props.onClose();
                        }}
                    >
                        Save
                    </Button>
                    <Button onClick={props.onClose}>Close</Button>
                </Modals.ModalFooter>
            </Modals.ModalRoot>
        ));
    };

    return (
        <Forms.FormSection>
            <div className="vcd-tray-settings">
                <div className="vcd-tray-container">
                    <div className="vcd-tray-settings-labels">
                        <Forms.FormTitle tag="h3">Arguments</Forms.FormTitle>
                        <Forms.FormText>Enter arguments to pass to Discord</Forms.FormText>
                    </div>
                    <Button onClick={openTextModal}>Configure</Button>
                </div>
                <Forms.FormDivider className={Margins.top20 + " " + Margins.bottom20} />
            </div>
        </Forms.FormSection>
    );
};
