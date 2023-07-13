/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import "./start";

import { spawnNodeModuleBin } from "./utils/spawn.mjs";
spawnNodeModuleBin("tsx", ["scripts/build/build.mts", "--", "--watch", "--dev"]);
