import { Middleware, MiddlewareContinue, MiddlewareInterrupt } from "../base/middleware"
import { Effect } from "effect"

export const harpoon_middleware = (...arr: Middleware[]) => {
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

export const non_interrupt_harpoon_middleware = (...arr: Middleware[]) => {
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

export const collection_middleware = (...arr: Middleware[]): Middleware => Effect.gen(function* (_) {
    for (let a of arr) {
        const mp = yield* _(a);
        if (mp === MiddlewareInterrupt) {
            return mp;
        }
    }
});

export const non_interrupt_collection_middleware =
    (...arr: Middleware[]): Middleware => collection_middleware(...arr).pipe(
        Effect.andThen(mw => Effect.succeed(MiddlewareContinue))
    );

export const reverse_collection_middleware = (...arr: Middleware[]): Middleware => Effect.gen(function* (_) {
    for (let a of arr.reverse()) {
        const mp = yield* _(a);
        if (mp === MiddlewareInterrupt) {
            return mp;
        }
    }
});

export const non_interrupt_reverse_collection_middleware =
    (...arr: Middleware[]): Middleware => reverse_collection_middleware(...arr).pipe(
        Effect.andThen(mw => Effect.succeed(MiddlewareContinue))
    );