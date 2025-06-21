import { Effect, Schema, Option, Data, Context } from "effect";
import { Json, Message, MessageT } from "../base/message";
import { Address } from "../base/address";
import { MiddlewareContinue, MiddlewareError, MiddlewareInterrupt } from "../base/middleware";
import uuidv4, { UUID } from "../base/uuid";
import { LocalComputedMessageDataT } from "../base/local_computed_message_data";
import { EnvironmentT } from "../base/environment";

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
    respond: ResponseFunction
}

export type ChainContinueEffect = Effect.Effect<
    Effect.Effect<ChainMessageResult, ChainTimeout, EnvironmentT>,
    MiddlewareError,
    EnvironmentT
>;
export type ResponseFunction = (content: { [key: string]: Json }, meta_data: { [key: string]: any }, new_timeout?: number) => ChainContinueEffect;
export class ResponseFunctionT extends Context.Tag("ResponseFunctionT")<
    ResponseFunctionT,
    ResponseFunction
>() { }

export const make_message_chain = (
    message: Message,
    timeout: number = 5000
) => Effect.gen(function* (_) {
    const chain_uid = uuidv4();
    const env = yield* _(EnvironmentT);

    message.meta_data.chain_message = yield* _(Schema.encode(chain_message_schema)({
        current_sender: env.ownAddress,
        current_reciever: message.target,
        msg_chain_uid: chain_uid,
        current_msg_chain_length: 1,
        timeout: timeout,
        created_at: new Date()
    }).pipe(Effect.orDie));

    return chain_message_promise_as_effect(message, chain_uid, timeout);
});

export class ChainMessageResultT extends Context.Tag("ChainMessageResultT")<
    ChainMessageResultT,
    ChainMessageResult
>() { }

const chain_queue: {
    [key: string]: {
        last_message: Message,
        resolve: (res: ChainMessageResult) => void,
        reject: (error: Error) => void
    }
} = {};

const chain_message_promise_as_effect = (message: Message, chain_uid: UUID, timeout: number) => {
    const prom = chain_message_promise(message, chain_uid, timeout);
    return Effect.tryPromise(() => prom).pipe(
        Effect.mapError((error) => {
            if (error instanceof ChainTimeout) {
                return error as ChainTimeout;
            }

            return new MiddlewareError({ err: error, message });
        })
    )
}

function get_message_promise_key(msg_chain_uid: string, current_msg_chain_length: number, send: "send" | "recieve") {
    return `${msg_chain_uid}_${send === "send" ? current_msg_chain_length : current_msg_chain_length - 1}`;
}

const chain_message_promise = (message: Message, chain_uid: UUID, timeout: number) => {
    const key = get_message_promise_key(chain_uid, (message as any).meta_data?.chain_message?.current_msg_chain_length ?? 0, "send");
    const prom = new Promise<ChainMessageResult>((resolve, reject) => {
        chain_queue[key] = {
            last_message: message,
            resolve: (res: ChainMessageResult) => {
                resolve(res);
                delete chain_queue[key];
            },
            reject: (error: Error) => {
                reject(error);
                delete chain_queue[key];
            }
        }
    });

    // Supress warnings
    prom.catch(() => { });
    setTimeout(() => {
        if (chain_queue[key]) {
            chain_queue[key].reject(new ChainTimeout({
                timeout: timeout,
                msg_chain_uid: chain_uid
            }));
        }
    }, timeout);

    return prom;
}

export const chain_middleware = (
    on_first_request: Effect.Effect<void, MiddlewareError, MessageT | ResponseFunctionT | ChainMessageResultT | LocalComputedMessageDataT>,
    process_message: Effect.Effect<void, MiddlewareError, MessageT | ResponseFunctionT | ChainMessageResultT | LocalComputedMessageDataT>,
    should_process_message: Effect.Effect<boolean, MiddlewareError, MessageT | LocalComputedMessageDataT> = Effect.succeed(true)
) => Effect.gen(function* (_) {

    const message = yield* _(MessageT);
    const chain_message = message.meta_data.chain_message;
    const local_computed_message_data = yield* _(LocalComputedMessageDataT);

    if (
        typeof chain_message === "undefined"
        || !local_computed_message_data.at_target
        || !(yield* should_process_message)
    ) {
        return MiddlewareContinue;
    }


    const data = Schema.decodeUnknownOption(chain_message_schema)(chain_message);
    if (Option.isNone(data)) {
        return yield* Effect.fail(
            new MiddlewareError({
                err: new Error("Chain message meta data has wrong format."),
                message
            })
        );
    }

    const continue_chain = continue_chain_fn(message);
    const chain_message_context = Context.empty().pipe(
        Context.add(ChainMessageResultT, { message: message, respond: continue_chain }),
        Context.add(ResponseFunctionT, continue_chain)
    )

    yield* process_message.pipe(Effect.provide(chain_message_context));

    const promise_key = get_message_promise_key(data.value.msg_chain_uid, data.value.current_msg_chain_length, "recieve");
    if (data.value.current_msg_chain_length > 1 && !chain_queue[promise_key]) {
        return yield* Effect.fail(
            new MiddlewareError({
                err: new Error("Chain queue doesn't exist"),
                message
            })
        );
    } else if (data.value.current_msg_chain_length === 1) {
        yield* on_first_request.pipe(Effect.provide(chain_message_context));
    } else {
        if (chain_queue[promise_key]) {
            chain_queue[promise_key].resolve({
                message: message,
                respond: continue_chain
            });
        }
    }

    return MiddlewareInterrupt;
})

const continue_chain_fn = (message: Message): ResponseFunction => {
    return (content: { [key: string]: Json }, meta_data: { [key: string]: any } = {}, new_timeout?: number): ChainContinueEffect => Effect.gen(function* (_) {
        const chain_message = message.meta_data.chain_message;
        const data = Schema.decodeUnknownOption(chain_message_schema)(chain_message);
        if (Option.isNone(data)) {
            return yield* Effect.fail(new MiddlewareError({ err: new Error("Chain message meta data has wrong format."), message }));
        }

        const {
            current_sender,
            current_reciever,
            msg_chain_uid,
            current_msg_chain_length,
            timeout,
            created_at
        } = data.value;

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

        const send = (yield* EnvironmentT).send;
        yield* send.pipe(
            Effect.provideService(MessageT, res),
            Effect.mapError(err => new MiddlewareError({ err: new Error(err.toString()), message }))
        );

        const prom = chain_message_promise(res, msg_chain_uid as UUID, new_timeout ?? timeout);
        return Effect.tryPromise({
            try: () => prom,
            catch: () => new ChainTimeout({ timeout: new_timeout ?? timeout, msg_chain_uid: msg_chain_uid as UUID })
        })
    });
}
