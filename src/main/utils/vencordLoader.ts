/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { existsSync } from "fs";
import { join } from "path";

import { USER_AGENT, VENCORD_ASAR_FILE } from "../constants";
import { downloadFile, fetchie } from "./http";

const API_BASE = "https://api.github.com";

export interface ReleaseData {
    name: string;
    tag_name: string;
    html_url: string;
    assets: Array<{
        name: string;
        browser_download_url: string;
    }>;
}

export async function githubGet(endpoint: string) {
    const opts: RequestInit = {
        headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": USER_AGENT
        }
    };

    if (process.env.GITHUB_TOKEN) (opts.headers! as any).Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

    return fetchie(API_BASE + endpoint, opts, { retryOnNetworkError: true });
}

export async function downloadVencordAsar() {
    await downloadFile(
        "https://github.com/Vendicated/Vencord/releases/latest/download/vesktop.asar",
        VENCORD_ASAR_FILE,
        {},
        { retryOnNetworkError: true }
    );
}

export function isValidVencordInstall(dir: string) {
    return existsSync(join(dir, "vesktop.asar"));
}

export async function ensureVencordFiles() {
    if (existsSync(VENCORD_ASAR_FILE)) return;

    await downloadVencordAsar();
}
