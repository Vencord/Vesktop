/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { app, BrowserWindow } from "electron";
import { splash } from "main/splash";

export let totalTasks = 14;
export let doneTasks = 0;

export let splashWindow: BrowserWindow;

/**
 * Initializes this logger
 */
export function initSplashLog(splash: BrowserWindow) {
    splashWindow = splash;
    const version = app.getVersion();
    splash.webContents.executeJavaScript(`
        document.getElementById("version").innerHTML = "v${version}";
        document.getElementById("tasks-completed").innerHTML = "(0/${totalTasks})";
    `);
}

/**
 * Adds a new log element to the splash
 */
export function addSplashLog(text: string) {
    if (!splash.isDestroyed()) {
        doneTasks++;
        const completedNum = (doneTasks / totalTasks).toFixed(2);
        splashWindow.webContents.executeJavaScript(`
            document.getElementById("detailedlogs").appendChild(Object.assign(document.createElement("li"), {className: "logitem", innerHTML: "${text}"}));
            document.getElementById("tasks-completed").innerHTML = "(${doneTasks}/${totalTasks})";
            document.getElementById("progress").style.width = "${Number(completedNum) * 100}%";
            document.getElementById("progress-percentage").innerHTML = "${Number(completedNum) * 100}%";
        `);
    }
}

/**
 * Used to add extra tasks in case of "if" statements
 */
export function addOneTaskSplash() {
    totalTasks++;
}

/**
 * Returns the splash window
 */
export function getSplash() {
    return splash;
}
