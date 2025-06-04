import { Data, Effect, Equal, Context } from "effect";
import { AddressT, Address } from "./address";
import { SerializedMessageT, SerializedMessage, TransmittableMessageT, TransmittableMessage } from "./message";
import { endpoints, findOrCreateEndpoint } from "./endpoints";
import { applyRecieveErrorListeners } from "./listen";
import { recieve, RecieveAddressT } from "./recieve";
import { CallbackRegistrationError } from "./listen";

type InCommunicationChannel = {
    direction: "IN";
    recieve_cb: (recieve_effect: Effect.Effect<void, never, TransmittableMessageT>) => void;
    remove_cb?: (remove_effect: Effect.Effect<void, never, never>) => void;
}
type OutCommunicationChannel = {
    direction: "OUT";
    send: Effect.Effect<void, MessageTransmissionError, TransmittableMessageT>;
    remove_cb?: (remove_effect: Effect.Effect<void, never, never>) => void;
}
type InOutCommunicationChannel = {
    direction: "INOUT";
    recieve_cb: (recieve_effect: Effect.Effect<void, never, TransmittableMessageT>) => void;
    send: Effect.Effect<void, MessageTransmissionError, TransmittableMessageT>;
    remove_cb?: (remove_effect: Effect.Effect<void, never, never>) => void;
}

export type CommunicationChannel = InCommunicationChannel | OutCommunicationChannel | InOutCommunicationChannel;
export class CommunicationChannelT extends Context.Tag("CommunicationChannelT")<
    CommunicationChannelT, CommunicationChannel
>() { }

export type TryNextCommunicationChannelEffect =
    Effect.Effect<void, NoValidCommunicationChannelsError | MessageChannelError, SerializedMessageT | AddressT>
export class MessageChannelError extends Data.TaggedError("MessageChannelError")<{
    err: Error,
    communication_channel: CommunicationChannel,
    try_next: TryNextCommunicationChannelEffect,
    try_again: TryNextCommunicationChannelEffect
}> { }

export class MessageTransmissionError extends Data.TaggedError("MessageTransmissionError")<{ err: Error }> { }
export class NoValidCommunicationChannelsError extends Data.TaggedError("NoValidCommunicationChannelsError")<{
    address: Address;
}> { }


export const findAllOutCommunicationChannels = (address: Address) => {
    const total_strict_channels: OutCommunicationChannel[] = [];
    const total_weak_channels: OutCommunicationChannel[] = [];
    for (const endpoint of endpoints) {
        if (Equal.equals(endpoint.address, address)) {
            for (const communicationChannel of endpoint.communicationChannels) {
                if (["IN", "INOUT"].includes(communicationChannel.direction)) {
                    total_strict_channels.push(communicationChannel as OutCommunicationChannel);
                }
            }
        } else if (
            Equal.equals(endpoint.address.primary_id, address.primary_id) &&
            !Equal.equals(endpoint.address.primary_id, Address.local_address().primary_id)
        ) {
            for (const communicationChannel of endpoint.communicationChannels) {
                if (["IN", "INOUT"].includes(communicationChannel.direction)) {
                    total_weak_channels.push(communicationChannel as OutCommunicationChannel);
                }
            }
        }
    }
    return total_strict_channels.concat(total_weak_channels);
}

export const tryCommunicationChannels =
    (
        communication_channels: OutCommunicationChannel[],
        serialized_message: string,
        address: Address
    ): TryNextCommunicationChannelEffect =>
        Effect.gen(function* (_) {
            if (communication_channels.length == 0) {
                return yield* _(Effect.fail(new NoValidCommunicationChannelsError({
                    address: address
                })));
            }

            const new_channel = communication_channels[0]!;
            return yield* _(Effect.provideService(
                new_channel.send, TransmittableMessageT, new TransmittableMessage(
                    serialized_message as SerializedMessage, address
                )
            ));
        }).pipe(
            Effect.catchTag("MessageTransmissionError", (e) => {
                return Effect.fail(new MessageChannelError({
                    err: e,
                    try_next: tryCommunicationChannels(
                        communication_channels.slice(1),
                        serialized_message,
                        address
                    ),
                    try_again: tryCommunicationChannels(
                        communication_channels,
                        serialized_message,
                        address
                    ),
                    communication_channel: communication_channels[0]!
                }))
            })
        );



// export class CommunicatorNotFoundError extends Data.TaggedError("CommunicatorNotFoundError")<{}> { }
const removeChannelEffect = (communicationChannel: CommunicationChannel) =>
    Effect.gen(function* (_) {
        for (const endpoint of endpoints) {
            const prev_length = endpoint.communicationChannels.length;
            endpoint.communicationChannels = endpoint.communicationChannels.filter(c => c != communicationChannel);
            if (prev_length < endpoint.communicationChannels.length) {
                if (endpoint.communicationChannels.length == 0) {
                    endpoints.splice(endpoints.indexOf(endpoint), 1);
                }
                return yield* _(Effect.void);
            }
        }

        return yield* _(Effect.void);
        //return yield* _(Effect.fail(new CommunicatorNotFoundError()));
    });

export const registerCommunicationChannel = Effect.gen(function* (_) {
    const address = yield* _(AddressT);
    const communicationChannel = yield* _(CommunicationChannelT);

    const endpoint = findOrCreateEndpoint(address);
    endpoint.communicationChannels.push(communicationChannel);

    const remove_effect = removeChannelEffect(communicationChannel);
    if (typeof communicationChannel.remove_cb == "function") {
        yield* Effect.try(() => {
            return communicationChannel.remove_cb!(remove_effect)
        }).pipe(
            Effect.catchAll(e => {
                const err = e instanceof Error ? e : new Error("Couldn't register remove callback");
                return Effect.all([
                    remove_effect,
                    Effect.fail(new CallbackRegistrationError({ err })),
                ])
            })
        );
    }

    if (communicationChannel.direction == "IN" || communicationChannel.direction == "INOUT") {
        yield* Effect.try(() => {
            return (communicationChannel as InCommunicationChannel).recieve_cb(
                Effect.provideService(recieve, RecieveAddressT, address).pipe(
                    Effect.catchAll(e => {
                        return applyRecieveErrorListeners(e)
                    })
                )
            )
        }).pipe(Effect.catchAll(e => {
            const err = e instanceof Error ? e : new Error("Couldn't register remove callback");
            return Effect.all([
                remove_effect,
                Effect.fail(new CallbackRegistrationError({ err })),
            ])
        }));
    }

    return yield* _(Effect.void);
});
