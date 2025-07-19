import { Effect } from "effect";
import { Middleware, MiddlewareContinue, MiddlewareInterrupt } from "../base/middleware";

export function harpoon_middleware(arr: Middleware[]): Array<Middleware> & (() => Middleware);
export function harpoon_middleware(...arr: Middleware[]): Array<Middleware> & (() => Middleware);
export function harpoon_middleware(...args: any[]): Array<Middleware> & (() => Middleware) {
    const arr: Middleware[] = Array.isArray(args[0]) ? args[0] : args;

    const mwf = (): Middleware => Effect.gen(function* () {
        for (let a of arr) {
            const mp = yield* a;
            if (mp === MiddlewareInterrupt) {
                return mp;
            }
        }
        return MiddlewareContinue;
    });

    return new Proxy(mwf, {
        get(target, prop, receiver) {
            if (prop in arr) {
                const value = (arr as any)[prop];
                if (typeof value === 'function') {
                    return value.bind(arr);
                }
                return value;
            }
            return Reflect.get(target, prop, receiver);
        },
        set(target, prop, value, receiver) {
            if (prop in arr) {
                (arr as any)[prop] = value;
                return true;
            }
            return Reflect.set(target, prop, value, receiver);
        },
        has(target, prop) {
            return prop in arr || Reflect.has(target, prop);
        },
        ownKeys(target) {
            return [...Reflect.ownKeys(arr), ...Reflect.ownKeys(target)];
        },
        getOwnPropertyDescriptor(target, prop) {
            if (prop in arr) {
                return Reflect.getOwnPropertyDescriptor(arr, prop);
            }
            return Reflect.getOwnPropertyDescriptor(target, prop);
        }
    }) as Array<Middleware> & (() => Middleware);
}

export function non_interrupt_harpoon_middleware(arr: Middleware[]): Array<Middleware> & (() => Middleware);
export function non_interrupt_harpoon_middleware(...arr: Middleware[]): Array<Middleware> & (() => Middleware);
export function non_interrupt_harpoon_middleware(...args: any[]): Array<Middleware> & (() => Middleware) {
    const arr: Middleware[] = Array.isArray(args[0]) ? args[0] : args;

    const mwf = (): Middleware => Effect.gen(function* () {
        for (let a of arr) {
            const mp = yield* a;
            if (mp === MiddlewareInterrupt) {
                return MiddlewareContinue;
            }
        }
        return MiddlewareContinue;
    });

    return new Proxy(mwf, {
        get(target, prop, receiver) {
            if (prop in arr) {
                const value = (arr as any)[prop];
                if (typeof value === 'function') {
                    return value.bind(arr);
                }
                return value;
            }
            return Reflect.get(target, prop, receiver);
        },
        set(target, prop, value, receiver) {
            if (prop in arr) {
                (arr as any)[prop] = value;
                return true;
            }
            return Reflect.set(target, prop, value, receiver);
        },
        has(target, prop) {
            return prop in arr || Reflect.has(target, prop);
        },
        ownKeys(target) {
            return [...Reflect.ownKeys(arr), ...Reflect.ownKeys(target)];
        },
        getOwnPropertyDescriptor(target, prop) {
            if (prop in arr) {
                return Reflect.getOwnPropertyDescriptor(arr, prop);
            }
            return Reflect.getOwnPropertyDescriptor(target, prop);
        }
    }) as Array<Middleware> & (() => Middleware);
}

export function collection_middleware(arr: Middleware[]): Middleware;
export function collection_middleware(...arr: Middleware[]): Middleware;
export function collection_middleware(...args: any[]): Middleware {
    const arr: Middleware[] = Array.isArray(args[0]) ? args[0] : args;

    return Effect.gen(function* () {
        for (let a of arr) {
            const mp = yield* a;
            if (mp === MiddlewareInterrupt) {
                return mp;
            }
        }
    });
}

export function non_interrupt_collection_middleware(arr: Middleware[]): Middleware;
export function non_interrupt_collection_middleware(...arr: Middleware[]): Middleware;
export function non_interrupt_collection_middleware(...args: any[]): Middleware {
    const arr: Middleware[] = Array.isArray(args[0]) ? args[0] : args;

    return collection_middleware(arr).pipe(
        Effect.andThen(mw => Effect.succeed(MiddlewareContinue))
    );
}

export function reverse_collection_middleware(arr: Middleware[]): Middleware;
export function reverse_collection_middleware(...arr: Middleware[]): Middleware;
export function reverse_collection_middleware(...args: any[]): Middleware {
    const arr: Middleware[] = Array.isArray(args[0]) ? args[0] : args;

    return Effect.gen(function* () {
        for (let a of arr.reverse()) {
            const mp = yield* a;
            if (mp === MiddlewareInterrupt) {
                return mp;
            }
        }
    });
}

export function non_interrupt_reverse_collection_middleware(arr: Middleware[]): Middleware;
export function non_interrupt_reverse_collection_middleware(...arr: Middleware[]): Middleware;
export function non_interrupt_reverse_collection_middleware(...args: any[]): Middleware {
    const arr: Middleware[] = Array.isArray(args[0]) ? args[0] : args;

    return reverse_collection_middleware(arr).pipe(
        Effect.andThen(mw => Effect.succeed(MiddlewareContinue))
    );
}