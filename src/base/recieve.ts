import { Context, Effect, pipe } from "effect";
import { Promisify } from "../utils/promisify";
import { Address, AddressT } from "./address";
import { applyMiddlewareEffect } from "./apply_middleware_effect";
import { InvalidMessageFormatError } from "./errors/message_errors";
import { kernel_send } from "./kernel_environment/send";
import { LocalComputedMessageDataT, justRecievedLocalComputedMessageData } from "./local_computed_message_data";
import { Message, MessageT, TransmittableMessageT } from "./message";
import { MiddlewareInterrupt } from "./middleware";

export class RecieveAddressT extends Context.Tag("RecieveAddressT")<RecieveAddressT, Address>() { }

export const recieve:
    Effect.Effect<void, void, RecieveAddressT | TransmittableMessageT> =
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
            Effect.gen(function* () {
                const msg = yield* TransmittableMessageT;
                return yield* msg.message;
            })
        ),
        Effect.catchTag("MessageDeserializationError", (err) =>
            Effect.fail(new InvalidMessageFormatError({
                Message: new Message(Address.local_address, ""),
                error: err,
                data: "The message to recieve had bad format."
            }))
        ),
        Effect.catchAll(e => Effect.gen(function* () {
            return yield* Effect.void;
        })),
        Promisify
    )