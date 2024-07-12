/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { BuildContext, BuildOptions, context } from "esbuild";
import { copyFile } from "fs/promises";

import vencordDep from "./vencordDep.mjs";

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

await Promise.all([
    copyVenmic(),
    createContext({
        ...NodeCommonOpts,
        entryPoints: ["src/main/index.ts"],
        outfile: "dist/js/main.js",
        footer: { js: "//# sourceURL=VCDMain" }
    }),
    createContext({
        ...NodeCommonOpts,
        entryPoints: ["src/preload/index.ts"],
        outfile: "dist/js/preload.js",
        footer: { js: "//# sourceURL=VCDPreload" }
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
        external: ["@vencord/types/*"],
        plugins: [vencordDep],
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
