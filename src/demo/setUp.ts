import { Effect, pipe } from "effect";
import { Address, AddressT } from "../base/address";
import { CommunicationChannelT, MessageTransmissionError, registerCommunicationChannel } from "../base/communication_channels";
import { Message, MessageT, SerializedMessage, SerializedMessageT } from "../base/message";
import { send } from "../base/send";
import { UUID } from "../base/uuid";
import { listen, ListenerT } from "../base/listen";

export const addrA = new Address("A" as UUID);
const sendA = Effect.gen(function* (_) {
    const msg = yield* _(SerializedMessageT);
    const des = yield* _(Message.deserialize(msg));
    des.target = Address.local_address();
    const ser = yield* _(des.serialize());
    return recieveA(ser);
}).pipe(Effect.catchAll(e => Effect.fail(new MessageTransmissionError({ err: e }))));

const recieveA = (msg: SerializedMessage) => {
    if (!effectA) throw new Error("effectA is not set");
    Effect.runPromise(effectA.pipe(Effect.provideService(SerializedMessageT, msg)));
};
let effectA: Effect.Effect<void, never, SerializedMessageT> | null = null;

const recieve_cbA = (effect: Effect.Effect<void, never, SerializedMessageT>) => {
    effectA = effect;
};

export const init = registerCommunicationChannel.pipe(
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
)

export const sendMessage = (msg: Message) => {
    return Effect.runPromise(send.pipe(Effect.provideService(MessageT, msg)));
}

export const registerListener = (plain_listen: (msg: Message) => void) => {
    return Effect.runPromise(listen.pipe(
        Effect.provideService(
            ListenerT,
            {
                listen: Effect.gen(function* (_) {
                    const msg = yield* _(MessageT);
                    plain_listen(msg);
                })
            }
        )
    ))
}
