/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { IpcEvents } from "shared/IpcEvents";

export type ArrpcEvent = ArrpcActivityEvent | ArrpcInviteEvent | ArrpcLinkEvent;
export type ArrpcHostEvent = ArrpcHostAckInviteEvent | ArrpcHostAckLinkEvent;

export interface ArrpcActivityEvent {
    eventType: IpcEvents.ARRPC_ACTIVITY;
    data: string;
}

export interface ArrpcInviteEvent {
    eventType: "invite";
    data: string;
    inviteId: number;
}

export interface ArrpcLinkEvent {
    eventType: "link";
    data: string;
    linkId: number;
}

export interface ArrpcHostAckInviteEvent {
    eventType: "ack-invite";
    inviteId: number;
    data: boolean;
}

export interface ArrpcHostAckLinkEvent {
    eventType: "ack-link";
    linkId: number;
    data: boolean;
}
