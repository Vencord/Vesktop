/**
 * @type {typeof import(".")}
 */
const libVesktop = require(".");
const test = require("node:test");
const assert = require("node:assert/strict");

test("getAccentColor should return a number", () => {
    const color = libVesktop.getAccentColor();
    assert.strictEqual(typeof color, "number");
});

test("requestBackground should return true (success)", () => {
    assert.strictEqual(libVesktop.requestBackground(true, ["bash"]), true);
    assert.strictEqual(libVesktop.requestBackground(false, []), true);
});
