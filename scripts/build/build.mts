import { BuildContext, BuildOptions, context } from "esbuild";

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

await Promise.all([
    createContext({
        ...NodeCommonOpts,
        entryPoints: ["src/main/index.ts"],
        outfile: "dist/js/main.js"
    }),
    createContext({
        ...NodeCommonOpts,
        entryPoints: ["src/preload/index.ts"],
        outfile: "dist/js/preload.js"
    }),
    createContext({
        ...CommonOpts,
        globalName: "VencordDesktop",
        entryPoints: ["src/renderer/index.ts"],
        outfile: "dist/js/renderer.js",
        format: "iife",
        inject: ["./scripts/build/injectReact.mjs"],
        jsxFactory: "VencordCreateElement",
        jsxFragment: "VencordFragment",
        // Work around https://github.com/evanw/esbuild/issues/2460
        tsconfig: "./scripts/build/tsconfig.esbuild.json"
    })
]);

const watch = process.argv.includes("--watch");

if (watch) {
    await Promise.all(contexts.map(ctx => ctx.watch()));
} else {
    await Promise.all(contexts.map(async ctx => {
        await ctx.rebuild();
        await ctx.dispose();
    }));
}
