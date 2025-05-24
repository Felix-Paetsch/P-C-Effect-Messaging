import { Context, Data, Effect, Equal, pipe, Schema } from "effect";
import Message, { MessageT, SerializedMessage } from "./message";
import Address, { AddressT } from "./address";
import { UUID } from "./utils/uuid";

class MiddlewareError extends Data.TaggedError("MiddlewareError")<{ err: Error }> { }
type Middleware = Effect.Effect<never, MiddlewareError, MessageT | LocalMessageDataT>;
type MiddlewarePosition = "MSG_IN" | "MSG_OUT" | "ALL";
type RegisteredMiddleware = {
    position: MiddlewarePosition;
    middleware: Middleware;
};

class MiddlewareT extends Context.Tag("MiddlewareT")<MiddlewareT, {
    middleware: Middleware;
}>() { }

type Listener = any;
class ListenerT extends Context.Tag("ListenerT")<ListenerT, {
    listener: Listener;
}>() { }

class MessageTransmissionError extends Data.TaggedError("MessageTransmissionError")<{ err: Error }> { }

type TryCommunicationChannelsResult =
    Effect.Effect<never, NoValidCommunicationChannelsError | MessageChannelError, SerializedMessageT | AddressT>
class MessageChannelError extends Data.TaggedError("MessageChannelError")<{
    err: Error,
    try_next: TryCommunicationChannelsResult
}> { }
class SerializedMessageT extends Context.Tag("SerializedMessageT")<SerializedMessageT, {
    serialized: SerializedMessage;
}>() { }

class MiddlewarePositionT extends Context.Tag("MiddlewarePositionT")<MiddlewarePositionT, {
    position: MiddlewarePosition;
}>() { }

type InCommunicationChannel = {
    direction: "IN" | "INOUT";
    recieve_cb: (recieve_effect: Effect.Effect<never, never, SerializedMessageT>) => void;
}

type OutCommunicationChannel = {
    direction: "OUT" | "INOUT";
    send: Effect.Effect<never, MessageTransmissionError, SerializedMessageT>;
}

type CommunicationChannel = InCommunicationChannel | OutCommunicationChannel;
class CommunicationChannelT extends Context.Tag("CommunicationChannelT")<CommunicationChannelT, {
    communicationChannel: CommunicationChannel;
}>() { }

type Endpoint = {
    address: Address;
    communicationChannels: any[];
    middlewares: RegisteredMiddleware[];
}

const endpoints: Endpoint[] = [];

const findOrCreateEndpoint = (address: Address): Endpoint => {
    const endpoint = endpoints.find(endpoint => Equal.equals(endpoint.address, address));
    if (endpoint) {
        return endpoint;
    }
    const new_endpoint = {
        address,
        communicationChannels: [],
        middlewares: []
    };
    endpoints.push(new_endpoint);
    return new_endpoint;
}

const useMiddleware = Effect.gen(function* (_) {
    const { middleware } = yield* _(MiddlewareT);
    const { address } = yield* _(AddressT);
    const { position } = yield* _(MiddlewarePositionT);

    const endpoint = findOrCreateEndpoint(address);

    endpoint.middlewares.push({
        middleware,
        position
    });

    return yield* _(Effect.never);
});

const middlewareEffect = (position: MiddlewarePosition) =>
    Effect.gen(function* (_) {
        const { msg } = yield* _(MessageT);
        const address = msg.target;
        const endpoint = findOrCreateEndpoint(address);

        const relevant_middleware = endpoint.middlewares.filter(
            m => m.position == position || m.position == "ALL"
        ).map(m => m.middleware);

        for (const middleware of relevant_middleware) {
            yield* _(middleware);
        }

        return yield* _(Effect.never);
    });

const coreMiddlewareEffect = (position: MiddlewarePosition) =>
    Effect.provideService(
        middlewareEffect(position),
        AddressT,
        { address: Address.local_address() }
    );

class RecieveAddressT extends Context.Tag("RecieveAddressT")<RecieveAddressT, {
    address: Address;
}>() { }

const registerCommunicationChannel = Effect.gen(function* (_) {
    const { address } = yield* _(AddressT);
    const { communicationChannel } = yield* _(CommunicationChannelT);

    const endpoint = findOrCreateEndpoint(address);
    endpoint.communicationChannels.push(communicationChannel);
    if (communicationChannel.direction == "IN" || communicationChannel.direction == "INOUT") {
        (communicationChannel as InCommunicationChannel).recieve_cb(
            Effect.provideService(recieve, RecieveAddressT, { address: address }).pipe(
                Effect.catchAll(e => {
                    return ProcessAMessageThatWasRecievedAndThrew
                }),
                Effect.andThen(Effect.never)
            )
        )
    }

    return yield* _(Effect.never);
});

class AddressAlreadyInUseError extends Data.TaggedError("AddressAlreadyInUseError")<{
    address: Address;
}> { }

const setLocalHostId = (local_host_id: UUID) => Effect.gen(function* (_) {
    const local_address = Address.local_address();
    const new_address = new Address(local_host_id, "core" as UUID);

    for (const endpoint of endpoints) {
        if (Equal.equals(endpoint.address, new_address)) {
            return yield* _(Effect.fail(new AddressAlreadyInUseError({
                address: new_address
            })));
        }
    }

    const old_endpoint = findOrCreateEndpoint(local_address);
    Address._setLocalHostId(local_host_id);
    old_endpoint.address = Address.local_address();

    return yield* _(Effect.never);
});

class AddressNotFoundError extends Data.TaggedError("AddressNotFoundError")<{
    address: Address;
}> { }

class LocalMessageDataT extends Context.Tag("LocalMessageDataT")<
    LocalMessageDataT,
    {
        local_address: Address;
        direction: "outgoing" | "incomming";
        is_bridge: boolean;
    }
>() { }

const computeLocalMessageData: Effect.Effect<Context.Tag.Service<LocalMessageDataT>, never, MessageT>
    = Effect.gen(function* (_) {
        const { msg } = yield* _(MessageT);
        return {
            local_address: Address.local_address(),
            direction: "outgoing",
            is_bridge: false
        };
    })

const ProcessAMessageThatTargetedCore = Effect.never;
const ProcessAMessageThatWasRecievedAndThrew = Effect.never;
class NoValidCommunicationChannelsError extends Data.TaggedError("NoValidCommunicationChannelsError")<{
    address: Address;
}> { }

const send = Effect.gen(function* (_) {
    const { msg } = yield* _(MessageT);
    const { address } = yield* _(AddressT);

    const { direction } = yield* _(LocalMessageDataT);
    const communication_channels = yield* CommunicationChannels;
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
            TryCommunicationChannels(communication_channels, serialized_message, address),
            SerializedMessageT,
            { serialized: serialized_message }
        )
    );
}).pipe(
    Effect.provideServiceEffect(
        LocalMessageDataT,
        computeLocalMessageData
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

const recieve_in = middlewareEffect("MSG_IN").pipe(
    Effect.provideServiceEffect(
        LocalMessageDataT,
        computeLocalMessageData
    ),
    Effect.provideServiceEffect(
        AddressT,
        RecieveAddressT
    )
)

const recieve = pipe(
    recieve_in.pipe(
        Effect.andThen(send),
        Effect.provideServiceEffect(
            AddressT,
            Effect.gen(function* (_) {
                const { msg } = yield* _(MessageT);
                return yield* Effect.succeed({
                    address: msg.target
                });
            })
        ),
        Effect.provideServiceEffect(
            LocalMessageDataT,
            computeLocalMessageData
        )
    ),
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

middlewareEffect("MSG_IN").pipe(
    Effect.provideServiceEffect(
        LocalMessageDataT,
        computeLocalMessageData
    ),
    Effect.provideServiceEffect(
        MessageT,
        Effect.gen(function* (_) {
            const { serialized } = yield* _(SerializedMessageT);
            const message = yield* Message.deserialize(serialized as SerializedMessage);
            return {
                msg: message
            }
        })
    )
)

const TryCommunicationChannels =
    (
        communication_channels: OutCommunicationChannel[],
        serialized_message: string,
        address: Address
    ): TryCommunicationChannelsResult => {
        return Effect.gen(function* (_) {
            if (communication_channels.length == 0) {
                return yield* _(Effect.fail(new NoValidCommunicationChannelsError({
                    address: address
                })));
            }

            const new_channel = communication_channels.shift()!;
            return yield* _(Effect.provideService(
                new_channel.send, SerializedMessageT, { serialized: serialized_message as SerializedMessage })
            );
        }).pipe(
            Effect.catchTag("MessageTransmissionError", (e) => {
                return Effect.fail(new MessageChannelError({
                    err: e,
                    // Note we popped one already
                    try_next: TryCommunicationChannels(communication_channels, serialized_message, address)
                }))
            })
        );
    }

const CommunicationChannels = Effect.gen(function* (_) {
    const { address } = yield* _(AddressT);
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
})

const listen = Effect.gen(function* (_) {
    const { address } = yield* _(AddressT);
});
