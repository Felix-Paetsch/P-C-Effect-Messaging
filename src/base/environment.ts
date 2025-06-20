import { Context, Effect, Option } from "effect";
import { MessageT, TransmittableMessageT } from "./message";
import { MessageTransmissionError } from "./message_errors";
import { Address, AddressT } from "./address";
import { Middleware, MiddlewareConfT, useMiddleware } from "./middleware";
import { CommunicationChannel, CommunicationChannelT, MessageChannelTransmissionError, registerCommunicationChannel } from "./communication_channels";

export type Environment = {
    ownAddress: Address;
    send: Effect.Effect<void, MessageTransmissionError, MessageT>;
    remove: Effect.Effect<void, never, never>,
    useMiddleware: (middleware: Middleware) => Effect.Effect<void, never, never>
}

export class EnvironmentT extends Context.Tag("EnvironmentT")<EnvironmentT, Environment>() { }

export const createEnvironment = (
    ownAddress: Address,
    onRecieve: Effect.Effect<void, never, MessageT>
): Effect.Effect<Environment, never, never> => Effect.gen(function* (_) {
    let on_recieve: Effect.Effect<void, MessageTransmissionError, TransmittableMessageT> | null = null;
    let remove_effect: Effect.Effect<void, never, never> | null = null;

    const communication_channel: CommunicationChannel = {
        direction: "INOUT",
        send: onRecieve.pipe(
            Effect.provideServiceEffect(MessageT, TransmittableMessageT.pipe(
                Effect.flatMap(msg => msg.message)
            )),
            Effect.mapError(err => new MessageChannelTransmissionError({ err }))
        ),
        recieve_cb: (_on_recieve: Effect.Effect<Option.Option<MessageTransmissionError>, never, TransmittableMessageT>) => {
            const new_recieve_effect = _on_recieve.pipe(
                Effect.andThen(op => op.pipe(
                    Option.match({
                        onNone: () => Effect.void,
                        onSome: (value) => Effect.fail(value)
                    })
                ))
            );
            on_recieve = new_recieve_effect;
        },
        remove_cb: (_remove_effect: Effect.Effect<void, never, never>) => {
            remove_effect = _remove_effect;
        }
    }

    yield* registerCommunicationChannel.pipe(
        Effect.provideService(AddressT, ownAddress),
        Effect.provideService(CommunicationChannelT, communication_channel)
    ).pipe(Effect.orDie);

    const send_message = (on_recieve as any as Effect.Effect<void, MessageTransmissionError, TransmittableMessageT>).pipe(
        Effect.provideServiceEffect(TransmittableMessageT, MessageT.pipe(
            Effect.map(msg => msg.as_transmittable())
        ))
    );

    return {
        ownAddress,
        send: send_message,
        remove: remove_effect ?? Effect.never,
        useMiddleware: (middleware: Middleware) => useMiddleware.pipe(
            Effect.provideService(MiddlewareConfT, {
                middleware: middleware,
                address: ownAddress
            })
        )
    }
})