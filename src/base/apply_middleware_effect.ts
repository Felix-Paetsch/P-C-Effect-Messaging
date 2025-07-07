import { Effect } from "effect";
import { AddressT } from "./address";
import { findEndpointOrFail } from "./endpoints";
import { MiddlewareInterrupt, MiddlewarePassthrough } from "./middleware";

export const applyMiddlewareEffect =
    Effect.gen(function* () {
        const address = yield* AddressT;
        const endpoint = yield* findEndpointOrFail(address);

        for (const middleware of endpoint.middlewares) {
            const interrupt = yield* middleware;
            if (interrupt == MiddlewareInterrupt) {
                return interrupt as MiddlewarePassthrough;
            }
        }

        return yield* Effect.void;
    }); 