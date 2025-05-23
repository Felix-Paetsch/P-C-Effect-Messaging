import { UUID } from "./utils/uuid";
import { Data, Effect, ParseResult, Schema, Equal, Hash } from "effect";

export class DeserializationError extends Data.TaggedError("DeserializationError")<{}> { }

export default class Address implements Equal.Equal {
    constructor(
        public readonly host_id: UUID,
        public readonly plugin_id: UUID
    ) { }

    [Equal.symbol](that: Equal.Equal): boolean {
        if (that instanceof Address) {
            return (
                Equal.equals(this.host_id, that.host_id) &&
                Equal.equals(this.plugin_id, that.plugin_id)
            )
        }

        return false
    }

    [Hash.symbol](): number {
        return Hash.hash(this.plugin_id)
    }

    static AddressFromString = Schema.transformOrFail(Schema.String, Schema.instanceOf(Address), {
        decode: (str: string, _, ast) => {
            const lines = str.split("\n");
            const host_id = lines[0].split(": ")[1];
            const plugin_id = lines[1].split(": ")[1];
            if (!host_id || !plugin_id) {
                return ParseResult.fail(new ParseResult.Type(ast, str, "Failed to deserialize address"));
            }
            return Effect.succeed(new Address(host_id, plugin_id));
        },
        encode: (address: Address) =>
            ParseResult.succeed(`HOST_ID: ${address.host_id}\nPLUGIN_ID: ${address.plugin_id}`)
    })
}