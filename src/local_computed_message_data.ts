import { Effect, Context, Equal, Option } from "effect";
import { MessageT } from "./message";
import { Address } from "./address";

export type LocalComputedMessageData = {
    direction: "incomming" | "outgoing";
    is_bridge: boolean;
    [key: string]: any;
}

export class LocalComputedMessageDataT extends Context.Tag("LocalComputedMessageDataT")<
    LocalComputedMessageDataT,
    LocalComputedMessageData
>() { }

export const justSendLocalComputedMessageData = Effect.gen(function* (_) {
    const message = yield* _(MessageT);
    return {
        direction: Equal.equals(message.target, Address.local_address()) ? "incomming" : "outgoing",
        is_bridge: false
    } as LocalComputedMessageData;
})

const sendRecievedLocalComputedMessageData = Effect.gen(function* (_) {
    const message = yield* _(MessageT);
    const computed_data = yield* _(LocalComputedMessageDataT);
    computed_data.direction = Equal.equals(message.target, Address.local_address())
        ? "incomming" : "outgoing";
    return computed_data;
})

export const sendLocalComputedMessageData = Effect.gen(function* (_) {
    const maybeExistingLocalMessageData = yield* Effect.serviceOption(LocalComputedMessageDataT)
    if (Option.isNone(maybeExistingLocalMessageData)) {
        return yield* justSendLocalComputedMessageData;
    }

    return yield* Effect.provideService(
        sendRecievedLocalComputedMessageData,
        LocalComputedMessageDataT,
        maybeExistingLocalMessageData.value
    );
})

export const justRecievedLocalComputedMessageData = Effect.gen(function* (_) {
    const message = yield* _(MessageT);
    return {
        direction: "incomming",
        is_bridge: !Equal.equals(message.target.primary_id, Address.local_address().primary_id)
    } as LocalComputedMessageData;
})