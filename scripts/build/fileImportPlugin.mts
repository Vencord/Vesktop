import { readFile } from "fs/promises";
import { resolve } from "path";

import type { Plugin } from "esbuild";

export const fileImportPlugin: Plugin = {
    name: "file-import",
    setup(build) {
        build.onResolve({ filter: /^file:\/\// }, ({ path, resolveDir }) => ({
            path: resolve(resolveDir, path.slice("file://".length)),
            namespace: "file-import"
        }));

        build.onLoad({ filter: /.*/, namespace: "file-import" }, async ({ path }) => ({
            contents: await readFile(path, "utf8"),
            loader: "text",
            watchFiles: [path]
        }));
    }
};
