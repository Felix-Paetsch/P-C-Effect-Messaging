import { Data, Effect, Layer, Option, Schema } from "effect";
import { Address } from "../base/address";
import { Environment, EnvironmentInactiveError, EnvironmentT } from "../base/environment";
import { MessageTransmissionError } from "../base/errors/message_errors";
import { Message, MessageT } from "../base/message";
import { Middleware } from "../base/middleware";
import { guard_at_source, guard_at_target } from "../middleware/guard";
import { chain_middleware, make_message_chain } from "../middleware/message_chains";
import { Json } from "../utils/json";
import { ProtocolCommunicationHandler, ProtocolCommunicationHandlerT } from "./base/communicationHandler";
import { is_protocol_error, ProtocolError, ProtocolErrorN } from "./base/protocol_errors";
import { get_protocol_meta_data, ProtocolMessageFromChainMessageResult, to_protocol_message } from "./base/protocol_message";

const ProtocolMetaDataSchema = Schema.Struct({
    protocol_name: Schema.String,
    protocol_ident: Schema.Any,
    protocol_version: Schema.String,
    is_error: Schema.optionalWith(Schema.Boolean, {
        default: () => false
    })
});

export abstract class Protocol<SenderResult, ReceiverResult> {
    constructor(
        readonly protocol_name: string,
        readonly protocol_ident: Json,
        readonly protocol_version: string
    ) { }

    abstract get on_first_request(): Effect.Effect<void, ProtocolError, ProtocolCommunicationHandlerT>;
    send_first_message(address: Address, data: Json, timeout?: number):
        Effect.Effect<
            Effect.Effect<ProtocolCommunicationHandler, ProtocolError, EnvironmentT>,
            MessageTransmissionError | EnvironmentInactiveError | ProtocolError,
            EnvironmentT
        > {

        return Effect.gen(this, function* () {
            const message = new Message(address, {
                data
            });

            message.meta_data.protocol = this.protocol_meta_data;
            const responseE = yield* make_message_chain(message, timeout)
            const send = (yield* EnvironmentT).send;

            yield* send.pipe(
                Effect.provideService(
                    MessageT,
                    message
                )
            )

            const env = yield* EnvironmentT;
            return responseE.pipe(
                Effect.andThen(response => to_protocol_message(response, this.protocol_meta_data)),
                Effect.andThen(protocolMessage => new ProtocolCommunicationHandler(protocolMessage)),
                Effect.mapError(e => {
                    if (is_protocol_error(e)) {
                        return e;
                    }

                    return new ProtocolErrorN({
                        message: "Chain timeout",
                        error: e
                    })
                })
            ).pipe(
                Effect.provideService(EnvironmentT, env)
            )
        })
    }

    protected get protocol_meta_data(): typeof ProtocolMetaDataSchema.Type {
        return Data.struct({
            protocol_name: this.protocol_name,
            protocol_ident: this.protocol_ident,
            protocol_version: this.protocol_version,
            is_error: false
        })
    }

    abstract run(address: Address, data: Json): Effect.Effect<SenderResult, ProtocolError, EnvironmentT>;

    on(cb: (result: ReceiverResult) => Effect.Effect<void, never, never>): void {
        this.on_callback = cb;
    }
    protected on_callback: (result: ReceiverResult) => Effect.Effect<void, never, never> = () => Effect.void;


    /** The middleware to register on both sides to make this work */
    middleware(env: Environment): Effect.Effect<Middleware, never, never> {
        console.log("REGISTER MIDDLEWARE", this.protocol_name, env.ownAddress._secondary_id);
        return Effect.gen(this, function* () {
            const on_first_request = this.on_first_request.pipe(
                Effect.provide(
                    ProtocolCommunicationHandler.fromProtocolMessage.pipe(
                        Layer.provide(ProtocolMessageFromChainMessageResult(this.protocol_meta_data)),
                        Layer.provide(Layer.succeed(EnvironmentT, EnvironmentT.of(env)))
                    )
                ),
                Effect.ignore
            )

            return chain_middleware(
                on_first_request,
                Effect.void,
                Effect.gen(this, function* () {
                    const message = yield* MessageT;
                    const meta_data = message.meta_data;
                    const protocol_meta_data = yield* get_protocol_meta_data(meta_data);
                    if (Option.isNone(protocol_meta_data)) {
                        return false
                    }

                    return (
                        protocol_meta_data.value.protocol_name === this.protocol_meta_data.protocol_name
                        && protocol_meta_data.value.protocol_ident === this.protocol_meta_data.protocol_ident
                        && protocol_meta_data.value.protocol_version === this.protocol_meta_data.protocol_version
                    )
                })
            )
        })
    }

    request_middleware(env: Environment): Effect.Effect<Middleware, never, never> {
        return this.middleware(env).pipe(
            Effect.map(middleware => guard_at_source(middleware))
        )
    }

    response_middleware(env: Environment): Effect.Effect<Middleware, never, never> {
        return this.middleware(env).pipe(
            Effect.map(middleware => guard_at_target(middleware))
        )
    }
}