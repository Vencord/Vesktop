import { spawn as cpSpawn, SpawnOptions } from "child_process";
import { join } from "path";

const EXT = process.platform === "win32" ? ".cmd" : "";

const OPTS: SpawnOptions = {
    stdio: "inherit",
};

function spawn(bin: string, args: string[]) {
    cpSpawn(join("node_modules", ".bin", bin + EXT), args, OPTS);
}

spawn("tsx", ["scripts/build/build.mts", "--", "--watch"]);
spawn("electron", ["."]);
