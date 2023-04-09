/*
 * SPDX-License-Identifier: GPL-3.0
 * Vencord Desktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

export class SettingsStore<T extends object> {
    public declare store: T;
    private globalListeners = new Set<(newData: T) => void>();
    private pathListeners = new Map<string, Set<(newData: unknown) => void>>();

    public constructor(public plain: T) {
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

    public setData(value: T) {
        this.plain = value;
        this.store = this.makeProxy(value);

        this.globalListeners.forEach(cb => cb(value));
    }

    public addGlobalChangeListener(cb: (store: T) => void) {
        this.globalListeners.add(cb);
    }

    public addChangeListener(path: string, cb: (data: any) => void) {
        const listeners = this.pathListeners.get(path) ?? new Set();
        listeners.add(cb);
        this.pathListeners.set(path, listeners);
    }

    public removeGlobalChangeListener(cb: (store: T) => void) {
        this.globalListeners.delete(cb);
    }

    public removeChangeListener(path: string, cb: (data: any) => void) {
        const listeners = this.pathListeners.get(path);
        if (!listeners) return;

        listeners.delete(cb);
        if (!listeners.size) this.pathListeners.delete(path);
    }
}
