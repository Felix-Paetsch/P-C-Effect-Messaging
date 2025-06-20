import { MessageChannelError, NoValidCommunicationChannelsError } from "./communication_channels";
import { MessageDeserializationError, MessageSerializationError } from "./message";
import { MiddlewareError } from "./middleware";
import { AddressNotFoundError } from "./kernel_environment/send";

export type MessageTransmissionError =
    MiddlewareError
    | MessageSerializationError
    | AddressNotFoundError
    | MessageChannelError
    | NoValidCommunicationChannelsError
    | MessageDeserializationError

export function isMessageTransmissionError(e: Error): e is MessageTransmissionError {
    return e instanceof MiddlewareError ||
        e instanceof MessageSerializationError ||
        e instanceof AddressNotFoundError ||
        e instanceof MessageChannelError ||
        e instanceof NoValidCommunicationChannelsError ||
        e instanceof MessageDeserializationError
}