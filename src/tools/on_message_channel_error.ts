import { Effect } from "effect";
import { MessageChannelError, NoValidCommunicationChannelsError } from "../base/communication_channels";

type PrePossibleErrors<B> = B | NoValidCommunicationChannelsError | MessageChannelError
type PostPossibleErrors<B> = Exclude<PrePossibleErrors<B>, MessageChannelError>

const _onErrorRetryWithOtherCommunicationChannels = <B, C>(
    effect: Effect.Effect<any, PrePossibleErrors<B>, C>
): Effect.Effect<void, PrePossibleErrors<B>, C> =>
    effect.pipe(
        Effect.catchTag(
            "MessageChannelError",
            (err: any) =>
                err.try_next.pipe(
                    onErrorRetryWithOtherCommunicationChannels
                ) as Effect.Effect<void, PostPossibleErrors<B>, C>
        )
    );

export const onErrorRetryWithOtherCommunicationChannels = <B, C>(
    effect: Effect.Effect<any, PrePossibleErrors<B>, C>
) =>
    _onErrorRetryWithOtherCommunicationChannels(effect) as Effect.Effect<
        void,
        Exclude<B, MessageChannelError> | NoValidCommunicationChannelsError,
        C
    >;