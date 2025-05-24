import { Effect, Context, Data, Option, Equal } from "effect";
import { Address, AddressT } from "./address";
import { findOrCreateEndpoint } from "./endpoints";
import { MessageT } from "./message";
import { LocalComputedMessageDataT } from "./local_computed_message_data";

class MiddlewareError extends Data.TaggedError("MiddlewareError")<{ err: Error }> { }

type Middleware = Effect.Effect<never, MiddlewareError, MessageT | LocalComputedMessageDataT>;
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

    return yield* _(Effect.never);
});

export const middlewareEffect = (position: MiddlewarePosition) =>
    Effect.gen(function* (_) {
        const { address } = yield* _(AddressT);
        const endpoint = findOrCreateEndpoint(address);

        const relevant_middleware = endpoint.middlewares.filter(
            m => m.position == position || m.position == "ALL"
        ).map(m => m.middleware);

        for (const middleware of relevant_middleware) {
            yield* _(middleware);
        }

        return yield* _(Effect.never);
    });

export const coreMiddlewareEffect = (position: MiddlewarePosition) =>
    Effect.provideService(
        middlewareEffect(position),
        AddressT,
        { address: Address.local_address() }
    );