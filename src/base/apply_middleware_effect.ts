import { Effect } from "effect";
import { AddressT } from "./address";
import { findEndpointOrFail } from "./endpoints";
import { MiddlewareInterrupt, MiddlewarePassthrough } from "./middleware";

export const applyMiddlewareEffect =
    Effect.gen(function* (_) {
        const address = yield* _(AddressT);
        const endpoint = yield* _(findEndpointOrFail(address));

        for (const middleware of endpoint.middlewares) {
            const interrupt = yield* _(middleware);
            if (interrupt == MiddlewareInterrupt) {
                return interrupt as MiddlewarePassthrough;
            }
        }

        return yield* _(Effect.void);
    }); 