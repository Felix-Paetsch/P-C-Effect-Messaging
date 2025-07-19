import { Effect, Schema } from "effect";
import { Address } from "../base/address";
import { KernelEnv } from "../base/kernel_environment";
import { LocalComputedMessageDataT } from "../base/local_computed_message_data";
import { Message, MessageT } from "../base/message";
import { Middleware, MiddlewareContinue } from "../base/middleware";
import { guard_at_target } from "./guard";

const isNoLoggingMessage: Effect.Effect<boolean, never, MessageT> = Effect.gen(function* () {
    const msg = yield* MessageT;
    return !msg.meta_data.message_logging;
})

export function log_messages(
    log_message: Effect.Effect<void, never, MessageT | LocalComputedMessageDataT>,
    should_log: Effect.Effect<boolean, never, MessageT | LocalComputedMessageDataT> = Effect.succeed(true)
): Middleware {
    return Effect.gen(function* () {
        const b1 = yield* isNoLoggingMessage;
        const b2 = yield* should_log;
        if (b1 && b2) {
            yield* log_message;
        }
        return MiddlewareContinue;
    })
}

export function log_to_address(address: Address): Effect.Effect<void, never, MessageT> {
    return Effect.gen(function* () {
        const message = yield* MessageT;
        const logMessage = new Message(address, {
            type: "Logging Message",
            serialized_message: message.serialize()
        }, {
            message_logging: {
                source_address: message.target.serialize()
            }
        });

        yield* KernelEnv.send.pipe(
            Effect.provideService(
                MessageT,
                logMessage
            )
        ).pipe(Effect.ignore);
    })
}

export function recieveMessageLogs(cb: Effect.Effect<void, never, MessageT>): Middleware {
    return guard_at_target(
        Effect.gen(function* () {
            const message = yield* MessageT;
            if (message.meta_data.message_logging) {
                const content = yield* message.content;
                const to_log = yield* Schema.decodeUnknown(Message.MessageFromString)(content.serialized_message);
                yield* cb.pipe(
                    Effect.provideService(
                        MessageT,
                        to_log
                    )
                );
            }
            return MiddlewareContinue;
        }).pipe(Effect.ignore)
    );
}