import { v4 as uuidv4 } from 'uuid';
import { Data, Effect, ParseResult, Schema, Equal, Hash, Context } from "effect";

export class AddressDeserializationError extends Data.TaggedError("AddressDeserializationError")<{
    address: string;
}> { }
export class AddressT extends Context.Tag("AddressT")<AddressT, Address>() { }

export type SerializedAddress = `primary_id: ${string}\nsecondary_id: ${string}`
    & { readonly __brand: "SerializedAddress" };

export class Address implements Equal.Equal {
    readonly _primary_id: string;
    readonly _secondary_id: string;

    constructor(
        primary_id: string = uuidv4(),
        secondary_id: string = uuidv4()
    ) {
        this._primary_id = primary_id;
        this._secondary_id = secondary_id;
    }

    get primary_id(): string {
        return this._primary_id;
    }

    get secondary_id(): string {
        return this._secondary_id;
    }

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
        const serialized: string = Schema.encodeSync(Address.AddressFromString)(this);
        return serialized as SerializedAddress;
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
            const primary_id = lines[0].split(": ")[1];
            const secondary_id = lines[1].split(": ")[1];
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

    static get local_address() {
        return this._local_address;
    }

    static new_local_address = (secondary_id: string = uuidv4()) => {
        return new LocalAddress(secondary_id);
    }
}

export class LocalAddress extends Address {
    constructor(
        secondary_id: string = uuidv4()
    ) {
        super(Address.local_address.primary_id, secondary_id)
    }

    get primary_id() {
        return Address.local_address.primary_id
    }
}