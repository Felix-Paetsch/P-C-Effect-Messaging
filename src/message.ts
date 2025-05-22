import { Context, Effect } from "effect";
import Address from "./address";
import { Communicator } from "./communicator";

export class MessageT extends Context.Tag("MessageT")<
    MessageT,
    { readonly msg: Message }
>() { }

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

    serialize() { }
    static deserialize(msg: string) {
        return Effect.try(JSON.parse(msg));
    }
}