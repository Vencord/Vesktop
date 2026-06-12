/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BuildContext, BuildOptions, context } from "esbuild";
import { copyFile } from "fs/promises";
const { UiohookKey } = await import("uiohook-napi");

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
    loader: {
        ".node": "file"
    },
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

async function copyUIOHook() {
    const p = process.platform;
    const base = `./node_modules/uiohook-napi/prebuilds/${p}`;
    if (p == "linux" || p == "win32" || p == "darwin")
        return Promise.all([
            copyFile(`${base}-x64/uiohook-napi.node`, "./static/dist/uiohook-napi-x64.node"),
            copyFile(`${base}-arm64/uiohook-napi.node`, "./static/dist/uiohook-napi-arm64.node")
        ]).catch(() => console.error("Failed to copy uiohook. exploding"));
}

async function copyLibVesktop() {
    if (process.platform !== "linux") return;

    try {
        await copyFile(
            "./packages/libvesktop/build/Release/vesktop.node",
            `./static/dist/libvesktop-${process.arch}.node`
        );
        console.log("Using local libvesktop build");
    } catch {
        console.log(
            "Using prebuilt libvesktop binaries. Run `pnpm buildLibVesktop` and build again to build from source - see README.md for more details"
        );
        return Promise.all([
            copyFile("./packages/libvesktop/prebuilds/vesktop-x64.node", "./static/dist/libvesktop-x64.node"),
            copyFile("./packages/libvesktop/prebuilds/vesktop-arm64.node", "./static/dist/libvesktop-arm64.node")
        ]).catch(() => console.warn("Failed to copy libvesktop. Building without libvesktop support"));
    }
}

await Promise.all([
    copyVenmic(),
    copyLibVesktop(),
    copyUIOHook(),
    createContext({
        ...NodeCommonOpts,
        entryPoints: ["src/main/index.ts"],
        plugins: [
            {
                name: "uiohook-napi-native",
                setup(build) {
                    build.onResolve({ filter: /^node-gyp-build$/ }, args => {
                        if (args.importer.includes("uiohook-napi"))
                            return { path: "uiohook-gyp-build", namespace: "uiohook-gyp-build" };
                    });
                    build.onLoad({ filter: /.*/, namespace: "uiohook-gyp-build" }, () => ({
                        contents: `
                            const { join } = require("path");
                            module.exports = () => require(join(__dirname, "..", "..", \`static/dist/uiohook-napi-\${process.arch}.node\`));`,
                        loader: "js"
                    }));
                }
            }
        ],

        outfile: "dist/js/main.js",
        footer: { js: "//# sourceURL=VesktopMain" }
    }),
    createContext({
        ...NodeCommonOpts,
        entryPoints: ["src/main/arrpc/worker.ts"],
        outfile: "dist/js/arRpcWorker.js",
        footer: { js: "//# sourceURL=VesktopArRpcWorker" }
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
        plugins: [
            vencordDep,
            includeDirPlugin("patches", "src/renderer/patches"),
            {
                name: "uiohook-napi-stub",
                setup(build) {
                    build.onResolve({ filter: /^uiohook-napi$/ }, () => ({
                        path: "uiohook-napi-stub",
                        namespace: "uiohook-napi-stub"
                    }));
                    build.onLoad({ filter: /.*/, namespace: "uiohook-napi-stub" }, () => {
                        return {
                            contents: `export const UiohookKey = ${JSON.stringify(UiohookKey, null, 2)} as const;`,
                            loader: "ts"
                        };
                    });
                }
            }
        ],
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
