import { Effect } from "effect";
import { Address, AddressT } from "../base/address";
import { MessageT, TransmittableMessage, TransmittableMessageT } from "../base/message";
import { registerCommunicationChannel, CommunicationChannelT, MessageChannelTransmissionError, CommunicationChannel } from "../base/communication_channels";

type LocalCommunicator = {
    recievedMessage: (msg: TransmittableMessage) => Effect.Effect<void, never, never>;
    address: Address;
    remove: () => Effect.Effect<void, never, never>;
}

export const CreateLocalCommunicator = (
    listen: Effect.Effect<void, never, MessageT>,
    address: Address = Address.local_address
) => Effect.gen(function* (_) {
    let on_recieve: Effect.Effect<void, never, TransmittableMessageT> | null = null;
    let remove_effect: Effect.Effect<void, never, never> | null = null;

    const communication_channel: CommunicationChannel = {
        direction: "INOUT",
        send: listen.pipe(
            Effect.provideServiceEffect(
                MessageT,
                TransmittableMessageT.pipe(
                    Effect.flatMap(msg => msg.message)
                )
            ),
            Effect.catchAll(err => Effect.fail(new MessageChannelTransmissionError({ err })))
        ),
        recieve_cb: (_on_recieve: Effect.Effect<void, never, TransmittableMessageT>) => {
            on_recieve = _on_recieve;
        },
        remove_cb: (_remove_effect: Effect.Effect<void, never, never>) => {
            remove_effect = _remove_effect;
        }
    }

    yield* registerCommunicationChannel.pipe(
        Effect.provideService(AddressT, address),
        Effect.provideService(CommunicationChannelT, communication_channel)
    );

    return {
        recievedMessage: (msg: TransmittableMessage) => Effect.gen(function* (_) {
            if (on_recieve) {
                return yield* _(on_recieve.pipe(
                    Effect.provideService(TransmittableMessageT, msg)
                ));
            }
            return yield* _(Effect.fail(
                new MessageChannelTransmissionError({ err: new Error("No on_recieve effect registered") })));
        }),
        remove: () => Effect.gen(function* () {
            if (remove_effect) {
                return yield* remove_effect;
            }
        }),
        address: address
    } as LocalCommunicator
});