/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { existsSync, mkdirSync } from "fs";
import type { RequestOptions } from "https";
import { join } from "path";

import { USER_AGENT, VENCORD_FILES_DIR } from "../constants";
import { downloadFile, simpleGet } from "./http";

const API_BASE = "https://api.github.com";

const FILES_TO_DOWNLOAD = ["vencordDesktopMain.js", "preload.js", "vencordDesktopRenderer.js", "renderer.css"];

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
    const opts: RequestOptions = {
        headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": USER_AGENT
        }
    };

    if (process.env.GITHUB_TOKEN) opts.headers!.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

    return simpleGet(API_BASE + endpoint, opts);
}

export async function downloadVencordFiles() {
    const release = await githubGet("/repos/Vendicated/Vencord/releases/latest");

    const { assets } = JSON.parse(release.toString("utf-8")) as ReleaseData;

    await Promise.all(
        assets
            .filter(({ name }) => FILES_TO_DOWNLOAD.some(f => name.startsWith(f)))
            .map(({ name, browser_download_url }) => downloadFile(browser_download_url, join(VENCORD_FILES_DIR, name)))
    );
}

export async function ensureVencordFiles() {
    if (existsSync(join(VENCORD_FILES_DIR, "vencordDesktopMain.js"))) return;
    mkdirSync(VENCORD_FILES_DIR, { recursive: true });

    await downloadVencordFiles();
}
