/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { spawnNodeModuleBin } from "./utils/spawn.mjs";

const flags = [process.cwd(), "--enable-source-maps"];

if (process.env.ELECTRON_LAUNCH_FLAGS) {
    flags.push(...process.env.ELECTRON_LAUNCH_FLAGS.split(" "));
}

spawnNodeModuleBin("electron", flags);
