import { Context, Data, Effect, Schema, Equal, Option, pipe, Console } from "effect"
import { Middleware } from "../base/middleware"
import { chain_middleware, ChainMessageResult, ChainMessageResultT, ChainTimeout, make_message_chain } from "../middleware/message_chains"
import { Address } from "../base/address"
import { Json, Message, MessageT } from "../base/message";
import { MessageTransmissionError } from "../base/errors/message_errors";
import { Environment, EnvironmentInactiveError, EnvironmentT } from "../base/environment";

export class ProtocolError extends Data.TaggedError("ProtocolError")<{
    message: string;
    error: Error;
}> { }

type ProtocolMessageRespond = (data: Json, is_error?: boolean) =>
    Effect.Effect<
        Effect.Effect<ProtocolMessage, ProtocolError>,
        MessageTransmissionError,
        never
    >
export type ProtocolMessage = Message & {
    readonly respond: ProtocolMessageRespond,
    readonly respond_error: (error: Error) => Effect.Effect<void, never>,
    content: Effect.Effect<{ [key: string]: Json } & { data: Json }, never, never>,
    data: Effect.Effect<Json, never, never>
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

    // Will be called if the first message reaches its target on the other side
    protected on_first_request: Effect.Effect<void, ProtocolError, ProtocolMessageT>
        = Effect.fail(Protocol.not_implemented_error)

    // Send the first message
    protected send_first_message(address: Address, data: Json, timeout: number = 5000):
        Effect.Effect<
            Effect.Effect<ProtocolMessage, ProtocolError, EnvironmentT>,
            MessageTransmissionError | ChainTimeout | EnvironmentInactiveError,
            EnvironmentT
        > {

        const self = this;

        return Effect.gen(function* (_) {
            const message = new Message(address, {
                data
            });

            self.set_protocol_meta_data(message)
            const responseE = yield* make_message_chain(message, timeout)
            const send = (yield* EnvironmentT).send;

            yield* send.pipe(
                Effect.provideService(
                    MessageT,
                    message
                )
            )

            return responseE.pipe(
                Effect.andThen((response) => self.to_protocol_message(response)),
                Effect.mapError(e => {
                    if (e instanceof ProtocolError) {
                        return e;
                    }

                    return new ProtocolError({
                        message: "Chain timeout",
                        error: e
                    })
                })
            )
        })
    }

    protected to_protocol_message(res: ChainMessageResult): Effect.Effect<ProtocolMessage, ProtocolError, EnvironmentT> {
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
                let res_message: string = "Responded with protocol error";
                if (typeof content.data === 'object') {
                    res_message = (content.data as any)?.message || "Responded with protocol error";
                    // res_stack = (content.data as any)?.stack || "";
                }

                if (typeof res_message !== "string") {
                    res_message = JSON.stringify(res_message);
                }

                return yield* Effect.fail(new ProtocolError({
                    message: res_message,
                    error: new Error("Other side responded with error")
                }));
            }

            const env = yield* _(EnvironmentT);
            const respond: ProtocolMessageRespond = (data = "Ok", is_error = false) => {
                return res.respond({ data }, {
                    protocol: {
                        ...self.protocol_meta_data, is_error
                    }
                }).pipe(
                    Effect.andThen(responseEffect =>
                        Effect.succeed(responseEffect.pipe(
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
                                return new ProtocolError({
                                    message: "Protocol error",
                                    error: e as Error
                                })
                            }),
                            Effect.provideService(EnvironmentT, env)
                        ))
                    ),
                    Effect.provideService(EnvironmentT, env)
                )
            }

            const respond_error: ProtocolMessage["respond_error"] = (err) =>
                pipe(
                    respond({
                        message: err.message || "An error occurred",
                        stack: err.stack || ""
                    }, true).pipe(Effect.ignore)
                );

            const protocolMessage = Object.assign(msg, {
                respond,
                respond_error,
                data: msg.content.pipe(Effect.orDie, Effect.andThen(content => content.data))
            });

            return protocolMessage as ProtocolMessage;
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

    /** Run the protocol	with some data */
    run(address: Address, data: Json): Effect.Effect<SenderResult, ProtocolError, EnvironmentT> {
        return Effect.fail(Protocol.not_implemented_error)
    }

    static fail_as_protocol_error = Effect.mapError(e => {
        if (e instanceof ProtocolError) {
            return e;
        }

        let message = "An error occurred";
        if (typeof (e as any)?.message === "string") {
            message = (e as any)?.message;
        }

        let error = new Error(message);
        if (e instanceof Error) {
            error = e;
        }

        return new ProtocolError({ message, error })
    })

    static fail_with_response = <A, R>(e: Effect.Effect<A, unknown, R>) => pipe(
        e,
        Protocol.fail_as_protocol_error,
        Effect.catchTag("ProtocolError", e => Effect.gen(function* (_) {
            const protocol_message = yield* _(ProtocolMessageT);
            yield* protocol_message.respond_error(e);
            return yield* Effect.fail(e);
        }))
    )

    /** Will be called on the target if the protocol finished */
    on(cb: (result: ReceiverResult) => Effect.Effect<void, never, never>): void {
        this.on_callback = cb;
    }
    protected on_callback: (result: ReceiverResult) => Effect.Effect<void, never, never> = () => Effect.void;

    static get_protocol_meta_data = (meta_data: { [key: string]: Json }) =>
        Schema.decodeUnknown(ProtocolMetaDataSchema)(meta_data.protocol).pipe(
            Effect.andThen(data => Data.struct(data)),
            Effect.option
        )

    /** The middleware to register on both sides to make this work */
    middleware(env: Environment): Effect.Effect<Middleware, never, never> {
        const self = this;
        return Effect.gen(function* (_) {
            const on_first_request = self.on_first_request.pipe(
                Effect.provideServiceEffect(ProtocolMessageT,
                    ChainMessageResultT.pipe(
                        Effect.andThen(result => self.to_protocol_message(result))
                    )
                ),
                Effect.ignore
            )

            return chain_middleware(
                on_first_request.pipe(Effect.provideService(EnvironmentT, env)),
                Effect.void,
                Effect.gen(function* (_) {
                    const message = yield* _(MessageT);
                    const meta_data = message.meta_data;
                    const protocol_meta_data = yield* Protocol.get_protocol_meta_data(meta_data);
                    if (Option.isNone(protocol_meta_data)) {
                        return false
                    }

                    return (
                        protocol_meta_data.value.protocol === self.protocol_meta_data.protocol
                        && protocol_meta_data.value.protocol_ident === self.protocol_meta_data.protocol_ident
                        && protocol_meta_data.value.protocol_version === self.protocol_meta_data.protocol_version
                    )
                })
            )
        })
    }
}