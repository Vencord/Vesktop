/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { spawn as spaaawn, SpawnOptions } from "child_process";
import { join } from "path";

const EXT = process.platform === "win32" ? ".cmd" : "";

const OPTS: SpawnOptions = {
    stdio: "inherit"
};

export function spawnNodeModuleBin(bin: string, args: string[]) {
    spaaawn(join("node_modules", ".bin", bin + EXT), args, OPTS);
}
