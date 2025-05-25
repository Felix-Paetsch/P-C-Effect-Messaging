import { Context, Data, Effect, ParseResult, pipe, Schema } from "effect";
import { Address } from "./address";

export class MessageT extends Context.Tag("MessageT")<
    MessageT,
    Message
>() { }

export class MessageSerializationError extends Data.TaggedError("MessageSerializationError")<{}> { }
export class MessageDeserializationError extends Data.TaggedError("MessageDeserializationError")<{}> { }

export type SerializedMessage = string & { readonly __brand: "SerializedMessage" };
export class SerializedMessageT extends Context.Tag("SerializedMessageT")<SerializedMessageT, SerializedMessage>() { }

export class Message {
    constructor(
        public readonly target: Address, // | Communicator,
        public readonly content: string,
        public meta_data: { [key: string]: any } = {}
    ) { }

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
                Effect.try(() => JSON.stringify({
                    target: Schema.encodeSync(Address.AddressFromString)(msg.target),
                    content: msg.content,
                    meta_data: msg.meta_data
                })),
                Effect.catchAll(e => {
                    return ParseResult.fail(
                        new ParseResult.Type(ast, "", `Failed serializing message: ${e instanceof Error ? e.message : String(e)}`)
                    );
                })
            )
    });
}