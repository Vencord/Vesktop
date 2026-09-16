/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BrowserWindow, WebContents } from "electron";
import { join } from "path";

import { BrowserUserAgent, DISCORD_HOSTNAMES } from "./constants";
import { Settings } from "./settings";

interface BackgroundAccount {
    window: BrowserWindow;
    token: string;
    label: string;
}

const backgroundAccounts = new Map<string, BackgroundAccount>();

function isDiscordUrl(value: string) {
    return DISCORD_HOSTNAMES.includes(URL.parse(value)?.hostname ?? "");
}

function toAccountMap(entries: unknown) {
    const accounts = new Map<string, string>();
    if (!Array.isArray(entries)) return accounts;

    for (const entry of entries) {
        if (!Array.isArray(entry)) continue;
        const [id, token] = entry;
        if (typeof id === "string" && /^\d{16,22}$/.test(id) && typeof token === "string" && token)
            accounts.set(id, token);
    }

    return accounts;
}

function toAccountLabels(value: unknown) {
    const labels = new Map<string, string>();
    if (value == null || typeof value !== "object") return labels;

    const users = (value as { _state?: { users?: unknown } })._state?.users;
    if (!Array.isArray(users)) return labels;

    for (const user of users) {
        if (user == null || typeof user !== "object") continue;
        const { id, username, discriminator } = user as Record<string, unknown>;
        if (typeof id !== "string" || !/^\d{16,22}$/.test(id) || typeof username !== "string") continue;
        labels.set(
            id,
            typeof discriminator === "string" && discriminator !== "0" ? `${username}#${discriminator}` : `@${username}`
        );
    }

    return labels;
}

if (IS_DEV) {
    console.assert(
        toAccountMap([
            ["1234567890123456", "token"],
            ["invalid", "token"]
        ]).size === 1,
        "Background account validation failed"
    );
    console.assert(
        toAccountLabels({
            _state: { users: [{ id: "1234567890123456", username: "account", discriminator: "0" }] }
        }).get("1234567890123456") === "@account",
        "Background account label validation failed"
    );
}

function createBackgroundAccount(accountId: string, token: string, label: string) {
    const window = new BrowserWindow({
        show: false,
        webPreferences: {
            nodeIntegration: false,
            sandbox: true,
            contextIsolation: true,
            devTools: false,
            spellcheck: false,
            backgroundThrottling: false,
            preload: join(__dirname, "backgroundPreload.js"),
            partition: `vesktop-background-account-${accountId}`
        }
    });
    const account = { window, token, label };

    backgroundAccounts.set(accountId, account);
    window.webContents.setUserAgent(BrowserUserAgent);

    const ses = window.webContents.session;
    ses.setPermissionCheckHandler(
        (_webContents, permission, origin) => permission === "notifications" && isDiscordUrl(origin)
    );
    ses.setPermissionRequestHandler((webContents, permission, callback) => {
        callback(permission === "notifications" && isDiscordUrl(webContents.getURL()));
    });

    window.on("closed", () => {
        if (backgroundAccounts.get(accountId) === account) backgroundAccounts.delete(accountId);
    });

    const branch = Settings.store.discordBranch;
    const subdomain = branch === "canary" || branch === "ptb" ? `${branch}.` : "";
    void window.loadURL(`https://${subdomain}discord.com/app`).catch(error => {
        console.warn(`Failed to start notifications for account ${accountId}:`, error);
        if (backgroundAccounts.get(accountId) === account) backgroundAccounts.delete(accountId);
        if (!window.isDestroyed()) window.destroy();
    });
}

export function getBackgroundAccountContext(sender: WebContents) {
    for (const account of backgroundAccounts.values()) {
        if (account.window.webContents === sender) return { token: account.token, label: account.label };
    }
}

export function getBackgroundAccountId(sender: WebContents) {
    for (const [accountId, account] of backgroundAccounts) {
        if (account.window.webContents === sender) return accountId;
    }
}

export function syncBackgroundAccounts(tokensJson: unknown, currentUserIdJson: unknown, accountsJson: unknown) {
    if (
        !Settings.store.enableMultiAccountNotifications ||
        typeof tokensJson !== "string" ||
        typeof currentUserIdJson !== "string"
    )
        return;

    let accounts: Map<string, string>;
    let labels: Map<string, string>;
    try {
        const currentUserId: unknown = JSON.parse(currentUserIdJson);
        if (typeof currentUserId !== "string") return;

        accounts = toAccountMap(Object.entries(JSON.parse(tokensJson)));
        accounts.delete(currentUserId);
    } catch {
        return;
    }

    try {
        labels = typeof accountsJson === "string" ? toAccountLabels(JSON.parse(accountsJson)) : new Map();
    } catch {
        labels = new Map();
    }

    for (const [accountId, account] of backgroundAccounts) {
        const token = accounts.get(accountId);
        if (token == null || account.window.isDestroyed()) {
            backgroundAccounts.delete(accountId);
            if (!account.window.isDestroyed()) account.window.destroy();
        } else {
            const label = labels.get(accountId) ?? `Account ${accountId.slice(-4)}`;
            if (token === account.token && label === account.label) continue;
            account.token = token;
            account.label = label;
            account.window.webContents.reload();
        }
    }

    for (const [accountId, token] of accounts) {
        if (!backgroundAccounts.has(accountId))
            createBackgroundAccount(accountId, token, labels.get(accountId) ?? `Account ${accountId.slice(-4)}`);
    }
}

export function stopBackgroundAccountNotifications() {
    for (const account of backgroundAccounts.values()) {
        if (!account.window.isDestroyed()) account.window.destroy();
    }
    backgroundAccounts.clear();
}
