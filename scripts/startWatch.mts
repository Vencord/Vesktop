/*
 * SPDX-License-Identifier: GPL-3.0
 * Vencord Desktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { spawn as cpSpawn, SpawnOptions } from "child_process";
import { join } from "path";

const EXT = process.platform === "win32" ? ".cmd" : "";

const OPTS: SpawnOptions = {
    stdio: "inherit"
};

function spawn(bin: string, args: string[]) {
    cpSpawn(join("node_modules", ".bin", bin + EXT), args, OPTS);
}

spawn("tsx", ["scripts/build/build.mts", "--", "--watch", "--dev"]);
spawn("electron", ["."]);
