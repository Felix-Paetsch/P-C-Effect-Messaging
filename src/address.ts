import uuidv4, { UUID } from "./utils/uuid";
import { Data, Effect, ParseResult, Schema, Equal, Hash, Context } from "effect";

export class AddressDeserializationError extends Data.TaggedError("AddressDeserializationError")<{
    address: string;
}> { }
export class AddressT extends Context.Tag("AddressT")<AddressT, {
    address: Address;
}>() { }

export type SerializedAddress = `HOST_ID: ${UUID}\nPLUGIN_ID: ${UUID}`
    & { readonly __brand: "SerializedAddress" };

export class Address implements Equal.Equal {
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

    serialize(): SerializedAddress {
        return Schema.encodeSync(Address.AddressFromString)(this) as SerializedAddress;
    }

    static deserialize(serialized: SerializedAddress): Effect.Effect<Address, AddressDeserializationError> {
        return Schema.decode(Address.AddressFromString)(serialized)
            .pipe(
                Effect.catchTag("ParseError", () => new AddressDeserializationError({ address: serialized }))
            )
    }

    static AddressFromString = Schema.transformOrFail(Schema.String, Schema.instanceOf(Address), {
        decode: (str: string, _, ast) => {
            const lines = str.split("\n");
            const host_id = lines[0].split(": ")[1] as UUID;
            const plugin_id = lines[1].split(": ")[1] as UUID;
            if (!host_id || !plugin_id) {
                return ParseResult.fail(new ParseResult.Type(ast, str, "Failed to deserialize address"));
            }
            return Effect.succeed(new Address(host_id, plugin_id));
        },
        encode: (address: Address) =>
            ParseResult.succeed(`HOST_ID: ${address.host_id}\nPLUGIN_ID: ${address.plugin_id}`)
    })

    private static local_host_id: UUID = uuidv4();
    static _setLocalHostId(host_id: UUID) {
        this.local_host_id = host_id;
    }

    static local_address = () => new Address(this.local_host_id, "core" as UUID);
}