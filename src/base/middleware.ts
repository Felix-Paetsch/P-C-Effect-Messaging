import { Effect, Context, Data } from "effect";
import { Address } from "./address";
import { findEndpoint } from "./endpoints";
import { MessageT, Message } from "./message";
import { LocalComputedMessageDataT } from "./local_computed_message_data";

export class MiddlewareError extends Data.TaggedError("MiddlewareError")<{ err: Error, message: Message }> { }

type MiddlewareInterrupt = { readonly __brand: "MiddlewareInterrupt" };
type MiddlewareContinue = { readonly __brand: "MiddlewareContinue" } | void | undefined;
export type MiddlewarePassthrough = MiddlewareInterrupt | MiddlewareContinue;
export const MiddlewareInterrupt: MiddlewareInterrupt = { __brand: "MiddlewareInterrupt" } as MiddlewareInterrupt;
export const MiddlewareContinue: MiddlewareContinue = { __brand: "MiddlewareContinue" } as MiddlewareContinue;

export type Middleware = Effect.Effect<MiddlewarePassthrough, MiddlewareError, MessageT | LocalComputedMessageDataT>;

export type MiddlewareConf = {
    readonly middleware: Middleware;
    readonly address: Address;
}

export class MiddlewareConfT extends Context.Tag("MiddlewareConfT")<
    MiddlewareConfT,
    MiddlewareConf
>() { }

export const useMiddleware = Effect.gen(function* (_) {
    const {
        middleware,
        address
    } = yield* _(MiddlewareConfT);

    const endpoint = yield* _(findEndpoint(address));

    endpoint.middlewares.push(middleware);

    return yield* _(Effect.void);
});

export const catchAllAsMiddlewareError = Effect.mapError((err: Error) => Effect.gen(function* (_) {
    const message = yield* _(MessageT);
    return yield* Effect.fail(new MiddlewareError({
        err,
        message
    }))
}))