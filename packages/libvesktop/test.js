/**
 * @type {typeof import(".")}
 */
const libVesktop = require(".");

console.log(libVesktop.getAccentColor().toString(16));
console.log(libVesktop.updateUnityLauncherEntry(5));
console.log(libVesktop.updateUnityLauncherEntry(0));
console.log(libVesktop.updateUnityLauncherEntry(10));
console.log(libVesktop.requestBackground(true, ["bash"]));
