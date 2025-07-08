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
    Message?: ProtocolMessage;
}> {
    constructor(args: {
        message: string,
        data?: Json,
        error?: Error,
        Message?: ProtocolMessage
    }) {
        if (args.error instanceof ProtocolErrorR) {
            return new ProtocolErrorR({
                message: args.message || args.error.message,
                error: args.error.error,
                data: args.data || args.error.data,
                Message: args.error.Message || args.error.Message!
            });
        }
        super(args);
    }

    serialize() {
        return Schema.encodeSync(ProtocolErrorN.ProtocolErrorFromJson)(this);
    }

    to_protocolErrorR(protocol_message: ProtocolMessage) {
        return new ProtocolErrorR({
            message: this.message,
            error: this.error,
            data: this.data,
            Message: protocol_message
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

    static throwIfRespondedWithError = Effect.gen(function* () {
        const protocol_message = yield* ProtocolMessageT;
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
        Message: ProtocolMessage
    }) {
        super(args);
        if (this.Message && !this.Message.hasResponded) {
            this.Message.respondError(this).pipe(
                Effect.runPromise
            );
        }
    }

    to_protocolErrorR() {
        return this;
    }
}

export type ProtocolError = ProtocolErrorR | ProtocolErrorN
export function is_protocol_error(e: any): e is ProtocolError {
    return e instanceof ProtocolErrorN
}

export type ProtocolMessage = Message & {
    readonly respond: (
        content: Json
    ) => Effect.Effect<
        void,
        ProtocolError,
        never
    >,
    readonly requestRespond: (
        content: Json,
        new_timeout?: number
    ) => Effect.Effect<
        ProtocolMessage,
        ProtocolError,
        never
    >,
    readonly respondError: (error: ProtocolErrorR) => Effect.Effect<void, never, never>,
    readonly environment: Environment,
    data: Json,
    hasResponded: boolean
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

export abstract class Protocol<SenderResult, ReceiverResult> {
    constructor(
        readonly protocol: string,
        readonly protocol_ident: Json,
        readonly protocol_version: string
    ) { }

    static not_implemented_error = Effect.gen(function* () {
        const message = yield* ProtocolMessageT;
        return yield* new ProtocolErrorR(
            {
                message: "Not implemented",
                data: {},
                Message: message
            }
        )
    })

    // Will be called if the first message reaches its target on the other side
    get on_first_request(): Effect.Effect<void, ProtocolError, ProtocolMessageT | EnvironmentT> {
        return Protocol.not_implemented_error
    }

    // Send the first message | always expects a response
    protected send_first_message(address: Address, data: Json, timeout?: number):
        Effect.Effect<
            ProtocolMessage,
            ProtocolError,
            EnvironmentT
        > {
        return Effect.gen(this, function* () {
            const message = new Message(address, {
                data
            });

            this.set_protocol_meta_data(message)
            const responseE = yield* make_message_chain(message, timeout)
            const send = (yield* EnvironmentT).send.pipe(
                Effect.provideService(
                    MessageT,
                    message
                )
            )

            yield* Effect.fork(send);
            return yield* responseE.pipe(
                Effect.andThen(res => this.to_protocol_message(res)),
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
        return Effect.gen(this, function* () {
            const env = yield* EnvironmentT;
            const requestRespond = (data: Json = "Ok", timeout?: number) => {
                if (unsanatizedProtocolMessage.hasResponded) {
                    return Effect.fail(new ProtocolErrorN({
                        message: "Message already responded",
                        Message: unsanatizedProtocolMessage
                    }));
                }

                unsanatizedProtocolMessage.hasResponded = true;
                return res.requestRespond({ data }, {
                    protocol: this.protocol_meta_data
                }, timeout).pipe(
                    Effect.andThen(message => this.to_protocol_message(message)),
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
            }

            const respond = (data: Json = "Ok", is_error: boolean = false) => {
                if (unsanatizedProtocolMessage.hasResponded) {
                    return Effect.fail(new ProtocolErrorN({
                        message: "Message already responded",
                        Message: unsanatizedProtocolMessage
                    }));
                }

                unsanatizedProtocolMessage.hasResponded = true;
                return res.respond({ data }, {
                    protocol: {
                        ...this.protocol_meta_data, is_error
                    }
                }).pipe(
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
            }

            const respond_error: ProtocolMessage["respondError"] = (err) =>
                pipe(
                    respond(err.serialize(), true),
                    Effect.ignore
                );

            const unsanatizedProtocolMessage: ProtocolMessage = Object.assign(msg, {
                respond,
                requestRespond: requestRespond,
                respondError: respond_error,
                data: {},
                hasResponded: false,
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

            const protocol_meta_data = yield* Protocol.get_protocol_meta_data(msg.meta_data);
            if (Option.isNone(protocol_meta_data)) {
                return yield* new ProtocolErrorR({
                    message: "Invalid protocol meta data",
                    Message: unsanatizedProtocolMessage
                });
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
        Effect.catchTag("ProtocolError", e => Effect.gen(function* () {
            if (e instanceof ProtocolErrorR) {
                return yield* Effect.fail(e);
            }

            const message = yield* ProtocolMessageT;
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
        return Effect.gen(function* () {
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
                Effect.gen(function* () {
                    const message = yield* MessageT;
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