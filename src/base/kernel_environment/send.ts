import { Data, Effect, Equal, pipe } from "effect";
import { MessageT, SerializedMessageT } from "../message";
import { Address, AddressT } from "../address";
import { applyListeners } from "./listen";
import { applyMiddlewareEffect } from "../apply_middleware_effect";
import { MiddlewareInterrupt } from "../middleware";
import { sendThroughCommunicationChannel } from "../communication_channel";
import { LocalComputedMessageDataT, localComputedMessageDataWithUpdates, sendLocalComputedMessageData } from "../local_computed_message_data";
import { findEndpointOrFail } from "../endpoints";
import { InvalidMessageFormatError, MessageTransmissionError } from "../errors/message_errors";

export class AddressNotFoundError extends Data.TaggedError("AddressNotFoundError")<{
    address: Address;
}> { }

export const kernel_send: Effect.Effect<void, MessageTransmissionError | InvalidMessageFormatError, MessageT> = Effect.gen(function* () {
    const message = yield* MessageT;
    console.log("< MSG >");
    const address = message.target;

    const endpoint = yield* findEndpointOrFail(address);
    const serialized_message = yield* message.serialize();

    // Incomming to kernel
    const interrupt = yield* applyMiddlewareEffect.pipe(
        Effect.provideService(
            AddressT,
            Address.local_address
        )
    );

    if (interrupt == MiddlewareInterrupt) {
        return yield* Effect.void;
    }

    if (Equal.equals(address, Address.local_address)) {
        return yield* applyListeners;
    }

    // Outgoing from kernel
    const interrupt2 = yield* applyMiddlewareEffect.pipe(
        localComputedMessageDataWithUpdates({
            direction: "outgoing",
            at_target: false
        }),
        Effect.provideService(
            AddressT,
            Address.local_address
        )
    );

    if (interrupt2 == MiddlewareInterrupt) {
        return yield* Effect.void;
    }

    // Outgoing via address
    const interrupt3 = yield* applyMiddlewareEffect.pipe(
        localComputedMessageDataWithUpdates({
            direction: "outgoing",
            at_target: false
        })
    );

    if (interrupt3 == MiddlewareInterrupt) {
        return yield* Effect.void;
    }

    return yield* pipe(
        sendThroughCommunicationChannel(endpoint.communicationChannel, serialized_message),
        Effect.provideService(
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
        Effect.gen(function* () {
            const message = yield* MessageT;
            return message.target;
        })
    ),
    Effect.catchTag("MessageSerializationError", (e) =>
        Effect.gen(function* () {
            const message = yield* MessageT;
            return Effect.fail(
                new InvalidMessageFormatError({
                    Message: message,
                    error: e,
                    message: "The message to send had bad format."
                })
            );
        })
    )
);