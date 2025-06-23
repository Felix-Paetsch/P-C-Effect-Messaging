import { Data, Effect, Equal, Context, Option } from "effect";
import { Address } from "./address";
import { SerializedMessage, TransmittableMessageT, TransmittableMessage } from "./message";
import { createEndpoint } from "./endpoints";
import { applyMessageProcessingErrorListeners } from "./kernel_environment/listen";
import { recieve, RecieveAddressT } from "./recieve";
import { MessageTransmissionError } from "./errors/message_errors";
import { CallbackRegistrationError } from "./errors/callback_registration";

export type CommunicationChannel = {
    address: Address;
    send: Effect.Effect<void, MessageChannelTransmissionError, TransmittableMessageT>;
    recieve_cb: (recieve_effect: Effect.Effect<
        Option.Option<MessageTransmissionError>,
        never,
        TransmittableMessageT
    >) => void;
    remove_cb?: (remove_effect: Effect.Effect<void, never, never>) => void;
};
export class CommunicationChannelT extends Context.Tag("CommunicationChannelT")<
    CommunicationChannelT, CommunicationChannel
>() { }

export class MessageChannelTransmissionError extends Data.TaggedError("cc/MessageChannelTransmissionError")<{ err: Error }> { }
export class AddressAlreadyInUseError extends Data.TaggedError("AddressAlreadyInUseError")<{
    address: Address;
}> { }

export const sendThroughCommunicationChannel = (
    channel: CommunicationChannel,
    serialized_message: string
): Effect.Effect<void, MessageChannelTransmissionError> => {
    return Effect.provideService(
        channel.send,
        TransmittableMessageT,
        new TransmittableMessage(serialized_message as SerializedMessage, channel.address)
    );
}

export const registerCommunicationChannel = Effect.gen(function* (_) {
    const communicationChannel = yield* _(CommunicationChannelT);
    const address = communicationChannel.address;

    const ep = yield* createEndpoint(communicationChannel);

    yield* Effect.try(() => {
        communicationChannel.recieve_cb(
            Effect.provideService(recieve, RecieveAddressT, address).pipe(
                Effect.tapError(e => applyMessageProcessingErrorListeners(e)),
                Effect.flip,
                Effect.option
            )
        );

        if (typeof communicationChannel.remove_cb == "function") {
            communicationChannel.remove_cb(ep.remove);
        }
    }).pipe(Effect.catchAll(e => {
        const err = e instanceof Error ? e : new Error("Couldn't register receive callback");
        return Effect.all([
            ep.remove,
            Effect.fail(new CallbackRegistrationError({ err })),
        ])
    }));

    return yield* _(Effect.void);
});
