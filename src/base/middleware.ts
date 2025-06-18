import { Effect, Context, Data } from "effect";
import { Address, AddressT } from "./address";
import { findOrCreateEndpoint } from "./endpoints";
import { MessageT } from "./message";
import { LocalComputedMessageDataT } from "./local_computed_message_data";
import { Message } from "./message";

export class MiddlewareError extends Data.TaggedError("MiddlewareError")<{ err: Error, message: Message }> { }

type MiddlewareInterrupt = { readonly __brand: "MiddlewareInterrupt" };
type MiddlewareContinue = { readonly __brand: "MiddlewareContinue" } | void | undefined;
export type MiddlewarePassthrough = MiddlewareInterrupt | MiddlewareContinue;
export const MiddlewareInterrupt: MiddlewareInterrupt = { __brand: "MiddlewareInterrupt" } as MiddlewareInterrupt;
export const MiddlewareContinue: MiddlewareContinue = { __brand: "MiddlewareContinue" } as MiddlewareContinue;

export type Middleware = Effect.Effect<MiddlewarePassthrough, MiddlewareError, MessageT | LocalComputedMessageDataT>;

export type MiddlewarePosition = "MSG_IN" | "MSG_OUT" | "ALL";
export type RegisteredMiddleware = {
    position: MiddlewarePosition;
    middleware: Middleware;
};

export type MiddlewareConf = {
    readonly middleware: Middleware;
    readonly position: MiddlewarePosition;
    readonly address: Address;
}

export class MiddlewareConfT extends Context.Tag("MiddlewareConfT")<
    MiddlewareConfT,
    MiddlewareConf
>() { }

export const useMiddleware = Effect.gen(function* (_) {
    const {
        middleware,
        address,
        position
    } = yield* _(MiddlewareConfT);

    const endpoint = findOrCreateEndpoint(address);

    endpoint.middlewares.push({
        middleware,
        position
    });

    return yield* _(Effect.void);
});

export const catchAllAsMiddlewareError = Effect.catchAll((error: Error) => Effect.gen(function* (_) {
    const message = yield* _(MessageT);
    return yield* Effect.fail(new MiddlewareError({
        err: error,
        message
    }))
}))

export const middlewareEffect = (position: MiddlewarePosition) =>
    Effect.gen(function* (_) {
        const address = yield* _(AddressT);
        const endpoint = findOrCreateEndpoint(address);

        const relevant_middleware = endpoint.middlewares.filter(
            m => m.position == position || m.position == "ALL"
        ).map(m => m.middleware);

        for (const middleware of relevant_middleware) {
            const interrupt = yield* _(middleware);
            if (interrupt == MiddlewareInterrupt) {
                return interrupt;
            }
        }

        return yield* _(Effect.void);
    });

export const coreMiddlewareEffect = (position: MiddlewarePosition) =>
    Effect.provideService(
        middlewareEffect(position),
        AddressT,
        Address.local_address
    );