import { Middleware, MiddlewareContinue, MiddlewareInterrupt } from "../base/middleware"
import { Effect } from "effect"

export const collection_middleware = (...arr: Middleware[]): Middleware => Effect.gen(function* (_) {
    for (let a of arr) {
        const mp = yield* _(a);
        if (mp === MiddlewareInterrupt) {
            return mp;
        }
    }
});

export const interruptable_collection_middleware = (...arr: Middleware[]): Middleware => Effect.gen(function* (_) {
    for (let a of arr) {
        const mp = yield* _(a);
        if (mp === MiddlewareInterrupt) {
            return MiddlewareContinue;
        }
    }
});