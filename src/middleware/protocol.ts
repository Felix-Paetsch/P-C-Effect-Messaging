/*

    Questions:
    - Where exactly do we put this middleware?
    - CleanUp

    // MessageTransmissionError
    // ProtocolError: TimeoutError/Bad Response(protocol error on the other side)
    // Exfiltrate some errors (like messagetransmissione errors) to seperate files
    // Functions like isMessageTransmissionError
*/

import { Context, Data, Effect, Schema, Equal, Option } from "effect"
import { catchAllAsMiddlewareError, Middleware } from "../base/middleware"
import { chain_middleware, ChainMessageResult, ChainMessageResultT, make_message_chain } from "./message_chains"
import { Address } from "../base/address"
import { Json, Message, MessageT } from "../base/message";
import { LocalComputedMessageDataT } from "../base/local_computed_message_data";
import { send } from "../base/send";
import { onErrorRetryWithOtherCommunicationChannels } from "../tools/on_message_channel_error";

export class ProtocolError extends Data.TaggedError("ProtocolError")<{
    message: string;
    error: Error;
}> { }

type ProtocolMessageRespond = (data: Json) => Effect.Effect<ProtocolMessage, Error, never>
export type ProtocolMessage = Message & {
    readonly respond: ProtocolMessageRespond
}
export class ProtocolMessageT extends Context.Tag("ProtocolMessageT")<ProtocolMessageT, ProtocolMessage>() { }

const ProtocolMetaDataSchema = Schema.Struct({
    protocol: Schema.String,
    protocol_ident: Schema.Any, // TODO: make it a string
    protocol_version: Schema.String
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

    protected on_first_request: Effect.Effect<void, ProtocolError, ProtocolMessageT | LocalComputedMessageDataT>
        = Effect.fail(Protocol.not_implemented_error)

    protected send_first_message(address: Address, data: Json, timeout: number = 5000) {
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
                Effect.andThen((response) => self.to_protocol_message(response))
            )
        })
    }

    protected to_protocol_message(res: ChainMessageResult): ProtocolMessage {
        const msg = res.message;
        const self = this;

        const respond: ProtocolMessageRespond = (data) => {
            return res.respond({ data }, this.protocol_meta_data).pipe(
                Effect.andThen(message => self.to_protocol_message(message))
            )
        }
        (msg as any).respond = respond;
        return msg as ProtocolMessage;
    }

    protected get protocol_meta_data(): typeof ProtocolMetaDataSchema.Type {
        return Data.struct({
            protocol: this.protocol,
            protocol_ident: this.protocol_ident,
            protocol_version: this.protocol_version
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