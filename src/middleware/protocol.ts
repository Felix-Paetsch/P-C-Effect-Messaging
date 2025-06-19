import { Context, Data, Effect, Schema, Equal, Option, pipe } from "effect"
import { catchAllAsMiddlewareError, Middleware } from "../base/middleware"
import { chain_middleware, ChainMessageResult, ChainMessageResultT, ChainTimeout, make_message_chain } from "./message_chains"
import { Address } from "../base/address"
import { Json, Message, MessageT } from "../base/message";
import { send } from "../base/send";
import { onErrorRetryWithOtherCommunicationChannels } from "../tools/on_message_channel_error";
import { MiddlewareError } from "../base/middleware";
import { MessageTransmissionError } from "../base/message_transmittion_error";

export class ProtocolError extends Data.TaggedError("ProtocolError")<{
    message: string;
    error: Error;
}> { }

type ProtocolMessageRespond = (data: Json, is_error?: boolean) =>
    Effect.Effect<ProtocolMessage, ProtocolError, never>
export type ProtocolMessage = Message & {
    readonly respond: ProtocolMessageRespond,
    readonly respond_error: (error: Error) => Effect.Effect<never, ProtocolError, never>,
    content: Effect.Effect<{ [key: string]: Json } & { data: Json }, never, never>
}

export class ProtocolMessageT extends Context.Tag("ProtocolMessageT")<ProtocolMessageT, ProtocolMessage>() { }

const ProtocolMetaDataSchema = Schema.Struct({
    protocol: Schema.String,
    protocol_ident: Schema.Any,
    protocol_version: Schema.String,
    is_error: Schema.optionalWith(Schema.Boolean, {
        default: () => false
    })
});

export class Protocol<SenderResult, ReceiverResult> {
    constructor(
        readonly protocol: string,
        readonly protocol_ident: Json,
        readonly protocol_version: string
    ) { }

    static not_implemented_error = new ProtocolError(
        {
            message: "Not implemented",
            error: new Error("Not implemented")
        }
    )

    static message_to_data = (msg: ProtocolMessage) => msg.content.pipe(
        Effect.andThen(content => content.data)
    );

    protected on_first_request: Effect.Effect<void, ProtocolError, ProtocolMessageT>
        = Effect.fail(Protocol.not_implemented_error)

    protected send_first_message(address: Address, data: Json, timeout: number = 5000):
        Effect.Effect<ProtocolMessage, MessageTransmissionError | ChainTimeout, never> {
        const self = this;

        return Effect.gen(function* (_) {
            const message = new Message(address, {
                data
            });

            self.set_protocol_meta_data(message)
            const responseE = make_message_chain(message, timeout)
            return yield* Effect.all([
                send.pipe(
                    Effect.provideService(
                        MessageT,
                        message
                    ),
                    onErrorRetryWithOtherCommunicationChannels
                ),
                responseE
            ]).pipe(
                Effect.andThen(([_, response]) => response),
                Effect.andThen((response) => self.to_protocol_message(response)),
                Effect.orDie
            )
        })
    }

    protected to_protocol_message(res: ChainMessageResult): Effect.Effect<ProtocolMessage, ProtocolError, never> {
        const msg = res.message;
        const self = this;

        return Effect.gen(function* (_) {
            const content = yield* msg.content.pipe(
                Effect.mapError(e => new ProtocolError({
                    message: "Invalid message content",
                    error: e
                }))
            );

            if (!content.hasOwnProperty('data')) {
                return yield* Effect.fail(new ProtocolError({
                    message: "Message content missing 'data' attribute",
                    error: new Error("Invalid message content - missing 'data' attribute")
                }));
            }

            const protocol_meta_data = yield* Protocol.get_protocol_meta_data(msg.meta_data);
            if (Option.isNone(protocol_meta_data)) {
                return yield* Effect.fail(new ProtocolError({
                    message: "Invalid protocol metadata",
                    error: new Error("Protocol metadata not found")
                }));
            }

            if (protocol_meta_data.value.is_error) {
                const errorMessage = typeof content.data === 'string'
                    ? content.data
                    : JSON.stringify(content.data);
                return yield* Effect.fail(new ProtocolError({
                    message: errorMessage,
                    error: new Error("Other side responded with error")
                }));
            }

            const respond: ProtocolMessageRespond = (data, is_error = false) => {
                return res.respond({ data }, { ...self.protocol_meta_data, is_error }).pipe(
                    Effect.andThen(message => self.to_protocol_message(message)),
                    Effect.mapError(e => {
                        if (e instanceof ProtocolError) {
                            return e;
                        }
                        if (e instanceof ChainTimeout) {
                            return new ProtocolError({
                                message: "Protocol timeout",
                                error: e
                            })
                        }
                        if (e instanceof MiddlewareError) {
                            return new ProtocolError({
                                message: "Middleware error",
                                error: e
                            })
                        }
                        return new ProtocolError({
                            message: "Protocol error",
                            error: e as Error
                        })
                    })
                )
            }

            const respond_error: ProtocolMessage["respond_error"] = (err) =>
                pipe(
                    Effect.fail(new ProtocolError({
                        message: err.message || "An error occurred",
                        error: err
                    })),
                    Effect.tapError(e => respond({
                        message: e.message || "An error occurred",
                        stack: e.stack || ""
                    }, true).pipe(Effect.ignore))
                );

            const protocolMessage: ProtocolMessage = Object.assign(msg, {
                respond,
                respond_error,
                content: Effect.succeed(content as { [key: string]: Json } & { data: Json })
            });

            return protocolMessage;
        });
    }

    protected get protocol_meta_data(): typeof ProtocolMetaDataSchema.Type {
        return Data.struct({
            protocol: this.protocol,
            protocol_ident: this.protocol_ident,
            protocol_version: this.protocol_version,
            is_error: false
        })
    }

    protected set_protocol_meta_data(message: Message) {
        message.meta_data.protocol = this.protocol_meta_data
    }

    run(address: Address, data: JSON): Effect.Effect<SenderResult, ProtocolError, never> {
        return Effect.fail(Protocol.not_implemented_error)
    }

    on(result: ReceiverResult): Effect.Effect<void, never, never> {
        return Effect.void
    }

    static get_protocol_meta_data = (meta_data: { [key: string]: Json }) =>
        Schema.decodeUnknown(ProtocolMetaDataSchema)(meta_data.protocol).pipe(
            Effect.andThen(data => Data.struct(data)),
            Effect.option
        )

    middleware(): Middleware {
        const self = this;
        const on_first_request = this.on_first_request.pipe(
            Effect.provideServiceEffect(ProtocolMessageT,
                ChainMessageResultT.pipe(
                    Effect.andThen(result => self.to_protocol_message(result))
                )
            ),
            catchAllAsMiddlewareError
        )

        return chain_middleware(
            on_first_request,
            Effect.never,
            Effect.gen(function* (_) {
                const message = yield* _(MessageT);
                const meta_data = message.meta_data;
                const protocol_meta_data = yield* Protocol.get_protocol_meta_data(meta_data);
                if (Option.isNone(protocol_meta_data)) {
                    return false
                }

                return Equal.equals(protocol_meta_data.value, self.protocol_meta_data)
            })
        )
    }
}