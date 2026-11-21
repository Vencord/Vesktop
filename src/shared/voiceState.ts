/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** Discord's self mute and self deafen state, as reported by its MediaEngineStore */
export interface VoiceState {
    mute: boolean;
    deaf: boolean;
}
