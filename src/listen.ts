import { Data, Effect, Context } from "effect";
import { MessageT, SerializedMessageT } from "./message";
import { LocalComputedMessageDataT } from "./local_computed_message_data";

export class CallbackRegistrationError extends Data.TaggedError("RegisterChannelError")<{
    err: Error;
}> { }

class ListenerNotFoundError extends Data.TaggedError("ListenerNotFoundError")<{}> { }

export type ListenerEffect = Effect.Effect<never, never, MessageT | LocalComputedMessageDataT>
export class ListenerT extends Context.Tag("ListenerT")<ListenerT, {
    listen: ListenerEffect,
    remove_cb?: (remove_effect: Effect.Effect<never, ListenerNotFoundError, never>) => void;
}>() { }

const registered_listeners: ListenerEffect[] = [];

const removeListenerEffect = (listener: ListenerEffect) => Effect.gen(function* (_) {
    const index = registered_listeners.indexOf(listener);
    if (index == -1) {
        return yield* _(Effect.fail(new ListenerNotFoundError()));
    }
    registered_listeners.splice(index, 1);
    return yield* Effect.never;
});

export const listen = Effect.gen(function* (_) {
    const { listen, remove_cb } = yield* _(ListenerT);

    registered_listeners.push(listen);
    const remove_effect = removeListenerEffect(listen);

    if (typeof remove_cb == "function") {
        yield* Effect.try(() => {
            return remove_cb(remove_effect)
        }).pipe(Effect.catchAll(e => {
            const err = e instanceof Error ? e : new Error("Couldn't register remove callback");
            return remove_effect.pipe(
                Effect.andThen(Effect.fail(new CallbackRegistrationError({ err }))),
                Effect.catchTag(
                    "ListenerNotFoundError",
                    () => Effect.never // If it is not there for some reason, we are good
                )
            )
        }));
    }

    return yield* _(Effect.never);
});

export const applyListeners = Effect.gen(function* (_) {
    for (const listener of registered_listeners) {
        yield* _(listener);
    }
    return yield* Effect.never;
});

// ============

export class RecieveError extends Data.TaggedError("RecieveError")<{
    err: Error;
}> { }

export class RecieveErrorT extends Context.Tag("RecieveErrorT")<RecieveErrorT, RecieveError>() { }

export type ErrorListenEffect = Effect.Effect<never, never, SerializedMessageT | RecieveErrorT>;
export class ErrorListenerT extends Context.Tag("ErrorListenerT")<ErrorListenerT, {
    listen: ErrorListenEffect,
    remove_cb?: (remove_effect: Effect.Effect<never, ListenerNotFoundError, never>) => void;
}>() { }

const registered_error_listeners: ErrorListenEffect[] = [];

const removeErrorListenerEffect = (listener: ErrorListenEffect) => Effect.gen(function* (_) {
    const index = registered_error_listeners.indexOf(listener);
    if (index == -1) {
        return yield* _(Effect.fail(new ListenerNotFoundError()));
    }
    registered_error_listeners.splice(index, 1);
    return yield* Effect.never;
});

export const listenRecieveError = Effect.gen(function* (_) {
    const { listen, remove_cb } = yield* _(ErrorListenerT);

    registered_error_listeners.push(listen);
    const remove_effect = removeErrorListenerEffect(listen);

    if (typeof remove_cb == "function") {
        yield* Effect.try(() => {
            return remove_cb(remove_effect)
        }).pipe(Effect.catchAll(e => {
            const err = e instanceof Error ? e : new Error("Couldn't register remove callback");
            return remove_effect.pipe(
                Effect.andThen(Effect.fail(new CallbackRegistrationError({ err }))),
                Effect.catchTag(
                    "ListenerNotFoundError",
                    () => Effect.never // If it is not there for some reason, we are good
                )
            )
        }));
    }

    return yield* _(Effect.never);
});

export const applyRecieveErrorListeners = (e: Error) => Effect.gen(function* (_) {
    for (const listener of registered_error_listeners) {
        yield* _(listener);
    }
    return yield* Effect.never;
}).pipe(
    Effect.provideService(RecieveErrorT, new RecieveError({ err: e }))
);
