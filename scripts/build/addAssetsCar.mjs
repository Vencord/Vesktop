import { copyFile, readdir } from "fs/promises";

/**
 * @param {{
 *   readonly appOutDir: string;
 *   readonly arch: Arch;
 *   readonly electronPlatformName: string;
 *   readonly outDir: string;
 *   readonly packager: PlatformPackager;
 *   readonly targets: Target[];
 * }} context
 */
export async function addAssetsCar({ appOutDir }) {
    if (process.platform !== "darwin") return;

    const appName = (await readdir(appOutDir)).find(item => item.endsWith(".app"));

    if (!appName) {
        console.warn(`Could not find .app directory in ${appOutDir}. Skipping adding assets.car`);
        return;
    }

    await copyFile("build/Assets.car", `${appOutDir}/${appName}/Contents/Resources/Assets.car`);
}
