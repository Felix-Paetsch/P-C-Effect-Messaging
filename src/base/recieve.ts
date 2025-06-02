import { Context, Effect, pipe } from "effect";
import { Message, MessageT, SerializedMessageT, TransmittableMessageT } from "./message";
import { Address, AddressT } from "./address";
import { send } from "./send";
import { middlewareEffect, MiddlewareInterrupt } from "./middleware";
import { LocalComputedMessageDataT, justRecievedLocalComputedMessageData } from "./local_computed_message_data";

export class RecieveAddressT extends Context.Tag("RecieveAddressT")<RecieveAddressT, Address>() { }

export const recieve = pipe(
    middlewareEffect("MSG_IN"),
    Effect.provideServiceEffect(
        AddressT,
        RecieveAddressT
    ),
    Effect.provideServiceEffect(
        LocalComputedMessageDataT,
        justRecievedLocalComputedMessageData
    ),
    (c) => Effect.gen(function* (_) {
        const interrupt = yield* _(c);
        if (interrupt == MiddlewareInterrupt) {
            return yield* _(Effect.void);
        } else {
            return yield* send;
        }
    }),
    Effect.provideServiceEffect(
        MessageT,
        Effect.gen(function* (_) {
            const msg = yield* _(TransmittableMessageT);
            return yield* msg.message;
        })
    )
)