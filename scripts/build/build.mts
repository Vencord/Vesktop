/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { copyFile, rm } from "fs/promises";

import { BuildContext, BuildOptions, context, Plugin } from "esbuild";

import { includeDirPlugin } from "./includeDirPlugin.mts";
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
    loader: {
        ".node": "file"
    },
    define: {
        IS_DEV: JSON.stringify(isDev)
    }
};

// uiohook-napi finds its binary with node-gyp-build, so point that at the copy in static/dist (see copyUiohook)
const uiohookBinaryPlugin: Plugin = {
    name: "uiohook-binary",
    setup(build) {
        build.onResolve({ filter: /^node-gyp-build$/ }, args => {
            if (args.importer.includes("uiohook-napi")) return { path: "uiohook-binary", namespace: "uiohook-binary" };
        });
        build.onLoad({ filter: /.*/, namespace: "uiohook-binary" }, () => ({
            contents: `
                const { join } = require("path");
                module.exports = () => require(join(__dirname, "../../static/dist/uiohook-napi-" + process.arch + ".node"));
            `,
            loader: "js"
        }));
    }
};

// Overwriting in place crashes a running instance, as the addon is mapped into memory, so replace the file instead
async function copyNativeModule(src: string, dest: string) {
    await rm(dest, { force: true });
    await copyFile(src, dest);
}

const contexts = [] as BuildContext[];
async function createContext(options: BuildOptions) {
    contexts.push(await context(options));
}

async function copyVenmic() {
    if (process.platform !== "linux") return;

    return Promise.all([
        copyNativeModule(
            "./node_modules/@vencord/venmic/prebuilds/venmic-addon-linux-x64/node-napi-v7.node",
            "./static/dist/venmic-x64.node"
        ),
        copyNativeModule(
            "./node_modules/@vencord/venmic/prebuilds/venmic-addon-linux-arm64/node-napi-v7.node",
            "./static/dist/venmic-arm64.node"
        )
    ]).catch(() => console.warn("Failed to copy venmic. Building without venmic support"));
}

async function copyUiohook() {
    const prebuilds = "./node_modules/uiohook-napi/prebuilds";

    return Promise.all(
        ["x64", "arm64"].map(arch =>
            copyNativeModule(
                `${prebuilds}/${process.platform}-${arch}/uiohook-napi.node`,
                `./static/dist/uiohook-napi-${arch}.node`
            )
        )
    ).catch(() => console.warn("Failed to copy uiohook. Building without global keybind support"));
}

async function copyGameDetection() {
    const prebuilds = "./node_modules/@vencord/game-detection/prebuilds";

    return Promise.all(
        ["x64", "arm64"].map(arch =>
            copyNativeModule(
                `${prebuilds}/${process.platform}-${arch}/rpc_native.node`,
                `./static/dist/game-detection-${arch}.node`
            )
        )
    ).catch(() => console.warn("Failed to copy game detection. Building without game detection support"));
}

async function copyLibVesktop() {
    if (process.platform !== "linux") return;

    try {
        await copyNativeModule(
            "./packages/libvesktop/build/Release/vesktop.node",
            `./static/dist/libvesktop-${process.arch}.node`
        );
        console.log("Using local libvesktop build");
    } catch {
        console.log(
            "Using prebuilt libvesktop binaries. Run `pnpm buildLibVesktop` and build again to build from source - see README.md for more details"
        );
        return Promise.all([
            copyNativeModule("./packages/libvesktop/prebuilds/vesktop-x64.node", "./static/dist/libvesktop-x64.node"),
            copyNativeModule(
                "./packages/libvesktop/prebuilds/vesktop-arm64.node",
                "./static/dist/libvesktop-arm64.node"
            )
        ]).catch(() => console.warn("Failed to copy libvesktop. Building without libvesktop support"));
    }
}

await Promise.all([
    copyVenmic(),
    copyLibVesktop(),
    copyGameDetection(),
    copyUiohook(),
    createContext({
        ...NodeCommonOpts,
        entryPoints: ["src/main/index.ts"],
        plugins: [uiohookBinaryPlugin],
        outfile: "dist/js/main.js",
        footer: { js: "//# sourceURL=VesktopMain" }
    }),
    createContext({
        ...NodeCommonOpts,
        entryPoints: ["src/preload/index.ts"],
        outfile: "dist/js/preload.js",
        footer: { js: "//# sourceURL=VesktopPreload" }
    }),
    createContext({
        ...NodeCommonOpts,
        entryPoints: ["src/preload/splash.ts"],
        outfile: "dist/js/splashPreload.js",
        footer: { js: "//# sourceURL=VesktopSplashPreload" }
    }),
    createContext({
        ...NodeCommonOpts,
        entryPoints: ["src/preload/updater.ts"],
        outfile: "dist/js/updaterPreload.js",
        footer: { js: "//# sourceURL=VesktopUpdaterPreload" }
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
        plugins: [vencordDep, includeDirPlugin("patches", "src/renderer/patches")],
        footer: { js: "//# sourceURL=VesktopRenderer" }
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
