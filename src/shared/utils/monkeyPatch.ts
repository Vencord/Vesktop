type Func = (...args: any[]) => any;

export function monkeyPatch<O extends object>(object: O, key: keyof O, replacement: (original: Func, ...args: any[]) => any): void {
    const original = object[key] as Func;

    const replacer = object[key] = function (this: unknown, ...args: any[]) {
        return replacement.call(this, original, ...args);
    } as any;

    Object.defineProperties(replacer, Object.getOwnPropertyDescriptors(original));
    replacer.toString = () => original.toString();
    replacer.$$original = original;
}
