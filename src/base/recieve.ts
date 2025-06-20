import { Context, Effect, pipe } from "effect";
import { MessageT, TransmittableMessageT } from "./message";
import { Address, AddressT } from "./address";
import { KernelEnv } from "./kernel_environment/index";
import { middlewareEffect, MiddlewareInterrupt } from "./middleware";
import { LocalComputedMessageDataT, justRecievedLocalComputedMessageData } from "./local_computed_message_data";

export class RecieveAddressT extends Context.Tag("RecieveAddressT")<RecieveAddressT, Address>() { }

export const recieve = pipe(
    middlewareEffect,
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
            return yield* KernelEnv.send;
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