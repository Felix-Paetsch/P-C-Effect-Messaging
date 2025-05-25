import { Data, Effect, Equal } from "effect";
import { MessageT, SerializedMessageT } from "./message";
import { Address, AddressT } from "./address";
import { applyListeners } from "./listen";
import { coreMiddlewareEffect, middlewareEffect, MiddlewareInterrupt } from "./middleware";
import { findAllOutCommunicationChannels, tryCommunicationChannels } from "./communication_channels";
import { LocalComputedMessageDataT, sendLocalComputedMessageData } from "./local_computed_message_data";

class AddressNotFoundError extends Data.TaggedError("AddressNotFoundError")<{
    address: Address;
}> { }

export const send = Effect.gen(function* (_) {
    const message = yield* _(MessageT);
    const address = message.target;

    const { direction } = yield* _(LocalComputedMessageDataT);
    const communication_channels = findAllOutCommunicationChannels(address);
    const serialized_message = yield* message.serialize();

    const interrupt = yield* coreMiddlewareEffect(direction == "outgoing" ? "MSG_OUT" : "MSG_IN");
    if (interrupt == MiddlewareInterrupt) {
        return yield* _(Effect.never);
    }

    if (Equal.equals(address, Address.local_address())) {
        return yield* _(applyListeners);
    }

    const interrupt2 = yield* middlewareEffect(direction == "outgoing" ? "MSG_OUT" : "MSG_IN");
    if (interrupt2 == MiddlewareInterrupt) {
        return yield* _(Effect.never);
    }

    if (communication_channels.length == 0) {
        return yield* _(Effect.fail(new AddressNotFoundError({ address })));
    }
    return yield* _(
        Effect.provideService(
            tryCommunicationChannels(communication_channels, serialized_message, address),
            SerializedMessageT,
            serialized_message
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
            const message = yield* _(MessageT);
            return message.target;
        })
    )
);

