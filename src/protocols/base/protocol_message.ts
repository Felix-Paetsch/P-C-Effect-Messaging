import { Context, Data, Effect, Schema, Option, pipe, Layer } from "effect"
import { ChainMessageResult, ChainMessageResultT, ChainTimeout } from "../../middleware/message_chains"
import { Message } from "../../base/message";
import { MessageTransmissionError } from "../../base/errors/message_errors";
import { Environment, EnvironmentInactiveError, EnvironmentT } from "../../base/environment";
import { Json } from "../../utils/json";
import { ProtocolError, ProtocolErrorN, ProtocolErrorR, is_protocol_error } from "./protocol_errors";
import { Protocol } from "../protocol";

type ProtocolMessageRespond = (data: Json, timeout?: number, is_error?: boolean) =>
    Effect.Effect<
        Effect.Effect<ProtocolMessage, ProtocolError>,
        MessageTransmissionError | EnvironmentInactiveError | ProtocolError,
        never
    >

export type ProtocolMessage = Message & {
    readonly respond: ProtocolMessageRespond,
    readonly respond_error: (error: ProtocolErrorR) => Effect.Effect<void, never, never>,
    data: Json,
    has_responded: boolean,
    environment: Environment
}

export class ProtocolMessageT extends Context.Tag("ProtocolMessageT")<ProtocolMessageT, ProtocolMessage>() { }

const ProtocolMetaDataSchema = Schema.Struct({
    protocol_name: Schema.String,
    protocol_ident: Schema.Any,
    protocol_version: Schema.String,
    is_error: Schema.optionalWith(Schema.Boolean, {
        default: () => false
    })
});

export const ProtocolMessageFromChainMessageResult = (protocol_meta_data: typeof ProtocolMetaDataSchema.Type) => Layer.effect(
    ProtocolMessageT,
    pipe(
        ChainMessageResultT,
        Effect.andThen(result => to_protocol_message(result, protocol_meta_data))
    )
)

export function to_protocol_message(
    res: ChainMessageResult,
    protocol_meta_data: typeof ProtocolMetaDataSchema.Type
): Effect.Effect<ProtocolMessage, ProtocolError, EnvironmentT> {
    const msg = res.message;

    return Effect.gen(function* () {
        const env = yield* EnvironmentT;

        const respond: ProtocolMessageRespond = (data = "Ok", timeout?: number, is_error: boolean = false) => {
            if (unsanatizedProtocolMessage.has_responded) {
                return Effect.fail(new ProtocolErrorN({
                    message: "Message already responded",
                    Message: unsanatizedProtocolMessage
                }));
            }

            unsanatizedProtocolMessage.has_responded = true;
            return res.respond({ data }, {
                protocol: {
                    ...protocol_meta_data, is_error
                }
            }, timeout).pipe(
                Effect.map(responseEffect =>
                    responseEffect.pipe(
                        Effect.andThen(message => to_protocol_message(message, protocol_meta_data)),
                        Effect.mapError(e => {
                            if (is_protocol_error(e)) return e;
                            if (e instanceof ChainTimeout) {
                                return new ProtocolErrorN({
                                    message: "Protocol timeout",
                                    error: e
                                })
                            }
                            return new ProtocolErrorN({
                                message: "Protocol error",
                                error: e as Error
                            })
                        }),
                        Effect.provideService(EnvironmentT, env)
                    )
                ),
                Effect.provideService(EnvironmentT, env)
            )
        }

        const respond_error: ProtocolMessage["respond_error"] = (err) =>
            pipe(
                respond(err.serialize(), 0, true),
                Effect.ignore
            );

        const unsanatizedProtocolMessage: ProtocolMessage = Object.assign(msg, {
            respond,
            respond_error,
            data: {},
            has_responded: false,
            environment: env
        });

        const content = yield* msg.content.pipe(
            Effect.mapError(e => new ProtocolErrorR({
                message: "Invalid message content",
                Message: unsanatizedProtocolMessage
            }))
        );

        if (!content.hasOwnProperty('data')) {
            return yield* new ProtocolErrorR({
                message: "Message content missing 'data' attribute",
                Message: unsanatizedProtocolMessage
            });
        }

        const protocol_meta_data_result = yield* get_protocol_meta_data(msg.meta_data);
        if (Option.isNone(protocol_meta_data_result)) {
            return yield* new ProtocolErrorR({
                message: "Invalid protocol meta data",
                Message: unsanatizedProtocolMessage
            });
        }

        unsanatizedProtocolMessage.data = content.data;
        yield* ProtocolErrorN.throwIfRespondedWithError(unsanatizedProtocolMessage);

        return unsanatizedProtocolMessage;
    });
}

export const get_protocol_meta_data = (meta_data: { [key: string]: Json }) =>
    Schema.decodeUnknown(ProtocolMetaDataSchema)(meta_data.protocol).pipe(
        Effect.andThen(data => Data.struct(data)),
        Effect.option
    ) 