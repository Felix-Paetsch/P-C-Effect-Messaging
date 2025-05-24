import { Effect, Context, Data } from "effect";
import { Address, AddressT } from "./address";
import { findOrCreateEndpoint } from "./endpoints";
import { MessageT } from "./message";

class MiddlewareError extends Data.TaggedError("MiddlewareError")<{ err: Error }> { }

type Middleware = Effect.Effect<never, MiddlewareError, MessageT | LocalComputedMessageDataT>;
class MiddlewareT extends Context.Tag("MiddlewareT")<MiddlewareT, {
    middleware: Middleware;
}>() { }

export type MiddlewarePosition = "MSG_IN" | "MSG_OUT" | "ALL";
export class MiddlewarePositionT extends Context.Tag("MiddlewarePositionT")<MiddlewarePositionT, {
    position: MiddlewarePosition;
}>() { }
export type RegisteredMiddleware = {
    position: MiddlewarePosition;
    middleware: Middleware;
};

export const useMiddleware = Effect.gen(function* (_) {
    const { middleware } = yield* _(MiddlewareT);
    const { address } = yield* _(AddressT);
    const { position } = yield* _(MiddlewarePositionT);

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

export type LocalComputedMessageData = {
    direction: "incomming" | "outgoing";
    is_bridge: boolean;
}

export class LocalComputedMessageDataT extends Context.Tag("LocalComputedMessageDataT")<
    LocalComputedMessageDataT,
    LocalComputedMessageData
>() { }

export const computeLocalMessageData = Effect.gen(function* (_) {
    const { msg } = yield* _(MessageT);
    return {
        direction: "outgoing",
        is_bridge: false
    } as LocalComputedMessageData;
})
