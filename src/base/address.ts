import uuidv4, { UUID } from "./uuid";
import { Data, Effect, ParseResult, Schema, Equal, Hash, Context } from "effect";

export class AddressDeserializationError extends Data.TaggedError("AddressDeserializationError")<{
    address: string;
}> { }
export class AddressT extends Context.Tag("AddressT")<AddressT, Address>() { }

export type SerializedAddress = `primary_id: ${UUID}\nsecondary_id: ${UUID}`
    & { readonly __brand: "SerializedAddress" };

export class Address implements Equal.Equal {
    constructor(
        public readonly primary_id: UUID = uuidv4(),
        public readonly secondary_id: UUID = uuidv4()
    ) { }

    [Equal.symbol](that: Equal.Equal): boolean {
        if (that instanceof Address) {
            return (
                Equal.equals(this.primary_id, that.primary_id) &&
                Equal.equals(this.secondary_id, that.secondary_id)
            )
        }

        return false
    }

    [Hash.symbol](): number {
        return Hash.hash(this.secondary_id)
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
            const primary_id = lines[0].split(": ")[1] as UUID;
            const secondary_id = lines[1].split(": ")[1] as UUID;
            if (!primary_id || !secondary_id) {
                return ParseResult.fail(new ParseResult.Type(ast, str, "Failed to deserialize address"));
            }
            return Effect.succeed(new Address(primary_id, secondary_id));
        },
        encode: (address: Address) =>
            ParseResult.succeed(`primary_id: ${address.primary_id}\nsecondary_id: ${address.secondary_id}`)
    })

    private static _local_address: Address = new Address(uuidv4(), uuidv4());
    static _setLocalAddress(address: Address) {
        this._local_address = address;
    }

    static local_address = () => this._local_address;
}