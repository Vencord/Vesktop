/*
 * SPDX-License-Identifier: GPL-3.0
 * Vencord Desktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

/**
 * The SettingsStore allows you to easily create a mutable store that
 * has support for global and path-based change listeners.
 */
export class SettingsStore<T extends object> {
    private pathListeners = new Map<string, Set<(newData: unknown) => void>>();
    private globalListeners = new Set<(newData: T) => void>();

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

                self.globalListeners.forEach(cb => cb(root));
                self.pathListeners.get(setPath)?.forEach(cb => cb(value));

                return true;
            }
        });
    }

    /**
     * Set the data of the store.
     * This will update this.store and this.plain (and old references to them will be stale! Avoid storing them in variables)
     *
     * Additionally, all global listeners will be called with the new data
     * @param value
     */
    public setData(value: T) {
        this.plain = value;
        this.store = this.makeProxy(value);

        this.globalListeners.forEach(cb => cb(value));
    }

    /**
     * Add a global change listener, that will fire whenever any setting is changed
     */
    public addGlobalChangeListener(cb: (store: T) => void) {
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
    public addChangeListener(path: string, cb: (data: any) => void) {
        const listeners = this.pathListeners.get(path) ?? new Set();
        listeners.add(cb);
        this.pathListeners.set(path, listeners);
    }

    /**
     * Remove a global listener
     * @see {@link addGlobalChangeListener}
     */
    public removeGlobalChangeListener(cb: (store: T) => void) {
        this.globalListeners.delete(cb);
    }

    /**
     * Remove a scoped listener
     * @see {@link addChangeListener}
     */
    public removeChangeListener(path: string, cb: (data: any) => void) {
        const listeners = this.pathListeners.get(path);
        if (!listeners) return;

        listeners.delete(cb);
        if (!listeners.size) this.pathListeners.delete(path);
    }
}
