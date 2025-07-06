/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type ArRpcEvent = ArRpcActivityEvent | ArRpcInviteEvent | ArRpcLinkEvent;
export type ArRpcHostEvent = ArRpcHostAckInviteEvent | ArRpcHostAckLinkEvent;

export interface ArRpcActivityEvent {
    eventType: "activity";
    data: string;
}

export interface ArRpcInviteEvent {
    eventType: "invite";
    inviteId: number;
    data: string;
}

export interface ArRpcLinkEvent {
    eventType: "link";
    linkId: number;
    data: string;
}

export interface ArRpcHostAckInviteEvent {
    eventType: "ack-invite";
    inviteId: number;
    data: boolean;
}

export interface ArRpcHostAckLinkEvent {
    eventType: "ack-link";
    linkId: number;
    data: boolean;
}
