import { Middleware, MiddlewareContinue, MiddlewareInterrupt } from "../base/middleware"
import { Effect } from "effect"

export function harpoon_middleware(arr: Middleware[]): Array<Middleware> & (() => Middleware);
export function harpoon_middleware(...arr: Middleware[]): Array<Middleware> & (() => Middleware);
export function harpoon_middleware(...args: any[]): Array<Middleware> & (() => Middleware) {
    const arr: Middleware[] = Array.isArray(args[0]) ? args[0] : args;

    const mwf = (): Middleware => Effect.gen(function* (_) {
        for (let a of arr) {
            const mp = yield* _(a);
            if (mp === MiddlewareInterrupt) {
                return mp;
            }
        }
        return MiddlewareContinue;
    });

    return new Proxy(mwf, {
        get(target, prop, receiver) {
            if (prop in arr) {
                return (arr as any)[prop];
            }
            return Reflect.get(target, prop, receiver);
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

    const mwf = (): Middleware => Effect.gen(function* (_) {
        for (let a of arr) {
            const mp = yield* _(a);
            if (mp === MiddlewareInterrupt) {
                return MiddlewareContinue;
            }
        }
        return MiddlewareContinue;
    });

    return new Proxy(mwf, {
        get(target, prop, receiver) {
            if (prop in arr) {
                return (arr as any)[prop];
            }
            return Reflect.get(target, prop, receiver);
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

    return Effect.gen(function* (_) {
        for (let a of arr) {
            const mp = yield* _(a);
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

    return Effect.gen(function* (_) {
        for (let a of arr.reverse()) {
            const mp = yield* _(a);
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