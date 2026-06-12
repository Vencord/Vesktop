/**
 * @type {typeof import(".")}
 */
const libVesktop = require(".");
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

test("updateUnityLauncherCount should return true (success)", () => {
    assert.strictEqual(libVesktop.updateUnityLauncherCount(5), true);
    assert.strictEqual(libVesktop.updateUnityLauncherCount(0), true);
    assert.strictEqual(libVesktop.updateUnityLauncherCount(10), true);
});

test("requestBackground should return true (success)", () => {
    assert.strictEqual(libVesktop.requestBackground(true, ["bash"]), true);
    assert.strictEqual(libVesktop.requestBackground(false, []), true);
});

// test("XDPGlobalShortcuts", async (t) => { // standalone tests need own glib thread and loop, electron handles this
//     let globalShortcuts;
//     const emitter = new EventEmitter();
//     globalShortcuts = new libVesktop.XDPGlobalShortcuts(emitter);

//     const waitForEvent = (event, timeoutMs = 5000) =>
//         new Promise((resolve, reject) => {
//             const timeout = setTimeout(() => reject(new Error(`timeout waiting for '${event}'`)), timeoutMs);
//             emitter.once(event, (...args) => {
//                 clearTimeout(timeout);
//                 resolve(args);
//             });
//             emitter.once("fatal", err => {
//                 clearTimeout(timeout);
//                 reject(new Error(`fatal: ${err}`));
//             });
//             emitter.once("error", err => {
//                 clearTimeout(timeout);
//                 console.log(err)
//                 resolve(err);
//             });
//         });

//     await t.test("ready event fires", async () => {
//         const [sessionHandle] = await waitForEvent("ready");
//         assert.ok(sessionHandle, "session handle should be non-empty");
//     });
//     await t.test("bindShortcuts and shortcutEvent fires", async t => {
//         t.diagnostic("Press any bound shortcut within 30 seconds...");
//         const shortcuts = [
//             { id: "toggle", description: "Toggle Vesktop" },
//             { id: "mute", description: "Mute microphone", preferred_trigger: "CTRL+1" }
//         ];
//         globalShortcuts.bindShortcuts(shortcuts);
//         const [id, pressed, timestamp] = await waitForEvent("shortcutEvent", 30_000);
//         console.log(id, pressed, timestamp)
//         assert.ok(id.length > 0, "shortcut id should be non-empty");
//         assert.ok(
//             shortcuts.some(s => s.id === id),
//             `fired shortcut id '${id}' should be one of the registered shortcuts`
//         );
//         assert.strictEqual(typeof pressed, "boolean", "pressed should be a boolean");
//         assert.ok(Number.isFinite(timestamp), "timestamp should be a finite number");
//         assert.ok(timestamp >= 0, "timestamp should be non-negative");
//     });

//     // await t.test("configureShortcuts()", async () => {
//     //     globalShortcuts.configureShortcuts();
//     //     await waitForEvent("fatal");
//     // })

//     globalShortcuts.destroy();
// })
