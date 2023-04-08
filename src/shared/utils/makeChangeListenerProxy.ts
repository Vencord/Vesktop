export function makeChangeListenerProxy<T extends object>(object: T, onChange: (object: T) => void, _root = object): T {
    return new Proxy(object, {
        get(target, key) {
            const v = target[key];
            if (typeof v === "object" && !Array.isArray(v) && v !== null)
                return makeChangeListenerProxy(v, onChange, _root);

            return v;
        },

        set(target, key, value) {
            if (target[key] === value) return true;

            Reflect.set(target, key, value);
            onChange(_root);

            return true;
        },
    });
}
