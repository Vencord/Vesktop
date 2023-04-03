import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { USER_AGENT, VENCORD_FILES_DIR } from "../constants";
import { downloadFile, simpleGet } from "./http";

// TODO: Setting to switch repo
const API_BASE = "https://api.github.com/repos/Vendicated/VencordDev";

const FILES_TO_DOWNLOAD = [
    "vencordDesktopMain.js",
    "preload.js",
    "vencordDesktopRenderer.js",
    "renderer.css"
];

export async function githubGet(endpoint: string) {
    return simpleGet(API_BASE + endpoint, {
        headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": USER_AGENT
        }
    });
}

export async function downloadVencordFiles() {
    const release = await githubGet("/releases/latest");

    const data = JSON.parse(release.toString("utf-8"));
    const assets = data.assets as Array<{
        name: string;
        browser_download_url: string;
    }>;

    await Promise.all(
        assets
            .filter(({ name }) => FILES_TO_DOWNLOAD.some(f => name.startsWith(f)))
            .map(({ name, browser_download_url }) =>
                downloadFile(
                    browser_download_url,
                    join(
                        VENCORD_FILES_DIR,
                        name.replace(/vencordDesktop(\w)/, (_, c) => c.toLowerCase())
                    )
                )
            )
    );
}

export async function ensureVencordFiles() {
    if (existsSync(join(VENCORD_FILES_DIR, "main.js"))) return;
    mkdirSync(VENCORD_FILES_DIR, { recursive: true });

    await downloadVencordFiles();
}
