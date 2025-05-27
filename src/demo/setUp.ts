import { Effect, pipe } from "effect";
import { Address, AddressT } from "../base/address";
import { CommunicationChannelT, registerCommunicationChannel } from "../base/communication_channels";
import { Message, MessageT, SerializedMessage, SerializedMessageT } from "../base/message";
import { send } from "../base/send";

export const addrA = new Address();
export const addrB = new Address();
const sendA = Effect.gen(function* (_) {
    const msg = yield* _(SerializedMessageT);
    recieveB(msg);
    return yield* Effect.never;
});
const sendB = Effect.gen(function* (_) {
    const msg = yield* _(SerializedMessageT);
    recieveA(msg);
    return yield* Effect.never;
});
const recieveA = (msg: SerializedMessage) => {
    console.log("Recieved A: ", msg);
    if (!effectA) throw new Error("effectA is not set");
    Effect.runPromise(effectA.pipe(Effect.provideService(SerializedMessageT, msg)));
};
const recieveB = (msg: SerializedMessage) => {
    console.log("Recieved B: ", msg);
    if (!effectB) throw new Error("effectB is not set");
    Effect.runPromise(effectB.pipe(Effect.provideService(SerializedMessageT, msg)));
};

let effectA: Effect.Effect<never, never, SerializedMessageT> | null = null;
let effectB: Effect.Effect<never, never, SerializedMessageT> | null = null;

const recieve_cbA = (effect: Effect.Effect<never, never, SerializedMessageT>) => {
    effectA = effect;
};
const recieve_cbB = (effect: Effect.Effect<never, never, SerializedMessageT>) => {
    effectB = effect;
};

export const init = pipe(
    registerCommunicationChannel.pipe(
        Effect.provideService(
            CommunicationChannelT,
            {
                direction: "INOUT",
                send: sendA,
                recieve_cb: recieve_cbA,
            }
        ),
        Effect.provideService(
            AddressT,
            addrA
        )
    ),

    Effect.andThen(
        registerCommunicationChannel.pipe(
            Effect.provideService(
                CommunicationChannelT,
                {
                    direction: "INOUT",
                    send: sendB,
                    recieve_cb: recieve_cbB,
                }
            ),
            Effect.provideService(
                AddressT,
                addrB
            )
        )
    )
)

export const sendMessage = (msg: Message) => {
    return Effect.runPromise(send.pipe(Effect.provideService(MessageT, msg)));
}
