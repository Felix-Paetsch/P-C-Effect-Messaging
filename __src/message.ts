import { Context, Data, Effect, ParseResult, pipe, Schema } from "effect";
import Address from "./address";
import { Communicator } from "./communicator";

export class MessageT extends Context.Tag("MessageT")<
    MessageT,
    { readonly msg: Message }
>() { }

export class MessageParseError extends Data.TaggedError("MessageParseError")<{}> { }

export type LocalComputedData = {
    local_address: Address;
    direction: "incomming" | "outgoing";
    is_bridge: boolean;
}

export default class Message {
    constructor(
        public readonly target: Address | Communicator,
        public readonly content: string,
        public meta_data: { [key: string]: any } = {},
        public computed_data: {
            local: LocalComputedData | null,
            [key: string]: any
        } = {
                local: null
            }
    ) { }


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
        encode: (msg: Message, _, ast) => {
            const target = msg.target instanceof Address ? msg.target : msg.target.get_address();
            return pipe(
                Effect.try(() => JSON.stringify({
                    target: Schema.encodeSync(Address.AddressFromString)(target),
                    content: msg.content,
                    meta_data: msg.meta_data
                })),
                Effect.catchAll(e => {
                    return ParseResult.fail(
                        new ParseResult.Type(ast, "", `Failed serializing message: ${e instanceof Error ? e.message : String(e)}`)
                    );
                })
            )
        }
    });
}