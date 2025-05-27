import { Data, Effect, Context, Option } from "effect";
import { Message, MessageT, SerializedMessage, SerializedMessageT } from "./message";
import { LocalComputedMessageDataT } from "./local_computed_message_data";

export class CallbackRegistrationError extends Data.TaggedError("RegisterChannelError")<{
    err: Error;
}> { }

class ListenerNotFoundError extends Data.TaggedError("ListenerNotFoundError")<{}> { }

export type ListenerEffect = Effect.Effect<void, never, MessageT | LocalComputedMessageDataT>
export class ListenerT extends Context.Tag("ListenerT")<ListenerT, {
    listen: ListenerEffect,
    remove_cb?: (remove_effect: Effect.Effect<void, ListenerNotFoundError, void>) => void;
}>() { }

const registered_listeners: ListenerEffect[] = [];

const removeListenerEffect = (listener: ListenerEffect) => Effect.gen(function* (_) {
    const index = registered_listeners.indexOf(listener);
    if (index == -1) {
        return yield* _(Effect.fail(new ListenerNotFoundError()));
    }
    registered_listeners.splice(index, 1);
    return yield* Effect.void;
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
            return Effect.all([
                remove_effect,
                Effect.fail(new CallbackRegistrationError({ err })),
            ]).pipe(Effect.catchTag(
                "ListenerNotFoundError",
                () => Effect.void // If it is not there for some reason, we are good
            ))
        }));
    }

    return yield* _(Effect.void);
});

export const applyListeners = Effect.gen(function* (_) {
    for (const listener of registered_listeners) {
        yield* _(listener);
    }
    return yield* Effect.void;
});

// ============

export class RecieveError extends Data.TaggedError("RecieveError")<{
    err: Error;
}> { }

export class RecieveErrorT extends Context.Tag("RecieveErrorT")<RecieveErrorT, {
    RecieveError: RecieveError;
    SerializedMessage: SerializedMessage | null;
    Message: Message | null;
}>() { }

export type ErrorListenEffect = Effect.Effect<void, void, RecieveErrorT>;
export class ErrorListenerT extends Context.Tag("ErrorListenerT")<ErrorListenerT, {
    listen: ErrorListenEffect,
    remove_cb?: (remove_effect: Effect.Effect<void, ListenerNotFoundError, void>) => void;
}>() { }

const registered_error_listeners: ErrorListenEffect[] = [];

const removeErrorListenerEffect = (listener: ErrorListenEffect) => Effect.gen(function* (_) {
    const index = registered_error_listeners.indexOf(listener);
    if (index == -1) {
        return yield* _(Effect.fail(new ListenerNotFoundError()));
    }
    registered_error_listeners.splice(index, 1);
    return yield* Effect.void;
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
            return Effect.all([
                remove_effect,
                Effect.fail(new CallbackRegistrationError({ err })),
            ]).pipe(Effect.catchTag(
                "ListenerNotFoundError",
                () => Effect.void // If it is not there for some reason, we are good
            )
            )
        }));
    }

    return yield* _(Effect.void);
});

export const applyRecieveErrorListeners = (e: Error) => Effect.gen(function* (_) {
    for (const listener of registered_error_listeners) {
        yield* _(listener);
    }
    return yield* Effect.void;
}).pipe(
    Effect.provideServiceEffect(RecieveErrorT, Effect.gen(function* (_) {
        const msgO = yield* Effect.serviceOption(MessageT)
        const msg = Option.isNone(msgO) ? null : msgO.value;

        const serialized_msgO = yield* Effect.serviceOption(SerializedMessageT)
        const serialized_msg = Option.isNone(serialized_msgO) ? null : serialized_msgO.value;

        return {
            RecieveError: new RecieveError({ err: e }),
            SerializedMessage: serialized_msg,
            Message: msg
        }
    })),
);
