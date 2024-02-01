/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { Constants } from "discord-types/other";

type ValueOf<T> = T[keyof T];
export type GlobalKeybindAction = ValueOf<Constants["GlobalKeybindActions"]>;

export interface Keybind {
    id: string;
    enabled: boolean;
    action: GlobalKeybindAction;
    shortcut: number[][];
    managed: boolean;
    params: any;
}

export interface KeybindsStoreType {
    getState(): Record<number, Keybind>;
}
