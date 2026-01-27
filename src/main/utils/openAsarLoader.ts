/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { mkdirSync } from "fs";
import { access, constants as FsConstants } from "fs/promises";
import { join } from "path";

import { DATA_DIR } from "../constants";
import { downloadFile } from "./http";

const OPENASAR_DIR = join(DATA_DIR, "openasar");
const OPENASAR_FILE = join(OPENASAR_DIR, "app.asar");
const OPENASAR_DOWNLOAD_URL = "https://github.com/GooseMod/OpenAsar/releases/download/nightly/app.asar";

export async function downloadOpenAsar() {
    mkdirSync(OPENASAR_DIR, { recursive: true });
    await downloadFile(OPENASAR_DOWNLOAD_URL, OPENASAR_FILE, {}, { retryOnNetworkError: true });
}

export async function openAsarExists() {
    try {
        await access(OPENASAR_FILE, FsConstants.F_OK);
        return true;
    } catch {
        return false;
    }
}

export function getOpenAsarPath() {
    return OPENASAR_FILE;
}
