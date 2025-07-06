/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type ArRpcEvent = ArRpcActivityEvent | ArRpcInviteEvent | ArRpcLinkEvent;
export type ArRpcHostEvent = ArRpcHostAckInviteEvent | ArRpcHostAckLinkEvent;

export interface ArRpcActivityEvent {
    type: "activity";
    nonce: string;
    data: string;
}

export interface ArRpcInviteEvent {
    type: "invite";
    nonce: string;
    data: string;
}

export interface ArRpcLinkEvent {
    type: "link";
    nonce: string;
    data: any;
}

export interface ArRpcHostAckInviteEvent {
    type: "ack-invite";
    nonce: string;
    data: boolean;
}

export interface ArRpcHostAckLinkEvent {
    type: "ack-link";
    nonce: string;
    data: boolean;
}
