import { Context, Data, Effect, ParseResult, pipe, Schema } from "effect";
import { Address } from "./address";
import { CommunicationChannel } from "./communication_channels";

export class MessageT extends Context.Tag("MessageT")<
    MessageT,
    Message
>() { }

export class MessageSerializationError extends Data.TaggedError("MessageSerializationError")<{}> { }
export class MessageDeserializationError extends Data.TaggedError("MessageDeserializationError")<{}> { }

export type SerializedMessage = string & { readonly __brand: "SerializedMessage" };
export class SerializedMessageT extends Context.Tag("SerializedMessageT")<SerializedMessageT, SerializedMessage>() { }

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export type MessageContent = {
    serialized: string | null,
    deserialized: { [key: string]: Json } | null
}

const deserialized_schema = Schema.Record({
    key: Schema.String,
    value: Schema.Any
});
const transform_message_content = Schema.parseJson(deserialized_schema);

export class Message {
    private msg_content: MessageContent;

    constructor(
        public target: Address, // | Communicator,
        content: string | { [key: string]: Json },
        public meta_data: { [key: string]: Json } = {},
        public prefered_communication_channel: CommunicationChannel | null = null
    ) {
        if (typeof content === "string") {
            this.msg_content = { serialized: content, deserialized: null };
        } else {
            this.msg_content = { serialized: null, deserialized: content };
        }
    }

    serialize(): Effect.Effect<SerializedMessage, MessageSerializationError> {
        return Schema.encode(Message.MessageFromString)(this)
            .pipe(
                Effect.map(serialized => serialized as SerializedMessage),
                Effect.catchTag("ParseError", () => new MessageSerializationError())
            )
    }

    static deserialize(serialized: SerializedMessage): Effect.Effect<Message, MessageDeserializationError> {
        return Schema.decode(Message.MessageFromString)(serialized)
            .pipe(
                Effect.catchTag("ParseError", () => new MessageDeserializationError())
            )
    }

    get serialized_content(): Effect.Effect<string, MessageSerializationError> {
        const this_msg = this;
        return Effect.gen(function* (_) {
            if (this_msg.msg_content.serialized === null) {
                if (this_msg.msg_content.deserialized === null) {
                    return yield* _(Effect.fail(new MessageSerializationError()));
                }

                const serialized = yield* _(Schema.encode(transform_message_content)(this_msg.msg_content.deserialized));
                this_msg.msg_content.serialized = serialized;
            }

            return this_msg.msg_content.serialized!;
        }).pipe(Effect.catchTag("ParseError", () => new MessageSerializationError()));

    }

    get content(): Effect.Effect<{ [key: string]: Json }, MessageDeserializationError> {
        const this_msg = this;
        return Effect.gen(function* (_) {
            if (this_msg.msg_content.deserialized === null) {
                if (this_msg.msg_content.serialized === null) {
                    return yield* _(Effect.fail(new MessageDeserializationError()));
                }

                const deserialized = yield* _(Schema.decode(transform_message_content)(this_msg.msg_content.serialized));
                this_msg.msg_content.deserialized = deserialized;
            }

            return this_msg.msg_content.deserialized!;
        }).pipe(Effect.catchTag("ParseError", () => new MessageDeserializationError()));
    }

    get content_string(): Effect.Effect<string, MessageDeserializationError> {
        return this.content.pipe(Effect.map(content => JSON.stringify(content)));
    }

    static content(msg: Message | string) {
        return Effect.gen(function* (_) {
            if (typeof msg === "string") {
                const msg_obj = yield* _(Message.deserialize(msg as SerializedMessage));
                return yield* msg_obj.content;
            }

            return yield* msg.content;
        });
    }

    static MessageFromString = Schema.transformOrFail(Schema.String, Schema.instanceOf(Message), {
        decode: (str: string, _, ast) =>
            pipe(
                Effect.try(() => JSON.parse(str)),
                Effect.catchAll(e => {
                    return ParseResult.fail(
                        new ParseResult.Type(ast, str, `Failed to parse JSON: ${e instanceof Error ? e.message : String(e)}`)
                    );
                }),
                Effect.andThen((json) => Effect.gen(function* (_) {
                    const target_str = yield* _(Schema.decode(Schema.String)(json.target));
                    const content = yield* _(Schema.decode(Schema.String)(json.content));
                    const meta_data = yield* _(Schema.decode(Schema.Record({
                        key: Schema.String,
                        value: Schema.Any
                    }))(json.meta_data));
                    const target = yield* _(Schema.decode(Address.AddressFromString)(target_str));
                    return new Message(target, content, meta_data)
                })),
                Effect.catchAll(e => {
                    return ParseResult.fail(
                        new ParseResult.Type(ast, str, `Failed deserializing message: ${e instanceof Error ? e.message : String(e)}`));
                })
            ),
        encode: (msg: Message, _, ast) =>
            pipe(
                msg.serialized_content,
                Effect.andThen(serialized_content =>
                    Effect.try(() => JSON.stringify({
                        target: Schema.encodeSync(Address.AddressFromString)(msg.target),
                        content: serialized_content,
                        meta_data: msg.meta_data
                    }))
                ),
                Effect.catchAll(e => {
                    return ParseResult.fail(
                        new ParseResult.Type(ast, "", `Failed serializing message: ${e instanceof Error ? e.message : String(e)}`)
                    );
                })
            )
    });
}


export class TransmittableMessage {
    constructor(
        private msg: Message | SerializedMessage,
        private addr: Address | null = null
    ) { }

    get message(): Effect.Effect<Message, MessageDeserializationError> {
        const self = this;
        return Effect.gen(function* (_) {
            if (self.msg instanceof Message) {
                return self.msg;
            }

            self.msg = yield* _(Message.deserialize(self.msg));
            return self.msg;
        })
    }

    get string(): Effect.Effect<SerializedMessage, MessageSerializationError> {
        const self = this;
        return Effect.gen(function* (_) {
            if (self.msg instanceof Message) {
                return yield* _(self.msg.serialize());
            }

            return self.msg;
        })
    }

    get address(): Effect.Effect<Address, MessageDeserializationError> {
        const self = this;
        return Effect.gen(function* (_) {
            if (typeof self.msg === "string" && self.addr) {
                return self.addr;
            }

            return yield* _(self.message.pipe(Effect.map(msg => msg.target)));
        })
    }
}

export class TransmittableMessageT extends Context.Tag("TransmittableMessageT")<TransmittableMessageT, TransmittableMessage>() { }