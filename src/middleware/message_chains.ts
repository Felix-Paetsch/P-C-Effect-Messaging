import { Effect, Schema, Data, Context, Deferred, Duration, Schedule, pipe, Console, Ref } from "effect";
import { Json, Message, MessageT } from "../base/message";
import { Address } from "../base/address";
import { Middleware, MiddlewareContinue, MiddlewareInterrupt } from "../base/middleware";
import { v4 as uuidv4 } from 'uuid';
import { LocalComputedMessageDataT } from "../base/local_computed_message_data";
import { EnvironmentInactiveError, EnvironmentT } from "../base/environment";
import { guard_at_target } from "./guard";
import { InvalidMessageFormatError, MessageTransmissionError } from "../base/errors/message_errors";

const chain_message_schema = Schema.Struct({
    current_sender: Address.AddressFromString,
    current_reciever: Address.AddressFromString,
    msg_chain_uid: Schema.String,
    current_msg_chain_length: Schema.Number,
    timeout: Schema.Number,
    created_at: Schema.DateFromNumber
});

export class ChainTimeout extends Data.TaggedError("ChainTimeout")<{
    timeout: number;
    msg_chain_uid: string;
}> { }

export type ChainMessageResult = {
    message: Message,
    respond: (
        content: { [key: string]: Json },
        meta_data?: { [key: string]: Json }
    ) => Effect.Effect<
        void,
        MessageTransmissionError | EnvironmentInactiveError,
        EnvironmentT
    >,
    requestRespond: ResponseFunction,
}

export class ChainMessageResultT extends Context.Tag("ChainMessageResultT")<
    ChainMessageResultT,
    ChainMessageResult
>() { }

export type ChainContinueEffect = Effect.Effect<
    ChainMessageResult,
    ChainTimeout | MessageTransmissionError | EnvironmentInactiveError,
    EnvironmentT
>;

export type ResponseFunction = (
    content: { [key: string]: Json },
    meta_data?: { [key: string]: Json },
    new_timeout?: number
) => ChainContinueEffect;
export class ResponseFunctionT extends Context.Tag("ResponseFunctionT")<
    ResponseFunctionT,
    ResponseFunction
>() { }

const chain_queue: {
    [key: string]: {
        last_message: Message,
        on_chain_message_result: (cmr: ChainMessageResult) => Effect.Effect<void, never, never>
    }
} = {};

export const make_message_chain = (
    message: Message,
    timeout: number = 5000
) => Effect.gen(function* () {
    const chain_uid = uuidv4();
    const env = yield* EnvironmentT;

    message.meta_data.chain_message = yield* Schema.encode(chain_message_schema)({
        current_sender: env.ownAddress,
        current_reciever: message.target,
        msg_chain_uid: chain_uid,
        current_msg_chain_length: 1,
        timeout: timeout,
        created_at: new Date()
    }).pipe(Effect.orDie);

    return yield* make_chain_message_promise(message, chain_uid, timeout);
});

function get_message_promise_key(msg_chain_uid: string, current_msg_chain_length: number, send: "send" | "recieve") {
    return `${msg_chain_uid}_${send === "send" ? current_msg_chain_length : current_msg_chain_length - 1}`;
}

const make_chain_message_promise = (message: Message, chain_uid: string, timeout: number) => Effect.gen(function* () {
    const key = get_message_promise_key(chain_uid, (message as any).meta_data?.chain_message?.current_msg_chain_length ?? 0, "send");
    const deferred = yield* Deferred.make<ChainMessageResult, never>();
    const timeout_duration = Duration.millis(timeout);
    const deferred_with_timeout = deferred.pipe(
        Effect.timeout(timeout_duration),
        Effect.mapError(() => new ChainTimeout({
            timeout: timeout,
            msg_chain_uid: chain_uid
        }))
    );

    const date = Date.now();
    chain_queue[key] = {
        last_message: message,
        on_chain_message_result: (cmr: ChainMessageResult) => {
            return pipe(
                Deferred.succeed(deferred, cmr),
                Effect.ensuring(Effect.suspend(
                    () => Effect.succeed(delete chain_queue[key])
                )),
                Effect.tap(() => Effect.gen(function* () {
                    console.log("DEFERRED SUCCEEDED", date);
                }))
            );
        }
    }

    yield* Schedule.run(
        Schedule.addDelay(Schedule.once, () => timeout_duration),
        Date.now(),
        Effect.suspend(() => Effect.succeed(delete chain_queue[key]))
    )

    return Effect.gen(function* () {
        console.log("NOW LISTENING TO", date);
        return yield* deferred_with_timeout;
    });
});

export const chain_middleware = (
    on_first_request: Effect.Effect<void, never, MessageT | ChainMessageResultT | LocalComputedMessageDataT> = Effect.void,
    process_message: Effect.Effect<void, never, MessageT | ChainMessageResultT | LocalComputedMessageDataT> = Effect.void,
    should_process_message: Effect.Effect<boolean, never, MessageT | LocalComputedMessageDataT> = Effect.succeed(true)
) => guard_at_target(
    Effect.gen(function* () {
        const message = yield* MessageT;
        const chain_message = message.meta_data.chain_message;

        if (
            typeof chain_message === "undefined"
            || !(yield* should_process_message)
        ) {
            return MiddlewareContinue;
        }

        const data = yield* Schema.decodeUnknown(chain_message_schema)(chain_message).pipe(
            Effect.mapError((e) => new InvalidMessageFormatError({
                Message: message,
                error: e,
                message: "Chain message meta data has wrong format."
            }))
        );

        const continue_chain = continue_chain_fn(data);
        const chain_message_result: ChainMessageResult = {
            message: message,
            respond: (content: { [key: string]: Json }, meta_data: { [key: string]: Json } = {}) => Effect.gen(function* () {
                const { respond } = yield* continue_chain(content, meta_data, 0);
                return yield* respond;
            }),
            requestRespond: (content: { [key: string]: Json }, meta_data: { [key: string]: Json } = {}, new_timeout?: number) => Effect.gen(function* () {
                const res = yield* continue_chain(content, meta_data, new_timeout);
                yield* Effect.fork(res.respond);
                return yield* res.await;
            })
        };

        yield* process_message.pipe(Effect.provideService(ChainMessageResultT, chain_message_result));

        const promise_key = get_message_promise_key(data.msg_chain_uid, data.current_msg_chain_length, "recieve");

        if (data.current_msg_chain_length === 1) {
            yield* on_first_request.pipe(Effect.provideService(ChainMessageResultT, chain_message_result));
        } else if (chain_queue[promise_key]) {
            yield* chain_queue[promise_key].on_chain_message_result(chain_message_result);
        }

        return MiddlewareInterrupt;
    }).pipe(Effect.ignore)
);

const continue_chain_fn = (request_chain_message_meta_data: typeof chain_message_schema.Type) => {
    return (content: { [key: string]: Json }, meta_data: { [key: string]: any } = {}, new_timeout?: number) => Effect.gen(function* () {
        const {
            current_sender,
            current_reciever,
            msg_chain_uid,
            current_msg_chain_length,
            timeout,
            created_at
        } = request_chain_message_meta_data;

        const res = new Message(current_sender, content, {
            ...meta_data,
            chain_message: yield* Schema.encode(chain_message_schema)({
                current_sender: current_reciever,
                current_reciever: current_sender,
                msg_chain_uid: msg_chain_uid,
                current_msg_chain_length: current_msg_chain_length + 1,
                timeout: new_timeout ?? timeout,
                created_at: created_at
            }).pipe(Effect.orDie)
        });

        const prom = yield* make_chain_message_promise(res, msg_chain_uid, new_timeout ?? timeout);
        const send = (yield* EnvironmentT).send;

        return {
            await: prom,
            respond: send.pipe(Effect.provideService(MessageT, res))
        };
    });
}

export const id_chain_middleware = (
    on_first_request: Effect.Effect<void, never, MessageT | ChainMessageResultT | LocalComputedMessageDataT>,
    process_message: Effect.Effect<void, never, MessageT | ChainMessageResultT | LocalComputedMessageDataT>,
    id: string
): Middleware & {
    make_message_chain: (message: Message) => Effect.Effect<Message, ChainTimeout, EnvironmentT>
} => {
    const mw = chain_middleware(
        on_first_request,
        process_message,
        Effect.gen(function* () {
            const message = yield* MessageT;
            return (message.meta_data as any).chain_message?.chain_middleware_id === id;
        })
    );

    const make_id_chain_message = (message: Message) => {
        const r = make_message_chain(message);
        const chain_message = (message.meta_data as any).chain_message;
        if (typeof chain_message === "object" && chain_message !== null) {
            chain_message.chain_middleware_id = id;
        }
        return r;
    }

    (mw as any).make_message_chain = make_id_chain_message;
    return mw as Middleware & {
        make_message_chain: (message: Message) => Effect.Effect<Message, ChainTimeout, EnvironmentT>
    };
} 