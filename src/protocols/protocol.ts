import { Context, Data, Effect, Schema, Option, pipe } from "effect"
import { Middleware } from "../base/middleware"
import { chain_middleware, ChainMessageResult, ChainMessageResultT, ChainTimeout, make_message_chain } from "../middleware/message_chains"
import { Address } from "../base/address"
import { Json, Message, MessageT } from "../base/message";
import { MessageTransmissionError } from "../base/errors/message_errors";
import { Environment, EnvironmentInactiveError, EnvironmentT } from "../base/environment";

export class ProtocolErrorN extends Data.TaggedError("ProtocolError")<{
    message: string;
    error?: Error;
    data?: Json;
    protocol_message?: ProtocolMessage;
}> {
    serialize() {
        return Schema.encodeSync(ProtocolErrorN.ProtocolErrorFromJson)(this);
    }

    to_protocolErrorR(protocol_message: ProtocolMessage) {
        return new ProtocolErrorR({
            message: this.message,
            error: this.error,
            data: this.data,
            protocol_message
        })
    }

    static ProtocolErrorFromJson = Schema.transform(
        Schema.Struct({
            message: Schema.String,
            data: Schema.optionalWith(Schema.Any, { default: () => null })
        }),
        Schema.instanceOf(ProtocolErrorN), {
        decode: (serialized) =>
            new ProtocolErrorN({
                message: serialized.message,
                data: serialized.data as Json
            }),
        encode: (msg: ProtocolErrorN) =>
        ({
            message: msg.message,
            data: msg.data || null
        })
    });

    static throwIfRespondedWithError = Effect.gen(function* (_) {
        const protocol_message = yield* _(ProtocolMessageT);
        if (!(protocol_message.meta_data.protocol as any).is_error) {
            return yield* Effect.void;
        }

        return yield* Schema.decodeUnknown(ProtocolErrorN.ProtocolErrorFromJson)(protocol_message.data).pipe(
            Effect.catchAll(e => Effect.fail(new ProtocolErrorN({
                message: "Invalid response error format",
                error: e
            }))),
            Effect.andThen(e => Effect.fail(e))
        )
    })
}

export class ProtocolErrorR extends ProtocolErrorN {
    constructor(args: {
        message: string,
        data?: Json,
        error?: Error,
        protocol_message: ProtocolMessage
    }) {
        super(args);
        if (this.error instanceof ProtocolErrorR) {
            return;
        }
        this.protocol_message!.respond_error(this);
    }

    to_protocolErrorR() {
        return this;
    }
}

export type ProtocolError = ProtocolErrorR | ProtocolErrorN
export function is_protocol_error(e: any): e is ProtocolError {
    return e instanceof ProtocolErrorN
}

type ProtocolMessageRespond = (data: Json, is_error?: boolean) =>
    Effect.Effect<
        Effect.Effect<ProtocolMessage, ProtocolError>,
        MessageTransmissionError | EnvironmentInactiveError,
        never
    >

export type ProtocolMessage = Message & {
    readonly respond: ProtocolMessageRespond,
    readonly respond_error: (error: ProtocolErrorR) => void,
    data: Json
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

    static not_implemented_error = Effect.gen(function* (_) {
        const message = yield* _(ProtocolMessageT);
        return yield* Effect.fail(new ProtocolErrorR(
            {
                message: "Not implemented",
                data: {},
                protocol_message: message
            }
        ))
    })

    // Will be called if the first message reaches its target on the other side
    protected on_first_request: Effect.Effect<void, ProtocolError, ProtocolMessageT>
        = Protocol.not_implemented_error

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
                    if (is_protocol_error(e)) {
                        return e;
                    }

                    return new ProtocolErrorN({
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
                        ))
                    ),
                    Effect.provideService(EnvironmentT, env)
                )
            }

            const respond_error: ProtocolMessage["respond_error"] = (err) =>
                pipe(
                    respond(err.serialize(), true),
                    Effect.ignore,
                    Effect.runPromise
                );

            const unsanatizedProtocolMessage: ProtocolMessage = Object.assign(msg, {
                respond,
                respond_error,
                data: {}
            });

            const content = yield* msg.content.pipe(
                Effect.mapError(e => new ProtocolErrorR({
                    message: "Invalid message content",
                    protocol_message: unsanatizedProtocolMessage
                }))
            );

            if (!content.hasOwnProperty('data')) {
                return yield* Effect.fail(new ProtocolErrorR({
                    message: "Message content missing 'data' attribute",
                    protocol_message: unsanatizedProtocolMessage
                }));
            }

            const protocol_meta_data = yield* Protocol.get_protocol_meta_data(msg.meta_data);
            if (Option.isNone(protocol_meta_data)) {
                return yield* Effect.fail(new ProtocolErrorR({
                    message: "Invalid protocol meta data",
                    protocol_message: unsanatizedProtocolMessage
                }));
            }

            unsanatizedProtocolMessage.data = content.data;

            yield* ProtocolErrorN.throwIfRespondedWithError.pipe(
                Effect.provideService(ProtocolMessageT, unsanatizedProtocolMessage)
            );

            return unsanatizedProtocolMessage;
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
        return Effect.fail(new ProtocolErrorN({
            message: "Not implemented"
        }))
    }

    static fail_as_protocol_error = Effect.mapError(e => {
        if (is_protocol_error(e)) {
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

        return new ProtocolErrorN({ message, error })
    })

    static fail_with_response = <A, R>(e: Effect.Effect<A, unknown, R>) => pipe(
        e,
        Protocol.fail_as_protocol_error,
        Effect.catchTag("ProtocolError", e => Effect.gen(function* (_) {
            if (e instanceof ProtocolErrorR) {
                return yield* Effect.fail(e);
            }

            const message = yield* _(ProtocolMessageT);
            return yield* Effect.fail(
                e.to_protocolErrorR(message)
            );
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
                Effect.provideService(EnvironmentT, env),
                Effect.ignore
            )

            return chain_middleware(
                on_first_request,
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