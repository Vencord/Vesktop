import { applyAppImageSandboxFix } from "./sandboxFix.mjs";

export default async function beforePack() {
    await applyAppImageSandboxFix();
}
