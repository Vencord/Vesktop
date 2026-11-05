/**
 * @type {typeof import(".")}
 */
const libVesktop = require(".");
const test = require("node:test");
const assert = require("node:assert/strict");

test("requestBackground should return true (success)", () => {
    assert.strictEqual(libVesktop.requestBackground(true, ["bash"]), true);
    assert.strictEqual(libVesktop.requestBackground(false, []), true);
});

test("isStatusNotifierHostRegistered should return true", () => {
    assert.strictEqual(libVesktop.isStatusNotifierHostRegistered(), true);
});
