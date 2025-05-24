import { Data, Effect, Equal, Context } from "effect";
import { AddressT, Address } from "./address";
import { SerializedMessageT, SerializedMessage } from "./message";
import { endpoints, findOrCreateEndpoint } from "./endpoints";
import { ProcessAMessageThatWasRecievedAndThrew } from "./listen";
import { recieve, RecieveAddressT } from "./recieve";

type InCommunicationChannel = {
    direction: "IN" | "INOUT";
    recieve_cb: (recieve_effect: Effect.Effect<never, never, SerializedMessageT>) => void;
    remove_cb: (remove_effect: Effect.Effect<never, CommunicatorNotFoundError, never>) => void;
}
type OutCommunicationChannel = {
    direction: "OUT" | "INOUT";
    send: Effect.Effect<never, MessageTransmissionError, SerializedMessageT>;
    remove_cb: (remove_effect: Effect.Effect<never, CommunicatorNotFoundError, never>) => void;
}
type CommunicationChannel = InCommunicationChannel | OutCommunicationChannel;
class CommunicationChannelT extends Context.Tag("CommunicationChannelT")<CommunicationChannelT, {
    communicationChannel: CommunicationChannel;
}>() { }


export type TryNextCommunicationChannelEffect =
    Effect.Effect<never, NoValidCommunicationChannelsError | MessageChannelError, SerializedMessageT | AddressT>
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
                    total_strict_channels.push(communicationChannel);
                }
            }
        } else if (
            Equal.equals(endpoint.address.host_id, address.host_id) &&
            !Equal.equals(endpoint.address.host_id, Address.local_address().host_id)
        ) {
            for (const communicationChannel of endpoint.communicationChannels) {
                if (["IN", "INOUT"].includes(communicationChannel.direction)) {
                    total_weak_channels.push(communicationChannel);
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
    ): TryNextCommunicationChannelEffect => {
        return Effect.gen(function* (_) {
            if (communication_channels.length == 0) {
                return yield* _(Effect.fail(new NoValidCommunicationChannelsError({
                    address: address
                })));
            }

            const new_channel = communication_channels[0]!;
            return yield* _(Effect.provideService(
                new_channel.send, SerializedMessageT, { serialized: serialized_message as SerializedMessage })
            );
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
    }


export class CommunicatorNotFoundError extends Data.TaggedError("CommunicatorNotFoundError")<{}> { }

const removeChannelEffect = (communicationChannel: CommunicationChannel) =>
    Effect.gen(function* (_) {
        for (const endpoint of endpoints) {
            if (Equal.equals(endpoint.address, endpoint.address)) {
                const prev_length = endpoint.communicationChannels.length;
                endpoint.communicationChannels = endpoint.communicationChannels.filter(c => c != communicationChannel);
                if (prev_length == endpoint.communicationChannels.length) {
                    return yield* _(Effect.fail(new CommunicatorNotFoundError()));
                }
                return yield* _(Effect.never);
            }
        }

        return yield* _(Effect.fail(new CommunicatorNotFoundError()));
    })

export class RegisterChannelCallbackError extends Data.TaggedError("RegisterChannelError")<{
    err: Error;
}> { }

export const registerCommunicationChannel = Effect.gen(function* (_) {
    const { address } = yield* _(AddressT);
    const { communicationChannel } = yield* _(CommunicationChannelT);

    const endpoint = findOrCreateEndpoint(address);
    endpoint.communicationChannels.push(communicationChannel);

    const remove_effect = removeChannelEffect(communicationChannel);
    yield* Effect.try(() => {
        return communicationChannel.remove_cb(remove_effect)
    }).pipe(Effect.catchAll(e => {
        const err = e instanceof Error ? e : new Error("Couldn't register remove callback");
        return remove_effect.pipe(
            Effect.andThen(Effect.fail(new RegisterChannelCallbackError({ err }))),
            Effect.catchTag(
                "CommunicatorNotFoundError",
                () => Effect.never // If it is not there for some reason, we are good
            )
        )
    }));

    if (communicationChannel.direction == "IN" || communicationChannel.direction == "INOUT") {
        yield* Effect.try(() => {
            return (communicationChannel as InCommunicationChannel).recieve_cb(
                Effect.provideService(recieve, RecieveAddressT, { address: address }).pipe(
                    Effect.catchAll(e => {
                        return ProcessAMessageThatWasRecievedAndThrew
                    }),
                    Effect.andThen(Effect.never)
                )
            )
        }).pipe(Effect.catchAll(e => {
            const err = e instanceof Error ? e : new Error("Couldn't register remove callback");
            return remove_effect.pipe(
                Effect.andThen(Effect.fail(new RegisterChannelCallbackError({ err }))),
                Effect.catchTag(
                    "CommunicatorNotFoundError",
                    () => Effect.never // If it is not there for some reason, we are good
                )
            )
        }));
    }

    return yield* _(Effect.never);
});
