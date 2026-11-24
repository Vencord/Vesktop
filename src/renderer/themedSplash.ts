/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Settings } from "./settings";

const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
ctx.canvas.width = ctx.canvas.height = 1;

// Resolves any css colour (including var() references and modern colour spaces) to rgb() by painting it onto a canvas,
// so we don't depend on the serialisation format of getComputedStyle, which changes between Chromium versions
function resolveColor(variable: string) {
    if (!getComputedStyle(document.body).getPropertyValue(variable).trim()) return null;

    const span = document.createElement("span");
    span.style.color = `var(${variable})`;
    span.style.display = "none";

    document.body.append(span);
    const computedColor = getComputedStyle(span).color;
    span.remove();

    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = computedColor;
    ctx.fillRect(0, 0, 1, 1);

    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    if (a === 0) return null;

    return `rgb(${r}, ${g}, ${b})`;
}

const updateSplashColors = () => {
    const color = resolveColor("--text-default");
    const backgroundColor = resolveColor("--background-base-lowest");

    if (color) Settings.store.splashColor = color;
    if (backgroundColor) Settings.store.splashBackground = backgroundColor;
};

if (document.readyState === "complete") {
    updateSplashColors();
} else {
    window.addEventListener("load", updateSplashColors);
}

window.addEventListener("beforeunload", updateSplashColors);
