import { Data, Effect, Equal, pipe } from "effect";
import { MessageT, SerializedMessageT } from "../message";
import { Address, AddressT } from "../address";
import { applyListeners } from "./listen";
import { applyMiddlewareEffect } from "../apply_middleware_effect";
import { MiddlewareInterrupt } from "../middleware";
import { sendThroughCommunicationChannel } from "../communication_channel";
import { LocalComputedMessageDataT, localComputedMessageDataWithUpdates, sendLocalComputedMessageData } from "../local_computed_message_data";
import { MessageTransmissionError } from "../errors/message_errors";
import { findEndpoint } from "../endpoints";

export class AddressNotFoundError extends Data.TaggedError("AddressNotFoundError")<{
    address: Address;
}> { }

export const kernel_send: Effect.Effect<void, MessageTransmissionError, MessageT> = Effect.gen(function* (_) {
    const message = yield* _(MessageT);
    console.log(message);
    const address = message.target;

    const endpoint = yield* _(findEndpoint(address));
    const serialized_message = yield* message.serialize();

    const interrupt = yield* applyMiddlewareEffect;
    if (interrupt == MiddlewareInterrupt) {
        return yield* _(Effect.void);
    }

    if (Equal.equals(address, Address.local_address)) {
        return yield* _(applyListeners);
    }

    const interrupt2 = yield* applyMiddlewareEffect.pipe(
        localComputedMessageDataWithUpdates({
            direction: "outgoing",
            at_target: false
        })
    );

    if (interrupt2 == MiddlewareInterrupt) {
        return yield* _(Effect.void);
    }

    return yield* _(
        pipe(
            sendThroughCommunicationChannel(endpoint.communicationChannel, serialized_message),
            Effect.provideService(
                SerializedMessageT,
                serialized_message
            )
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