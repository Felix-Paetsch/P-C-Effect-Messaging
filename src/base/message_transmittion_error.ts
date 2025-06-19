import { MessageChannelError, NoValidCommunicationChannelsError } from "./communication_channels";
import { MessageSerializationError } from "./message";
import { MiddlewareError } from "./middleware";
import { AddressNotFoundError } from "./send";

export type MessageTransmissionError =
    MiddlewareError
    | MessageSerializationError
    | AddressNotFoundError
    | MessageChannelError
    | NoValidCommunicationChannelsError

export function isMessageTransmissionError(e: Error): e is MessageTransmissionError {
    return e instanceof MiddlewareError ||
        e instanceof MessageSerializationError ||
        e instanceof AddressNotFoundError ||
        e instanceof MessageChannelError ||
        e instanceof NoValidCommunicationChannelsError
}