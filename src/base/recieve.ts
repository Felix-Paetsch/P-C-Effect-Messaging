import { Context, Effect, pipe } from "effect";
import { Message, MessageT, TransmittableMessageT } from "./message";
import { Address, AddressT } from "./address";
import { applyMiddlewareEffect } from "./apply_middleware_effect";
import { MiddlewareInterrupt } from "./middleware";
import { LocalComputedMessageDataT, justRecievedLocalComputedMessageData } from "./local_computed_message_data";
import { InvalidMessageFormatError, MessageTransmissionError } from "./errors/message_errors";
import { kernel_send } from "./kernel_environment/send";

export class RecieveAddressT extends Context.Tag("RecieveAddressT")<RecieveAddressT, Address>() { }

export const recieve:
    Effect.Effect<void, MessageTransmissionError | InvalidMessageFormatError, RecieveAddressT | TransmittableMessageT> =
    pipe(
        applyMiddlewareEffect,
        Effect.provideServiceEffect(
            AddressT,
            RecieveAddressT
        ),
        Effect.andThen(interupt => {
            if (interupt == MiddlewareInterrupt) {
                return Effect.void;
            }
            return kernel_send;
        }),
        Effect.provideServiceEffect(
            LocalComputedMessageDataT,
            justRecievedLocalComputedMessageData
        ),
        Effect.provideServiceEffect(
            MessageT,
            Effect.gen(function* (_) {
                const msg = yield* _(TransmittableMessageT);
                return yield* msg.message;
            })
        ),
        Effect.catchTag("MessageDeserializationError", (err) =>
            Effect.fail(new InvalidMessageFormatError({
                message: new Message(Address.local_address, ""),
                err: err,
                descr: "The message to recieve had bad format."
            }))
        )
    )