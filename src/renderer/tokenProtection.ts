/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Protect the Discord token from token grabbers that read LevelDB / the Cookies
// SQLite database directly from disk.
//
// When safeStorage is available we intercept:
//   - localStorage "token"  key  (primary single-account token)
//   - document.cookie "tokens" key  (multi-account JSON map)
// and store OS-encrypted blobs (DPAPI / Keychain / libsecret) instead.
// The plaintext never reaches disk.
//
// If encryption was expected but a specific call fails we refuse the write
// entirely rather than silently falling back to plaintext.  The in-memory
// cache still gets updated so the *current* session keeps working, but
// nothing is persisted — meaning a restart while safeStorage is broken
// results in a silent re-login (acceptable trade-off vs. leaking the token).
//
// When safeStorage is NOT available we strip Expires/Max-Age from the "tokens"
// cookie so Chromium treats it as session-only and avoids persisting it to the
// Cookies SQLite file between restarts.  localStorage gets no protection in
// that case — there is no key material to work with.
//
// Decryption failures in the cookie getter return the raw (possibly encrypted)
// value.  Discord will not recognise it as a valid token and trigger a
// re-login — this is preferable to exposing a decryption error to the page.
//
// Cookie migration (plaintext → encrypted) on first launch after this update
// is handled in the main process via session.defaultSession.cookies where the
// full cookie attributes (Path, Expires, Domain, …) are available.
//
// Coverage: localStorage + tokens cookie.  IndexedDB was checked (2026-04) and
// Discord does not cache tokens there — if that changes this will need a
// corresponding proxy.
//
// The cookie proxy is defined with configurable: false to prevent Discord,
// plugins, or injected code from silently redefining it.  Any attempt to
// Object.defineProperty(document, "cookie", …) after this will throw a
// TypeError — this is intentional (loud failure > silent bypass).
//
// Asymmetry note: on encryption failure the localStorage path wipes the
// plaintext key (forces re-login), while the cookie path refuses the new
// write but leaves the *previous* (already encrypted) cookie intact.  This
// is correct because the cookie's "old value" is the encrypted blob from a
// prior successful write, not plaintext.

const TOKEN_LS_KEY = "token";
const ENCRYPTED_LS_KEY = "VCD_ENCRYPTED_TOKEN";
const TOKENS_COOKIE = "tokens";

// Capture localStorage before Discord removes it from window.
const ls = window.localStorage;

const encryptionAvailable = VesktopNative.safeStorage.isAvailable();

// ─── localStorage proxy ────────────────────────────────────────────────────

if (encryptionAvailable) {
    let cachedToken: string | null = null;

    // Migrate any existing plaintext token to encrypted storage.
    // Always remove the plaintext key — even if encryption fails it is better
    // to force a re-login than to leave the token exposed on disk.
    const existingPlaintext = Storage.prototype.getItem.call(ls, TOKEN_LS_KEY);
    if (existingPlaintext) {
        Storage.prototype.removeItem.call(ls, TOKEN_LS_KEY);

        const encrypted = VesktopNative.safeStorage.encryptToken(existingPlaintext);
        if (encrypted) {
            Storage.prototype.setItem.call(ls, ENCRYPTED_LS_KEY, encrypted);
            cachedToken = existingPlaintext;
        } else {
            console.error("[Vesktop] Token migration encryption failed — plaintext removed, re-login required");
        }
    } else {
        const storedEncrypted = Storage.prototype.getItem.call(ls, ENCRYPTED_LS_KEY);
        if (storedEncrypted) {
            cachedToken = VesktopNative.safeStorage.decryptToken(storedEncrypted);
        }
    }

    const origSetItem = Storage.prototype.setItem;
    const origGetItem = Storage.prototype.getItem;
    const origRemoveItem = Storage.prototype.removeItem;

    Storage.prototype.setItem = function (key: string, value: string) {
        if (this === ls && key === TOKEN_LS_KEY) {
            // Defensively wipe any leftover plaintext key (e.g. from a previous
            // session whose migration didn't run or from Discord writing it
            // before our proxy was active).
            origRemoveItem.call(this, TOKEN_LS_KEY);

            const encrypted = VesktopNative.safeStorage.encryptToken(value);
            if (!encrypted) {
                console.error("[Vesktop] Token encryption failed — refusing to store plaintext token");
            } else {
                origSetItem.call(this, ENCRYPTED_LS_KEY, encrypted);
            }
            cachedToken = value;
            return;
        }
        origSetItem.call(this, key, value);
    };

    Storage.prototype.getItem = function (key: string) {
        if (this === ls && key === TOKEN_LS_KEY) return cachedToken;
        return origGetItem.call(this, key);
    };

    Storage.prototype.removeItem = function (key: string) {
        if (this === ls && key === TOKEN_LS_KEY) {
            origRemoveItem.call(this, ENCRYPTED_LS_KEY);
            cachedToken = null;
            return;
        }
        origRemoveItem.call(this, key);
    };
}

// ─── document.cookie proxy ────────────────────────────────────────────────
//
// Discord stores multi-account tokens as a JSON map in the "tokens" cookie:
//   { "__analytics__": "<token>", "<userId>": "<token>", ... }
//
// Token grabbers read the Cookies SQLite file directly, so we intercept
// writes here before Chromium persists them.

const origCookieDesc = Object.getOwnPropertyDescriptor(Document.prototype, "cookie")!;

Object.defineProperty(document, "cookie", {
    // Prevent Discord, plugins, or injected code from redefining the proxy.
    configurable: false,

    get(): string {
        const raw = origCookieDesc.get!.call(this) as string;
        if (!encryptionAvailable) return raw;

        return raw.replace(/((?:^|;\s*)tokens=)([^;]*)/g, (full, prefix, encValue) => {
            try {
                const decrypted = VesktopNative.safeStorage.decryptToken(decodeURIComponent(encValue));
                return decrypted ? `${prefix}${encodeURIComponent(decrypted)}` : full;
            } catch {
                return full;
            }
        });
    },

    set(value: string) {
        const eqIdx = value.indexOf("=");
        if (eqIdx < 0) {
            origCookieDesc.set!.call(this, value);
            return;
        }

        const name = value.slice(0, eqIdx).trim();
        if (name !== TOKENS_COOKIE) {
            origCookieDesc.set!.call(this, value);
            return;
        }

        const afterEq = value.slice(eqIdx + 1);
        const semiIdx = afterEq.indexOf(";");
        const rawValue = semiIdx >= 0 ? afterEq.slice(0, semiIdx) : afterEq;
        let attrs = semiIdx >= 0 ? afterEq.slice(semiIdx) : "";

        if (encryptionAvailable) {
            let decoded: string;
            try {
                decoded = decodeURIComponent(rawValue);
            } catch {
                console.error("[Vesktop] Token cookie has invalid encoding — refusing to store");
                return;
            }
            const encrypted = VesktopNative.safeStorage.encryptToken(decoded);
            if (encrypted) {
                origCookieDesc.set!.call(this, `${TOKENS_COOKIE}=${encodeURIComponent(encrypted)}${attrs}`);
            } else {
                console.error("[Vesktop] Token cookie encryption failed — refusing to store plaintext");
            }
            return;
        }

        // No encryption: strip persistence attributes so the cookie is session-only.
        attrs = attrs.replace(/;\s*(?:expires|max-age)=[^;]*/gi, "");
        origCookieDesc.set!.call(this, `${TOKENS_COOKIE}=${rawValue}${attrs}`);
    }
});
