import { Plugin } from "esbuild";
import { readdir } from "fs/promises";

const makeImportAllCode = (files: string[]) =>
    files.map(f => `require("./${f.replace(/\.[cm]?[tj]sx?$/, "")}")`).join("\n");

const makeImportDirRecursiveCode = (dir: string) => readdir(dir).then(files => makeImportAllCode(files));

export function includeDirPlugin(namespace: string, path: string): Plugin {
    return {
        name: `include-dir-plugin:${namespace}`,
        setup(build) {
            const filter = new RegExp(`^__${namespace}__$`);

            build.onResolve({ filter }, args => ({ path: args.path, namespace }));

            build.onLoad({ filter, namespace }, async args => {
                return {
                    contents: await makeImportDirRecursiveCode(path),
                    resolveDir: path
                };
            });
        }
    };
}
