import { Effect } from "effect";
import { AddressT } from "./address";
import { findEndpoint } from "./endpoints";
import { MiddlewareInterrupt } from "./middleware";

export const applyMiddlewareEffect =
    Effect.gen(function* (_) {
        const address = yield* _(AddressT);
        const endpoint = yield* _(findEndpoint(address));

        for (const middleware of endpoint.middlewares) {
            const interrupt = yield* _(middleware);
            if (interrupt == MiddlewareInterrupt) {
                return interrupt;
            }
        }

        return yield* _(Effect.void);
    }); 