import { Context, Data, Effect, Option } from "effect";
import { MessageT, TransmittableMessageT } from "./message";
import { MessageTransmissionError } from "./errors/message_errors";
import { Address, AddressT } from "./address";
import { Middleware, MiddlewareConfT, useMiddleware } from "./middleware";
import { AddressAlreadyInUseError, CommunicationChannel, CommunicationChannelT, MessageChannelTransmissionError, registerCommunicationChannel } from "./communication_channel";
import { LocalComputedMessageDataT } from "./local_computed_message_data";
import { AddressNotFoundError } from "./kernel_environment/send";

/** 
 * Allows to interact with the messaging system via a designated node for message sending and receiving 
 */
export type Environment = {
    /** The address of the environment */
    ownAddress: Address;
    /** From the outside world "inside out env" send a message to the system */
    send: Effect.Effect<void, AddressNotFoundError | MessageChannelTransmissionError | EnvironmentInactiveError, MessageT>;
    /** Remove the environment from the system */
    remove: Effect.Effect<void, never, never>,
    /** Use a middleware on the environment address */
    useMiddleware: (middleware: Middleware) => Effect.Effect<void, EnvironmentInactiveError, never>
}

export class EnvironmentT extends Context.Tag("EnvironmentT")<EnvironmentT, Environment>() { }
export class EnvironmentInactiveError extends Data.TaggedError("EnvironmentInactiveError")<{
    address: Address;
}> { }

/**
 * Creates a local environment for message handling
 * @param ownAddress - The address of the environment
 * @param onRecieve - What to do when the message system has a message for this environment
 * @returns Effect that creates an Environment
 */
export const createLocalEnvironment = (
    ownAddress: Address,
    onMessageForOutsideWorld: Effect.Effect<void, never, MessageT> = Effect.void
): Effect.Effect<Environment, AddressAlreadyInUseError, never> => Effect.gen(function* (_) {
    let _onMessageForKernelRecieved: Effect.Effect<void, AddressNotFoundError | MessageChannelTransmissionError, TransmittableMessageT> = Effect.void;
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
        send: onMessageForOutsideWorld.pipe(
            Effect.provideServiceEffect(MessageT, TransmittableMessageT.pipe(
                Effect.flatMap(msg => msg.message)
            )),
            Effect.mapError(err => new MessageChannelTransmissionError({ err }))
        ),
        recieve_cb: (onMessageForKernelRecieved: Effect.Effect<Option.Option<MessageTransmissionError>, never, TransmittableMessageT>) => {
            const new_recieve_effect = onMessageForKernelRecieved.pipe(
                Effect.andThen(op => op.pipe(
                    Option.match({
                        onNone: () => Effect.void,
                        onSome: (value) => Effect.fail(value)
                    })
                ))
            );
            _onMessageForKernelRecieved = new_recieve_effect;
        },
        remove_cb: (_remove_effect: Effect.Effect<void, never, never>) => {
            remove_effect = _remove_effect;
        }
    }

    yield* registerCommunicationChannel.pipe(
        Effect.provideService(AddressT, ownAddress),
        Effect.provideService(CommunicationChannelT, communication_channel)
    ).pipe(
        Effect.catchTag("CallbackRegistrationError", (e) => Effect.die(e))
    );

    const res = {
        ownAddress,
        send: guard_is_active.pipe(
            Effect.andThen(_onMessageForKernelRecieved),
            Effect.provideServiceEffect(TransmittableMessageT, MessageT.pipe(
                Effect.map(msg => msg.as_transmittable())
            ))
        ),
        remove: remove_effect.pipe(Effect.andThen(() => {
            active = false;
        })),
        useMiddleware: (middleware: Middleware) => guard_is_active.pipe(
            Effect.andThen(() => useMiddleware.pipe(
                Effect.provideService(MiddlewareConfT, {
                    middleware: middleware,
                    address: ownAddress
                })
            )),
            Effect.orElse(() => remove_effect.pipe(
                Effect.andThen(
                    () => Effect.fail(new EnvironmentInactiveError({ address: ownAddress }))
                )
            ))
        )
    }

    yield* res.useMiddleware(at_target_middleware).pipe(Effect.orDie);
    yield* res.useMiddleware(at_source_middleware).pipe(Effect.orDie);
    return res;
});

const at_source_middleware = Effect.gen(function* (_) {
    const local_computed_message_data = yield* _(LocalComputedMessageDataT);
    // Note that direction is from the perspective of the kernel
    if (local_computed_message_data.direction === "incoming") {
        local_computed_message_data.at_source = true;
    }
})

const at_target_middleware = Effect.gen(function* (_) {
    const local_computed_message_data = yield* _(LocalComputedMessageDataT);
    if (local_computed_message_data.direction === "outgoing") {
        local_computed_message_data.at_target = true;
    }
})
