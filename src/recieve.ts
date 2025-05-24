import { Context, Effect, pipe, Equal } from "effect";
import { Message, MessageT, SerializedMessage, SerializedMessageT } from "./message";
import { Address, AddressT } from "./address";
import { send } from "./send";
import { middlewareEffect } from "./middleware";
import { LocalComputedMessageDataT, justRecievedLocalComputedMessageData } from "./local_computed_message_data";

export class RecieveAddressT extends Context.Tag("RecieveAddressT")<RecieveAddressT, {
    address: Address;
}>() { }


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
            const { serialized } = yield* _(SerializedMessageT);
            const message = yield* Message.deserialize(serialized as SerializedMessage);
            return yield* Effect.succeed({
                msg: message
            });
        })
    )
)