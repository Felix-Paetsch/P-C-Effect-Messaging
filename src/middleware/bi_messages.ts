import { Effect, Schema, Data, Context } from "effect";
import { Message, MessageT } from "../base/message";
import { Address } from "../base/address";
import { MiddlewareContinue, MiddlewareInterrupt, Middleware } from "../base/middleware";
import { v4 as uuidv4 } from 'uuid';
import { LocalComputedMessageDataT } from "../base/local_computed_message_data";
import { EnvironmentInactiveError, EnvironmentT } from "../base/environment";
import { guard_at_target } from "./guard";
import { InvalidMessageFormatError, MessageTransmissionError } from "../base/errors/message_errors";

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

export type BidirectionalMessageResult = {
    message: Message,
    respond: ResponseFunction
}

export class BidirectionalMessageResultT extends Context.Tag("BidirectionalMessageResultT")<
    BidirectionalMessageResultT,
    BidirectionalMessageResult
>() { }

export type ResponseEffect = Effect.Effect<
    Effect.Effect<Message, TimeoutError>,
    MessageTransmissionError | EnvironmentInactiveError,
    EnvironmentT
>;

export type ResponseFunction = (
    content: string,
    meta_data?: { [key: string]: any }
) => ResponseEffect;

export class ResponseFunctionT extends Context.Tag("ResponseFunctionT")<
    ResponseFunctionT,
    ResponseFunction
>() { }

const message_queue: {
    [key: string]: {
        message: Message,
        resolve: (res: Message) => void,
        reject: (error: TimeoutError) => void
    }
} = {};

export const make_message_bidirectional = (
    message: Message,
    timeout: number = 5000
): Effect.Effect<
    Effect.Effect<Message, TimeoutError>,
    never,
    EnvironmentT
> => Effect.gen(function* (_) {
    const msg_uuid = uuidv4();
    const env = yield* _(EnvironmentT);

    message.meta_data.bidirectional_message = yield* _(Schema.encode(bidirectional_message_schema)({
        source: env.ownAddress,
        target: message.target,
        msg_uuid: msg_uuid,
        timeout: timeout,
        created_at: new Date()
    }).pipe(Effect.orDie));

    return bidirectional_message_promise_as_effect(message, msg_uuid, timeout);
});

const bidirectional_message_promise_as_effect = (message: Message, msg_uuid: string, timeout: number) => {
    const prom = bidirectional_message_promise(message, msg_uuid, timeout);
    return Effect.tryPromise(() => prom).pipe(
        Effect.catchAll((error) => {
            if (error instanceof TimeoutError) {
                return Effect.fail(error);
            }
            return Effect.die(error);
        })
    );
}

const bidirectional_message_promise = (message: Message, msg_uuid: string, timeout: number) => {
    const prom = new Promise<Message>((resolve, reject) => {
        message_queue[msg_uuid] = {
            message: message,
            resolve: (res: Message) => {
                resolve(res);
                delete message_queue[msg_uuid];
            },
            reject: (error: TimeoutError) => {
                reject(error);
                delete message_queue[msg_uuid];
            }
        }
    });

    // Suppress warnings
    prom.catch(() => { });
    setTimeout(() => {
        if (message_queue[msg_uuid]) {
            message_queue[msg_uuid].reject(new TimeoutError({
                timeout: timeout,
                msg_uuid: msg_uuid
            }));
        }
    }, timeout);

    return prom;
}

export const bidirectional_middleware = (
    process_message: Effect.Effect<void, never, MessageT | ResponseFunctionT | BidirectionalMessageResultT>,
    should_process_message: Effect.Effect<boolean, never, MessageT | LocalComputedMessageDataT> = Effect.succeed(true)
) => guard_at_target(
    Effect.gen(function* (_) {
        const message = yield* _(MessageT);
        const bidirectional_message = message.meta_data.bidirectional_message;

        if (
            typeof bidirectional_message === "undefined"
            || !(yield* should_process_message)
        ) {
            return MiddlewareContinue;
        }

        const data = yield* _(Schema.decodeUnknown(bidirectional_message_schema)(bidirectional_message)).pipe(
            Effect.mapError((e) => new InvalidMessageFormatError({
                message: message,
                err: e,
                descr: "Bidirectional message meta data has wrong format."
            }))
        );

        const respond = respond_fn(data);
        const bidirectional_message_context = Context.empty().pipe(
            Context.add(BidirectionalMessageResultT, { message: message, respond: respond }),
            Context.add(ResponseFunctionT, respond)
        );

        yield* process_message.pipe(Effect.provide(bidirectional_message_context));

        if (message_queue[data.msg_uuid]) {
            message_queue[data.msg_uuid].resolve(message);
        }

        return MiddlewareInterrupt;
    }).pipe(Effect.ignore)
);

const respond_fn = (request_bidirectional_message_meta_data: typeof bidirectional_message_schema.Type): ResponseFunction => {
    return (content: string, meta_data: { [key: string]: any } = {}, new_timeout?: number): ResponseEffect => Effect.gen(function* (_) {
        const {
            source,
            target,
            msg_uuid,
            timeout,
            created_at
        } = request_bidirectional_message_meta_data;

        const res = new Message(source, content, {
            ...meta_data,
            bidirectional_message: yield* Schema.encode(bidirectional_message_schema)({
                source: target,
                target: source,
                msg_uuid: msg_uuid,
                timeout: new_timeout ?? timeout,
                created_at: created_at
            }).pipe(Effect.orDie)
        });

        const send = (yield* EnvironmentT).send;
        yield* send.pipe(Effect.provideService(MessageT, res));

        return bidirectional_message_promise_as_effect(res, msg_uuid, new_timeout ?? timeout);
    });
};

export const id_bidirectional_middleware = (
    process_message: Effect.Effect<void, never, MessageT | ResponseFunctionT | BidirectionalMessageResultT>,
    id: string
): Middleware & {
    make_message_bidirectional: (message: Message, timeout?: number) => Effect.Effect<Effect.Effect<Message, TimeoutError>, never, EnvironmentT>
} => {
    const mw = bidirectional_middleware(
        process_message,
        Effect.gen(function* (_) {
            const message = yield* _(MessageT);
            return (message.meta_data.bidirectional_message as any)?.middleware_id === id;
        })
    );

    const make_id_bidirectional_message = (message: Message, timeout?: number) => {
        const r = make_message_bidirectional(message, timeout);
        return Effect.gen(function* (_) {
            const bidirectional_message = message.meta_data.bidirectional_message;
            if (typeof bidirectional_message === "object" && bidirectional_message !== null) {
                (bidirectional_message as any).middleware_id = id;
            }
            return r;
        });
    }

    (mw as any).make_message_bidirectional = make_id_bidirectional_message;
    return mw as Middleware & {
        make_message_bidirectional: (message: Message, timeout?: number) => Effect.Effect<Effect.Effect<Message, TimeoutError>, never, EnvironmentT>
    };
}
