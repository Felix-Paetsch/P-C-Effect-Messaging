import { Context, Effect, pipe } from "effect";
import { Message, MessageT, SerializedMessageT } from "./message";
import { Address, AddressT } from "./address";
import { send } from "./send";
import { middlewareEffect } from "./middleware";
import { LocalComputedMessageDataT, justRecievedLocalComputedMessageData } from "./local_computed_message_data";

export class RecieveAddressT extends Context.Tag("RecieveAddressT")<RecieveAddressT, Address>() { }

export const recieve = pipe(
    middlewareEffect("MSG_IN"),
    Effect.provideServiceEffect(
        AddressT,
        RecieveAddressT
    ),
    Effect.provideServiceEffect(
        LocalComputedMessageDataT,
        justRecievedLocalComputedMessageData
    ),
    Effect.andThen(send),
    Effect.provideServiceEffect(
        MessageT,
        Effect.gen(function* (_) {
            const serialized = yield* _(SerializedMessageT);
            return yield* Message.deserialize(serialized);
        })
    )
)