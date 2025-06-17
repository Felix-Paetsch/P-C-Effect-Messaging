import { Effect, Schema, Option, Data, Context } from "effect";
import { Message, MessageT } from "../base/message";
import { Address } from "../base/address";
import { MiddlewareContinue, MiddlewareError, MiddlewareInterrupt } from "../base/middleware";
import { send } from "../base/send";
import uuidv4, { UUID } from "../base/uuid";
import { LocalComputedMessageDataT } from "../base/local_computed_message_data";

const bidirectional_message_schema = Schema.Struct({
    source: Address.AddressFromString,
    target: Address.AddressFromString,
    msg_uuid: Schema.String,
    timeout: Schema.Number,
    created_at: Schema.DateFromNumber
});

export class TimeoutError extends Data.TaggedError("TimeoutError")<{
    timeout: number;
    msg_uuid: string;
}> { }

export type ResponseEffect = Effect.Effect<void, MiddlewareError, void>;

export type ResponseFunction = (content: string, meta_data?: { [key: string]: any }) => ResponseEffect;
export class ResponseFunctionT extends Context.Tag("ResponseFunctionT")<
    ResponseFunctionT,
    ResponseFunction
>() { }

export const make_message_bidirectional = (
    message: Message,
    timeout: number = 5000
) => Effect.gen(function* (_) {
    const msg_uuid = uuidv4();

    message.meta_data.bidirectional_message = yield* _(Schema.encode(bidirectional_message_schema)({
        source: Address.local_address,
        target: message.target,
        msg_uuid: msg_uuid,
        timeout: timeout,
        created_at: new Date()
    }).pipe(Effect.orDie));

    return yield* bidirectional_message_promise_as_effect(message, msg_uuid, timeout);
});

const message_queue: {
    [key: UUID]: {
        message: Message,
        resolve: (message: Message) => void,
        reject: (error: Error) => void
    }
} = {};

const bidirectional_message_promise_as_effect = (message: Message, msg_uuid: UUID, timeout: number) =>
    Effect.tryPromise(() => bidirectional_message_promise(message, msg_uuid, timeout)).pipe(
        Effect.mapError((error) => {
            if (error instanceof TimeoutError) {
                return error as TimeoutError;
            }

            return new MiddlewareError({ err: error, message });
        })
    )

const bidirectional_message_promise = (message: Message, msg_uuid: UUID, timeout: number) => {
    return new Promise<Message>((resolve, reject) => {
        message_queue[msg_uuid] = {
            message: message,
            resolve: (ret_msg: Message) => {
                resolve(ret_msg);
                delete message_queue[msg_uuid];
            },
            reject: (error: Error) => {
                reject(error);
                delete message_queue[msg_uuid];
            }
        }

        setTimeout(() => {
            if (message_queue[msg_uuid]) {
                message_queue[msg_uuid].reject(new TimeoutError({
                    timeout: timeout,
                    msg_uuid: msg_uuid
                }));
            }
        }, timeout);
    });
}

export const bidirectional_middleware = (
    process_message: Effect.Effect<void, MiddlewareError, MessageT | ResponseFunctionT>,
    should_process_message: Effect.Effect<boolean, MiddlewareError, void> = Effect.succeed(true)
) => Effect.gen(function* (_) {
    const message = yield* _(MessageT);
    const bidirectional_message = message.meta_data.bidirectional_message;
    const local_computed_message_data = yield* _(LocalComputedMessageDataT);

    if (
        typeof bidirectional_message === "undefined"
        || !local_computed_message_data.at_target
        || !(yield* should_process_message)
    ) {
        return MiddlewareContinue;
    }

    const data = Schema.decodeUnknownOption(bidirectional_message_schema)(bidirectional_message);
    if (Option.isNone(data)) {
        return yield* Effect.fail(
            new MiddlewareError({
                err: new Error("Bidirectional message meta data has wrong format."),
                message
            })
        );
    }

    const respond = respond_fn(message);

    yield* process_message.pipe(Effect.provideService(
        ResponseFunctionT,
        respond
    ));

    if (message_queue[data.value.msg_uuid as UUID]) {
        message_queue[data.value.msg_uuid as UUID].resolve(message);
    }

    return MiddlewareInterrupt;
}).pipe(Effect.catchAll(e => Effect.gen(function* (_) {
    const message = yield* _(MessageT);
    const bidirectionalMessage = message.meta_data.bidirectional_message;
    if (
        typeof bidirectionalMessage === "object"
        && bidirectionalMessage !== null
        && "msg_uuid" in bidirectionalMessage
        && typeof bidirectionalMessage.msg_uuid === "string"
    ) {
        const uuid = bidirectionalMessage.msg_uuid as UUID;
        if (message_queue[uuid]) {
            message_queue[uuid].reject(e);
        }
    }
    return yield* Effect.fail(e);
})));

const respond_fn = (message: Message): ResponseFunction => {
    return (content: string, meta_data: { [key: string]: any } = {}): ResponseEffect => Effect.gen(function* (_) {
        const bidirectional_message = message.meta_data.bidirectional_message;
        const data = Schema.decodeUnknownOption(bidirectional_message_schema)(bidirectional_message);
        if (Option.isNone(data)) {
            return yield* Effect.fail(new MiddlewareError({ err: new Error("Bidirectional message meta data has wrong format."), message }));
        }

        const {
            source,
            target,
            msg_uuid,
            timeout,
            created_at
        } = data.value;


        const res = new Message(source, content, {
            ...meta_data,
            bidirectional_message: yield* Schema.encode(bidirectional_message_schema)({
                source: target,
                target: source,
                msg_uuid: msg_uuid,
                timeout: timeout,
                created_at: created_at
            }).pipe(Effect.orDie)
        });
        return yield* send.pipe(Effect.provideService(MessageT, res));
    }).pipe(Effect.catchAll(e => {
        if (e instanceof MiddlewareError) {
            return Effect.fail(e);
        }

        return Effect.fail(new MiddlewareError({ err: e, message }));
    }));
};
