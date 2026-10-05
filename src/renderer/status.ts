/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { UserStatus } from "@vencord/discord-types";
import { UserSettingsActionCreators } from "@vencord/types/webpack/common";
import { IpcCommands } from "shared/IpcEvents";

import { onIpcCommand } from "./ipcCommands";

const validStatuses: UserStatus[] = ["online", "idle", "dnd", "invisible"];

export function setStatus(status: UserStatus) {
    if (!validStatuses.includes(status)) {
        console.error("wrong status parameter");
        return;
    }

    UserSettingsActionCreators.PreloadedUserSettingsActionCreators.updateAsync(
        "status",
        settings => {
            settings.status.value = status;
        },
        0
    );
}

onIpcCommand(IpcCommands.SET_STATUS, (status: UserStatus) => setStatus(status));
