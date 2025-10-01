/**
 * @type {typeof import(".")}
 */
const libVesktop = require(".");

console.log(libVesktop.getAccentColor().toString(16));
console.log(libVesktop.updateUnityLauncherCount(5));
console.log(libVesktop.updateUnityLauncherCount(0));
console.log(libVesktop.updateUnityLauncherCount(10));
console.log(libVesktop.requestBackground(true, ["bash"]));
console.log(libVesktop.requestBackground(false, ["bash"]));
