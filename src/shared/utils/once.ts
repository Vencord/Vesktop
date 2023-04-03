export function once<T extends Function>(fn: T): T {
    let called = false;
    return function (this: any, ...args: any[]) {
        if (called) return;
        called = true;
        return fn.apply(this, args);
    } as any;
}
