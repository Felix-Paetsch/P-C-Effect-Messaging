import { Effect, Context, Equal, Option } from "effect";
import { MessageT } from "./message";
import { Address } from "./address";

export type LocalComputedMessageData = {
    direction: "incoming" | "outgoing";
    // The path to Kernel is "incoming" the path out from the kernel is "outgoing"
    // If the message is for the kernel at the kernel it is "incoming", else at the kernel it is "outgoing"
    at_target: boolean;
    // Whether the current AddressHandler is the final target of the message
    // If not overwritten by a middleware, this is true only at the kernel if the message is for the kernel

    [key: string]: any;
}

export class LocalComputedMessageDataT extends Context.Tag("LocalComputedMessageDataT")<
    LocalComputedMessageDataT,
    LocalComputedMessageData
>() { }

// The message data for a message that we just sent on its way locally via send()
export const justSentLocalComputedMessageData = Effect.gen(function* (_) {
    const message = yield* _(MessageT);
    return {
        direction: Equal.equals(message.target, Address.local_address) ? "incoming" : "outgoing",
        at_target: Equal.equals(message.target, Address.local_address)
    } as LocalComputedMessageData;
})

// The message data for a message that we are sending with send, 
// building upon the message data of the recieving of the message
const sendRecievedLocalComputedMessageData = Effect.gen(function* (_) {
    const message = yield* _(MessageT);
    const computed_data = yield* _(LocalComputedMessageDataT);
    computed_data.direction = Equal.equals(message.target, Address.local_address)
        ? "incoming" : "outgoing";
    return computed_data;
})

// The message data for a message that we are sending with send, but which may or may not
// build upon the message data of the recieving of the message
export const sendLocalComputedMessageData = Effect.gen(function* (_) {
    const maybeExistingLocalMessageData = yield* Effect.serviceOption(LocalComputedMessageDataT)
    if (Option.isNone(maybeExistingLocalMessageData)) {
        return yield* justSentLocalComputedMessageData;
    }

    return yield* Effect.provideService(
        sendRecievedLocalComputedMessageData,
        LocalComputedMessageDataT,
        maybeExistingLocalMessageData.value
    );
})

// The message data for a message that was just recieved at some communicator
export const justRecievedLocalComputedMessageData = Effect.gen(function* (_) {
    const message = yield* _(MessageT);
    const res: LocalComputedMessageData = {
        direction: "incoming",
        at_target: false
    };
    return res;
})