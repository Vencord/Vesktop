import { BuildContext, BuildOptions, context } from "esbuild";

const NodeCommonOpts: BuildOptions = {
    format: "cjs",
    platform: "node",
    external: ["electron"],
    minify: true,
    bundle: true,
    sourcemap: "linked",
    logLevel: "info"
};

const contexts = [] as BuildContext[];
async function createContext(options: BuildOptions) {
    contexts.push(await context(options));
}

await Promise.all([
    createContext({
        ...NodeCommonOpts,
        entryPoints: ["src/main/index.ts"],
        outfile: "dist/main.js"
    }),
    createContext({
        ...NodeCommonOpts,
        entryPoints: ["src/preload/index.ts"],
        outfile: "dist/preload.js"
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
