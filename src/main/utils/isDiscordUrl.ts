/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DISCORD_HOSTNAMES } from "main/constants";

export function isDiscordUrl(url: string | undefined) {
    if (!url || !URL.canParse(url)) return false;

    const { protocol, hostname } = new URL(url);
    return protocol === "https:" && DISCORD_HOSTNAMES.includes(hostname);
}
