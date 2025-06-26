import { Effect, Context, Equal, Option } from "effect";
import { MessageT } from "./message";
import { Address } from "./address";

/** 
 * Represents locally computed data about a message's state and routing
 */
export type LocalComputedMessageData = {
    /** 
     * The direction of message flow relative to the kernel
     * - "incoming": path to Kernel or at kernel for kernel-targeted messages
     * - "outgoing": path from kernel
     */
    direction: "incoming" | "outgoing";
    /** 
     * Whether the current address processor is the final target of the message.
     * If not overwritten by middleware, this is true only at the kernel if the message is for the kernel
     */
    at_target: boolean;
    /**
     * Whether the current address processor is the source of the message.
     */
    at_source: boolean;

    [key: string]: any;
}

export class LocalComputedMessageDataT extends Context.Tag("LocalComputedMessageDataT")<
    LocalComputedMessageDataT,
    LocalComputedMessageData
>() { }

/**
 * Creates message data for a message that was just sent locally via send()
 * @returns Effect producing LocalComputedMessageData
 */
export const justSentLocalComputedMessageData = Effect.gen(function* (_) {
    const message = yield* _(MessageT);
    return {
        direction: Equal.equals(message.target, Address.local_address) ? "incoming" : "outgoing",
        at_target: Equal.equals(message.target, Address.local_address),
        at_source: true
    } as LocalComputedMessageData;
})

/**
 * Creates message data for a message being sent, building upon the data from message receipt
 * @returns Effect producing LocalComputedMessageData
 */
const sendRecievedLocalComputedMessageData = Effect.gen(function* (_) {
    const message = yield* _(MessageT);
    const computed_data = yield* _(LocalComputedMessageDataT);
    computed_data.direction = Equal.equals(message.target, Address.local_address)
        ? "incoming" : "outgoing";
    computed_data.at_source = false;
    return computed_data;
})

/**
 * Creates message data for a message being sent, optionally building upon existing receipt data
 * @returns Effect producing LocalComputedMessageData
 */
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

/**
 * Creates message data for a message that was just received at a communicator
 * @returns Effect producing LocalComputedMessageData
 */
export const justRecievedLocalComputedMessageData = Effect.gen(function* (_) {
    const res: LocalComputedMessageData = {
        direction: "incoming",
        at_target: false,
        at_source: false
    };
    return res;
});

/**
 * Updates existing LocalComputedMessageData with new properties
 * @param updates - Partial LocalComputedMessageData to merge with existing data
 * @returns Function that takes a program and provides it with updated message data
 */
export const localComputedMessageDataWithUpdates = (updates: Partial<LocalComputedMessageData>) =>
    <A, B, C>(program: Effect.Effect<A, B, C>) => Effect.provideServiceEffect(
        program,
        LocalComputedMessageDataT,
        Effect.gen(
            function* (_) {
                const data = yield* _(LocalComputedMessageDataT);
                return { ...data, ...updates };
            }
        )
    )