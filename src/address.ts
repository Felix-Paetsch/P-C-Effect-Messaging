import { UUID } from "./utils/uuid";
import { Effect } from "effect";

export class DeserializationError extends Error {
    _tag = "@msg/address/DeserializationError";
}

export default class Address {
    constructor(
        public readonly host_id: UUID,
        public readonly plugin_id: UUID
    ) { }

    equals(other: Address) {
        return this.host_id === other.host_id && this.plugin_id === other.plugin_id;
    }

    serialize() {
        return `HOST_ID: ${this.host_id}\nPLUGIN_ID: ${this.plugin_id}`
    }

    static deserialize = (s: string): Effect.Effect<Address, DeserializationError, never> => {
        const lines = s.split("\n");
        const host_id = lines[0].split(": ")[1];
        const plugin_id = lines[1].split(": ")[1];
        if (!host_id || !plugin_id) {
            return Effect.fail(new DeserializationError("Invalid address format"));
        }
        return Effect.succeed(new Address(host_id, plugin_id));
    }
}