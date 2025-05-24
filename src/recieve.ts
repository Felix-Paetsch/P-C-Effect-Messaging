import { Context, Effect, pipe } from "effect";
import { Message, MessageT, SerializedMessage, SerializedMessageT } from "./message";
import { Address, AddressT } from "./address";
import { send } from "./send";
import { computeLocalMessageData, LocalComputedMessageDataT, middlewareEffect } from "./middleware";

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
        computeLocalMessageData
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