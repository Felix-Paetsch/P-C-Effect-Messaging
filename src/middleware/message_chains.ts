import { Effect, Schema, Option, Data, Context } from "effect";
import { Message, MessageT } from "../base/message";
import { Address } from "../base/address";
import { MiddlewareContinue, MiddlewareError, MiddlewareInterrupt } from "../base/middleware";
import { send } from "../base/send";
import uuidv4, { UUID } from "../base/uuid";
import { LocalComputedMessageDataT } from "../base/local_computed_message_data";

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

export type ChainContinueEffect = Effect.Effect<void, MiddlewareError, void>;

export type ResponseFunction = (content: string, meta_data: { [key: string]: any }, new_timeout?: number) => void;
export class ResponseFunctionT extends Context.Tag("ResponseFunctionT")<
    ResponseFunctionT,
    ResponseFunction
>() { }

export const make_message_chain = (
    message: Message,
    timeout: number = 5000
) => Effect.gen(function* (_) {
    const chain_uid = uuidv4();

    message.meta_data.chain_message = yield* _(Schema.encode(chain_message_schema)({
        current_sender: Address.local_address,
        current_reciever: message.target,
        msg_chain_uid: chain_uid,
        current_msg_chain_length: 1,
        timeout: timeout,
        created_at: new Date()
    }).pipe(Effect.orDie));

    return yield* chain_message_promise_as_effect(message, chain_uid, timeout);
});

const chain_queue: {
    [key: UUID]: {
        last_message: Message,
        resolve: (message: Message) => void,
        reject: (error: Error) => void
    }
} = {};

const chain_message_promise_as_effect = (message: Message, chain_uid: UUID, timeout: number) =>
    Effect.tryPromise(() => chain_message_promise(message, chain_uid, timeout)).pipe(
        Effect.mapError((error) => {
            if (error instanceof ChainTimeout) {
                return error as ChainTimeout;
            }

            return new MiddlewareError({ err: error, message });
        })
    )

const chain_message_promise = (message: Message, chain_uid: UUID, timeout: number) => {
    return new Promise<Message>((resolve, reject) => {
        chain_queue[chain_uid] = {
            last_message: message,
            resolve: (ret_msg: Message) => {
                resolve(ret_msg);
                delete chain_queue[chain_uid];
            },
            reject: (error: Error) => {
                reject(error);
                delete chain_queue[chain_uid];
            }
        }

        setTimeout(() => {
            if (chain_queue[chain_uid]) {
                chain_queue[chain_uid].reject(new ChainTimeout({
                    timeout: timeout,
                    msg_chain_uid: chain_uid
                }));
            }
        }, timeout);
    });
}

export const chain_middleware = (
    on_first_request: Effect.Effect<void, MiddlewareError, MessageT | ResponseFunctionT>,
    process_message: Effect.Effect<void, MiddlewareError, MessageT | ResponseFunctionT>,
    should_process_message: Effect.Effect<boolean, MiddlewareError, void> = Effect.succeed(true)
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

    yield* process_message.pipe(Effect.provideService(
        ResponseFunctionT,
        continue_chain
    ));

    if (data.value.current_msg_chain_length > 1 && !chain_queue[data.value.msg_chain_uid as UUID]) {
        return yield* Effect.fail(
            new MiddlewareError({
                err: new Error("Chain queue doesn't exist"),
                message
            })
        );
    } else if (chain_queue[data.value.msg_chain_uid as UUID]) {
        chain_queue[data.value.msg_chain_uid as UUID].resolve(message);
    } else if (data.value.current_msg_chain_length === 1) {
        yield* on_first_request.pipe(Effect.provideService(
            ResponseFunctionT,
            continue_chain
        ));
    }

    return MiddlewareInterrupt;
}).pipe(Effect.catchAll(e => Effect.gen(function* (_) {
    const message = yield* _(MessageT);
    const chainMessage = message.meta_data.chain_message;
    if (
        typeof chainMessage === "object"
        && chainMessage !== null
        && "msg_chain_uid" in chainMessage
        && typeof chainMessage.msg_chain_uid === "string"
    ) {
        const uuid = chainMessage.msg_chain_uid as UUID;
        if (chain_queue[uuid]) {
            chain_queue[uuid].reject(e);
        }
    }
    return yield* Effect.fail(e);
})));

const continue_chain_fn = (message: Message): ResponseFunction => {
    return (content: string, meta_data: { [key: string]: any } = {}, new_timeout?: number): ChainContinueEffect => Effect.gen(function* (_) {
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
        return yield* send.pipe(Effect.provideService(MessageT, res));
    }).pipe(Effect.catchAll(e => {
        if (e instanceof MiddlewareError) {
            return Effect.fail(e);
        }

        return Effect.fail(new MiddlewareError({ err: e, message }));
    }));
};
