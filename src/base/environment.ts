import { Context, Data, Effect, Equal, Option } from "effect";
import { MessageT, TransmittableMessageT } from "./message";
import { MessageTransmissionError } from "./message_errors";
import { Address, AddressT } from "./address";
import { Middleware, MiddlewareConfT, useMiddleware } from "./middleware";
import { AddressAlreadyInUseError, CommunicationChannel, CommunicationChannelT, MessageChannelTransmissionError, registerCommunicationChannel } from "./communication_channel";
import { AddressNotFoundError } from "./kernel_environment/send";
import { LocalComputedMessageDataT } from "./local_computed_message_data";

export type Environment = {
    ownAddress: Address;
    send: Effect.Effect<void, MessageTransmissionError | EnvironmentInactiveError, MessageT>;
    remove: Effect.Effect<void, never, never>,
    useMiddleware: (middleware: Middleware) => Effect.Effect<void, AddressNotFoundError | EnvironmentInactiveError, never>
}

export class EnvironmentT extends Context.Tag("EnvironmentT")<EnvironmentT, Environment>() { }
export class EnvironmentInactiveError extends Data.TaggedError("EnvironmentInactiveError")<{
    address: Address;
}> { }

export const createLocalEnvironment = (
    ownAddress: Address,
    onRecieve: Effect.Effect<void, never, MessageT> = Effect.void
): Effect.Effect<Environment, AddressAlreadyInUseError, never> => Effect.gen(function* (_) {
    let on_recieve: Effect.Effect<void, MessageTransmissionError, TransmittableMessageT> = Effect.void;
    let remove_effect: Effect.Effect<void, never, never> = Effect.void;
    let active: boolean = true;
    const guard_is_active = Effect.gen(function* (_) {
        if (!active) {
            return yield* _(Effect.fail(new EnvironmentInactiveError({ address: ownAddress })));
        }
        return yield* _(Effect.void);
    });

    const communication_channel: CommunicationChannel = {
        address: ownAddress,
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

    const send_message = on_recieve.pipe(
        Effect.provideServiceEffect(TransmittableMessageT, MessageT.pipe(
            Effect.map(msg => msg.as_transmittable())
        ))
    );

    const res = {
        ownAddress,
        send: guard_is_active.pipe(Effect.andThen(() => send_message)),
        remove: remove_effect.pipe(Effect.andThen(() => {
            active = false;
        })),
        useMiddleware: (middleware: Middleware) => guard_is_active.pipe(
            Effect.andThen(() => useMiddleware.pipe(
                Effect.provideService(MiddlewareConfT, {
                    middleware: middleware,
                    address: ownAddress
                })
            ))
        )
    }

    yield* res.useMiddleware(set_at_target_middleware(ownAddress)).pipe(Effect.orDie);
    return res;
});

const set_at_target_middleware = (address: Address): Middleware => Effect.gen(function* (_) {
    const message = yield* _(MessageT);
    const local_computed_message_data = yield* _(LocalComputedMessageDataT);
    if (Equal.equals(message.target, address)) {
        local_computed_message_data.at_target = true;
    }
})
