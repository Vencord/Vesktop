/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Heading, Margins, Paragraph } from "@vencord/types/components";
import { Select } from "@vencord/types/webpack/common";

import { SimpleErrorBoundary } from "../SimpleErrorBoundary";
import { SettingsComponent } from "./Settings";

export const WebRTCIPHandlingPolicyPicker: SettingsComponent = ({ settings }) => {
    return (
        <SimpleErrorBoundary>
            <div>
                <Heading tag="h5">WebRTC IP Handling Policy</Heading>
                <Paragraph className={Margins.bottom8}>
                    Changing this may help with voice connection issues on some networks, most notably VPNs like
                    Tailscale.
                </Paragraph>
                <Select
                    placeholder="Default"
                    options={[
                        { label: "Default", value: "default", default: true },
                        { label: "Default Public Interface Only", value: "default_public_interface_only" },

                        {
                            label: "Default Public And Private Interfaces",
                            value: "default_public_and_private_interfaces"
                        },
                        { label: "Disable Non-Proxied UDP", value: "disable_non_proxied_udp" }
                    ]}
                    closeOnSelect={true}
                    select={v => (settings.webRTCIPHandlingPolicy = v)}
                    isSelected={v => v === (settings.webRTCIPHandlingPolicy ?? "default")}
                    serialize={s => s}
                />
            </div>
        </SimpleErrorBoundary>
    );
};
