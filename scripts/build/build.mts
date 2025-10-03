/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BuildContext, BuildOptions, context } from "esbuild";
import { copyFile } from "fs/promises";

import vencordDep from "./vencordDep.mjs";
import { includeDirPlugin } from "./includeDirPlugin.mts";

const isDev = process.argv.includes("--dev");

const CommonOpts: BuildOptions = {
    minify: !isDev,
    bundle: true,
    sourcemap: "linked",
    logLevel: "info"
};

const NodeCommonOpts: BuildOptions = {
    ...CommonOpts,
    format: "cjs",
    platform: "node",
    external: ["electron"],
    target: ["esnext"],
    define: {
        IS_DEV: JSON.stringify(isDev)
    }
};

const contexts = [] as BuildContext[];
async function createContext(options: BuildOptions) {
    contexts.push(await context(options));
}

async function copyVenmic() {
    if (process.platform !== "linux") return;

    return Promise.all([
        copyFile(
            "./node_modules/@vencord/venmic/prebuilds/venmic-addon-linux-x64/node-napi-v7.node",
            "./static/dist/venmic-x64.node"
        ),
        copyFile(
            "./node_modules/@vencord/venmic/prebuilds/venmic-addon-linux-arm64/node-napi-v7.node",
            "./static/dist/venmic-arm64.node"
        )
    ]).catch(() => console.warn("Failed to copy venmic. Building without venmic support"));
}

async function copyVenbind() {
    switch (process.platform) {
        case "win32":
            return Promise.all([
                copyFile(
                    "./node_modules/venbind/prebuilds/windows-x86_64/venbind-windows-x86_64.node",
                    "./static/dist/venbind-win32-x64.node"
                ),
                copyFile(
                    "./node_modules/venbind/prebuilds/windows-aarch64/venbind-windows-aarch64.node",
                    "./static/dist/venbind-win32-arm64.node"
                )
            ]).catch(() => console.warn("Failed to copy venbind. Building without venbind support"));
        case "linux":
            return Promise.all([
                copyFile(
                    "./node_modules/venbind/prebuilds/linux-x86_64/venbind-linux-x86_64.node",
                    "./static/dist/venbind-linux-x64.node"
                ),
                copyFile(
                    "./node_modules/venbind/prebuilds/linux-aarch64/venbind-linux-aarch64.node",
                    "./static/dist/venbind-linux-arm64.node"
                )
            ]).catch(() => console.warn("Failed to copy venbind. Building without venbind support"));
        default:
            return Promise.reject().catch(() =>
                console.warn("Venbind doesn't support this platform. Building without venbind support")
            );
    }
}

await Promise.all([
    copyVenmic(),
    copyVenbind(),
    createContext({
        ...NodeCommonOpts,
        entryPoints: ["src/main/index.ts"],
        outfile: "dist/js/main.js",
        footer: { js: "//# sourceURL=VCDMain" }
    }),
    createContext({
        ...NodeCommonOpts,
        entryPoints: ["src/main/arrpc/worker.ts"],
        outfile: "dist/js/arRpcWorker.js",
        footer: { js: "//# sourceURL=VCDArRpcWorker" }
    }),
    createContext({
        ...NodeCommonOpts,
        entryPoints: ["src/preload/index.ts"],
        outfile: "dist/js/preload.js",
        footer: { js: "//# sourceURL=VCDPreload" }
    }),
    createContext({
        ...NodeCommonOpts,
        entryPoints: ["src/preload/splash.ts"],
        outfile: "dist/js/splashPreload.js"
    }),
    createContext({
        ...CommonOpts,
        globalName: "Vesktop",
        entryPoints: ["src/renderer/index.ts"],
        outfile: "dist/js/renderer.js",
        format: "iife",
        inject: ["./scripts/build/injectReact.mjs"],
        jsxFactory: "VencordCreateElement",
        jsxFragment: "VencordFragment",
        external: ["@vencord/types/*", "/assets/*"],
        plugins: [vencordDep, includeDirPlugin("patches", "src/renderer/patches")],
        footer: { js: "//# sourceURL=VCDRenderer" }
    })
]);

const watch = process.argv.includes("--watch");

if (watch) {
    await Promise.all(contexts.map(ctx => ctx.watch()));
} else {
    await Promise.all(
        contexts.map(async ctx => {
            await ctx.rebuild();
            await ctx.dispose();
        })
    );
}
