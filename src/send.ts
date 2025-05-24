import { Data, Effect, Equal, Option } from "effect";
import { MessageT, SerializedMessageT } from "./message";
import { Address, AddressT } from "./address";
import { ProcessAMessageThatTargetedCore } from "./listen";
import { coreMiddlewareEffect, middlewareEffect } from "./middleware";
import { findAllOutCommunicationChannels, tryCommunicationChannels } from "./communication_channels";
import { LocalComputedMessageDataT, sendLocalComputedMessageData } from "./local_computed_message_data";

class AddressNotFoundError extends Data.TaggedError("AddressNotFoundError")<{
    address: Address;
}> { }

export const send = Effect.gen(function* (_) {
    const { msg } = yield* _(MessageT);
    const { address } = yield* _(AddressT);

    const { direction } = yield* _(LocalComputedMessageDataT);
    const communication_channels = findAllOutCommunicationChannels(address);
    const serialized_message = yield* msg.serialize();

    yield* coreMiddlewareEffect(direction == "outgoing" ? "MSG_OUT" : "MSG_IN");

    if (Equal.equals(address, Address.local_address())) {
        return yield* _(ProcessAMessageThatTargetedCore);
    }

    yield* _(middlewareEffect(direction == "outgoing" ? "MSG_OUT" : "MSG_IN"));
    if (communication_channels.length == 0) {
        return yield* _(Effect.fail(new AddressNotFoundError({ address })));
    }
    return yield* _(
        Effect.provideService(
            tryCommunicationChannels(communication_channels, serialized_message, address),
            SerializedMessageT,
            { serialized: serialized_message }
        )
    );
}).pipe(
    Effect.provideServiceEffect(
        LocalComputedMessageDataT,
        sendLocalComputedMessageData
    ),
    Effect.provideServiceEffect(
        AddressT,
        Effect.gen(function* (_) {
            const { msg } = yield* _(MessageT);
            return yield* _(Effect.succeed({
                address: msg.target
            }));
        })
    )
);

