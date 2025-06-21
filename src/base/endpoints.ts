import { Address } from "./address";
import { Middleware } from "./middleware";
import { AddressAlreadyInUseError, CommunicationChannel, MessageChannelTransmissionError } from "./communication_channel";
import { Equal, Effect } from "effect";
import { AddressNotFoundError, kernel_send } from "./kernel_environment/send";
import { MessageT, TransmittableMessageT } from "./message";
import { CallbackRegistrationError } from "./kernel_environment/listen";

export type Endpoint = {
    address: Address;
    communicationChannel: CommunicationChannel;
    middlewares: Middleware[];
    remove: Effect.Effect<void, never, never>;
}

const endpoints: Endpoint[] = [{
    address: Address.local_address,
    communicationChannel: {
        address: Address.local_address,
        send: kernel_send.pipe(
            Effect.provideServiceEffect(
                MessageT,
                Effect.gen(function* (_) {
                    const msg = yield* _(TransmittableMessageT);
                    return yield* msg.message;
                })
            ),
            Effect.mapError(e => new MessageChannelTransmissionError({ err: e }))
        ),
        recieve_cb: () => Effect.void,
        remove_cb: () => Effect.void
    },
    middlewares: [],
    remove: Effect.void
}];

export const createEndpoint = (communicationChannel: CommunicationChannel): Effect.Effect<Endpoint, AddressAlreadyInUseError | CallbackRegistrationError> =>
    Effect.gen(function* (_) {
        const new_endpoint = {
            address: communicationChannel.address,
            communicationChannel,
            middlewares: [],
            remove: removeEndpoint(communicationChannel.address)
        };

        yield* findEndpoint(communicationChannel.address).pipe(
            Effect.flip,
            Effect.mapError(_ => {
                return new AddressAlreadyInUseError({ address: communicationChannel.address });
            })
        );

        if (typeof communicationChannel.remove_cb == "function") {
            yield* Effect.try(() => {
                return communicationChannel.remove_cb!(new_endpoint.remove)
            }).pipe(
                Effect.catchAll(e => {
                    const err = e instanceof Error ? e : new Error("Couldn't register remove callback");
                    return Effect.all([
                        new_endpoint.remove,
                        Effect.fail(new CallbackRegistrationError({ err })),
                    ])
                })
            );
        }

        endpoints.push(new_endpoint);
        return new_endpoint;
    });

export const removeEndpoint = (address: Address): Effect.Effect<void, never, never> =>
    Effect.gen(function* (_) {
        const index = endpoints.findIndex(endpoint => Equal.equals(endpoint.address, address));
        if (index > -1) {
            endpoints.splice(index, 1);
        }
    });

export const findEndpoint = (address: Address): Effect.Effect<Endpoint, AddressNotFoundError> =>
    Effect.gen(function* (_) {
        const endpoint = endpoints.find(endpoint => Equal.equals(endpoint.address, address));
        if (!endpoint) {
            return yield* _(Effect.fail(new AddressNotFoundError({ address })));
        }
        return endpoint;
    })