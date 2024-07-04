/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { LiteralUnion } from "type-fest";

// Resolves a possibly nested prop in the form of "some.nested.prop" to type of T.some.nested.prop
type ResolvePropDeep<T, P> = P extends `${infer Pre}.${infer Suf}`
    ? Pre extends keyof T
        ? ResolvePropDeep<T[Pre], Suf>
        : any
    : P extends keyof T
      ? T[P]
      : any;

/**
 * The SettingsStore allows you to easily create a mutable store that
 * has support for global and path-based change listeners.
 */
export class SettingsStore<T extends object> {
    private pathListeners = new Map<string, Set<(newData: any) => void>>();
    private globalListeners = new Set<(newData: T, path: string) => void>();

    /**
     * The store object. Making changes to this object will trigger the applicable change listeners
     */
    public declare store: T;
    /**
     * The plain data. Changes to this object will not trigger any change listeners
     */
    public declare plain: T;

    public constructor(plain: T) {
        this.plain = plain;
        this.store = this.makeProxy(plain);
    }

    private makeProxy(object: any, root: T = object, path: string = "") {
        const self = this;

        return new Proxy(object, {
            get(target, key: string) {
                const v = target[key];

                if (typeof v === "object" && v !== null && !Array.isArray(v))
                    return self.makeProxy(v, root, `${path}${path && "."}${key}`);

                return v;
            },
            set(target, key: string, value) {
                if (target[key] === value) return true;

                Reflect.set(target, key, value);
                const setPath = `${path}${path && "."}${key}`;

                self.globalListeners.forEach(cb => cb(root, setPath));
                self.pathListeners.get(setPath)?.forEach(cb => cb(value));

                return true;
            },
            deleteProperty(target, key: string) {
                if (!(key in target)) return true;

                const res = Reflect.deleteProperty(target, key);
                if (!res) return false;

                const setPath = `${path}${path && "."}${key}`;

                self.globalListeners.forEach(cb => cb(root, setPath));
                self.pathListeners.get(setPath)?.forEach(cb => cb(undefined));

                return res;
            }
        });
    }

    /**
     * Set the data of the store.
     * This will update this.store and this.plain (and old references to them will be stale! Avoid storing them in variables)
     *
     * Additionally, all global listeners (and those for pathToNotify, if specified) will be called with the new data
     * @param value New data
     * @param pathToNotify Optional path to notify instead of globally. Used to transfer path via ipc
     */
    public setData(value: T, pathToNotify?: string) {
        this.plain = value;
        this.store = this.makeProxy(value);

        if (pathToNotify) {
            let v = value;

            const path = pathToNotify.split(".");
            for (const p of path) {
                if (!v) {
                    console.warn(
                        `Settings#setData: Path ${pathToNotify} does not exist in new data. Not dispatching update`
                    );
                    return;
                }
                v = v[p];
            }

            this.pathListeners.get(pathToNotify)?.forEach(cb => cb(v));
        }

        this.globalListeners.forEach(cb => cb(value, ""));
    }

    /**
     * Add a global change listener, that will fire whenever any setting is changed
     */
    public addGlobalChangeListener(cb: (data: T, path: string) => void) {
        this.globalListeners.add(cb);
    }

    /**
     * Add a scoped change listener that will fire whenever a setting matching the specified path is changed.
     *
     * For example if path is `"foo.bar"`, the listener will fire on
     * ```js
     * Setting.store.foo.bar = "hi"
     * ```
     * but not on
     * ```js
     * Setting.store.foo.baz = "hi"
     * ```
     * @param path
     * @param cb
     */
    public addChangeListener<P extends LiteralUnion<keyof T, string>>(
        path: P,
        cb: (data: ResolvePropDeep<T, P>) => void
    ) {
        const listeners = this.pathListeners.get(path as string) ?? new Set();
        listeners.add(cb);
        this.pathListeners.set(path as string, listeners);
    }

    /**
     * Remove a global listener
     * @see {@link addGlobalChangeListener}
     */
    public removeGlobalChangeListener(cb: (data: T, path: string) => void) {
        this.globalListeners.delete(cb);
    }

    /**
     * Remove a scoped listener
     * @see {@link addChangeListener}
     */
    public removeChangeListener(path: LiteralUnion<keyof T, string>, cb: (data: any) => void) {
        const listeners = this.pathListeners.get(path as string);
        if (!listeners) return;

        listeners.delete(cb);
        if (!listeners.size) this.pathListeners.delete(path as string);
    }

    /**
     * Call all global change listeners
     */
    public markAsChanged() {
        this.globalListeners.forEach(cb => cb(this.plain, ""));
    }
}
