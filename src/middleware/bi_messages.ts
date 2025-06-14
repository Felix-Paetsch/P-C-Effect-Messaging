import { Effect, Schema, Option, Equal, Data } from "effect";
import { Message, MessageT } from "../base/message";
import { Address } from "../base/address";
import { Middleware, MiddlewareError, MiddlewareInterrupt, MiddlewarePassthrough } from "../base/middleware";
import { send } from "../base/send";
import uuidv4, { UUID } from "../base/uuid";
import { LocalComputedMessageDataT } from "../base/local_computed_message_data";
import { applyRecieveErrorListeners } from "../base/listen";

const bidirectional_message_schema = Schema.Struct({
    source: Address.AddressFromString,
    msg_uuid: Schema.String,
    timeout: Schema.Number,
    created_at: Schema.Date,
    responding: Schema.Boolean
});

export class TimeoutError extends Data.TaggedError("TimeoutError")<{
    message: Message;
    timeout: number;
}> { }
export class AlreadyRespondedError extends Data.TaggedError("AlreadyRespondedError")<{
    message: Message;
}> { }


export type ResponseEffect = Effect.Effect<MiddlewarePassthrough, MiddlewareError, void>;
export const make_message_bidirectional = (message: Message, timeout: number = 5000) => {
    const uuid = uuidv4();
    message.meta_data.bidirectional_message = {
        source: Address.local_address().serialize(),
        msg_uuid: uuidv4(),
        timeout: timeout,
        created_at: new Date(),
        responding: false
    };

    const promise = bidirectional_message_promise(message, uuid, timeout);
    return Effect.tryPromise({
        try: () => promise,
        catch: (e) => {
            if (e instanceof TimeoutError) {
                return e;
            }

            return new MiddlewareError({ err: new Error("Bidirectional message failed.") });
        }
    });
}

const message_queue: {
    [key: UUID]: {
        message: Message,
        resolve: (message: Message) => void,
        reject: (error: Error) => void
    }
} = {};

const bidirectional_message_promise = (message: Message, uuid: UUID, timeout: number) => {
    return new Promise<Message>((resolve, reject) => {
        message_queue[uuid] = {
            message: message,
            resolve: (message: Message) => {
                resolve(message);
                delete message_queue[uuid];
            },
            reject: (error: Error) => {
                reject(error);
                delete message_queue[uuid];
            }
        }

        setTimeout(() => {
            if (message_queue[uuid]) {
                message_queue[uuid].reject(new TimeoutError({
                    message: message,
                    timeout: timeout
                }));
            }
        }, timeout);
    });
}

export const bidirectional_middleware = (middleware: Middleware[] = []) => Effect.gen(function* (_) {
    const message = yield* _(MessageT);
    const bidirectional_message = message.meta_data.bidirectional_message;

    if (
        typeof bidirectional_message === "undefined" || !Equal.equals(message.target, Address.local_address())
    ) {
        return yield* Effect.void;
    }

    const data = Schema.decodeUnknownOption(bidirectional_message_schema)(bidirectional_message);
    if (Option.isNone(data)) {
        return yield* Effect.fail(
            new MiddlewareError({ err: new Error("Bidirectional message meta data has wrong format.") })
        );
    }

    const {
        responding,
        msg_uuid
    } = data.value;

    const uuid = msg_uuid as UUID;

    // We are at the target and haven't responded yet
    if (!responding) {
        const computed_message_data = yield* _(LocalComputedMessageDataT);
        computed_message_data.bidirectional_message_respond = respond_fn(message);
    }

    if (responding && !message_queue[uuid]) {
        return yield* applyRecieveErrorListeners(new AlreadyRespondedError({ message }));
    }

    for (const m of middleware) {
        const r = yield* m;
        if (r === MiddlewareInterrupt) {
            if (message_queue[uuid]) {
                message_queue[uuid].resolve(message);
            }
            return MiddlewareInterrupt as MiddlewarePassthrough;
        }
    }

    if (message_queue[uuid]) {
        message_queue[uuid].resolve(message);
    }
    return yield* Effect.void;
}).pipe(Effect.catchAll(e => Effect.gen(function* (_) {
    const message = yield* _(MessageT);
    const uuid = message.meta_data.bidirectional_message.msg_uuid as UUID;
    if (message_queue[uuid]) {
        message_queue[uuid].reject(e);
    }
    return yield* Effect.fail(e);
})));

const respond_fn = (message: Message) => {
    return (content: string, meta_data: { [key: string]: any } = {}): ResponseEffect => Effect.gen(function* (_) {
        const bidirectional_message = message.meta_data.bidirectional_message;
        const data = Schema.decodeOption(bidirectional_message_schema)(bidirectional_message);
        if (Option.isNone(data)) {
            return yield* Effect.fail(new MiddlewareError({ err: new Error("Bidirectional message meta data has wrong format.") }));
        }

        const {
            source,
            responding
        } = data.value;

        if (responding) {
            return yield* Effect.fail(new AlreadyRespondedError({ message }));
        }

        const res = new Message(source, content, meta_data);
        res.meta_data.bidirectional_message.responding = true;
        return yield* send.pipe(Effect.provideService(MessageT, res));
    }).pipe(Effect.catchAll(e => {
        if (e instanceof MiddlewareError) {
            return Effect.fail(e);
        }

        return Effect.fail(new MiddlewareError({ err: e }));
    }));
};
