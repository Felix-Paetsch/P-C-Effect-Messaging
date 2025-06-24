import { Middleware } from "../base/middleware";
import { Effect } from "effect";
import { MessageT } from "../base/message";
import { MiddlewareContinue } from "../base/middleware";
import { LocalComputedMessageDataT } from "../base/local_computed_message_data";

export function guard_middleware(
    middleware: Middleware,
    guard: Effect.Effect<boolean, never, MessageT | LocalComputedMessageDataT>
): Middleware {
    return Effect.gen(function* (_) {
        if (yield* guard) {
            return yield* middleware;
        }
        return MiddlewareContinue;
    });
}

export function guard_incoming(middleware: Middleware): Middleware {
    return guard_middleware(
        middleware,
        Effect.gen(function* (_) {
            const { direction } = yield* _(LocalComputedMessageDataT);
            return direction == "incoming";
        })
    );
}

export function guard_outgoing(middleware: Middleware): Middleware {
    return guard_middleware(
        middleware,
        Effect.gen(function* (_) {
            const { direction } = yield* _(LocalComputedMessageDataT);
            return direction == "outgoing";
        })
    );
}

export function guard_at_target(middleware: Middleware): Middleware {
    return guard_middleware(
        middleware,
        Effect.gen(function* (_) {
            const { at_target } = yield* _(LocalComputedMessageDataT);
            return at_target;
        })
    );
}

export function guard_at_source(middleware: Middleware): Middleware {
    return guard_middleware(
        middleware,
        Effect.gen(function* (_) {
            const { at_source } = yield* _(LocalComputedMessageDataT);
            return at_source;
        })
    );
}

export function guard_at_source_or_target(middleware: Middleware): Middleware {
    return guard_middleware(
        middleware,
        Effect.gen(function* (_) {
            const { at_source, at_target } = yield* _(LocalComputedMessageDataT);
            return at_source || at_target;
        })
    );
}