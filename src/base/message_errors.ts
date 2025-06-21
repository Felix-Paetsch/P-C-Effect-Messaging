import { AddressAlreadyInUseError, MessageChannelTransmissionError } from "./communication_channel";
import { MessageDeserializationError, MessageSerializationError } from "./message";
import { MiddlewareError } from "./middleware";
import { AddressNotFoundError } from "./kernel_environment/send";
import { EnvironmentInactiveError } from "./environment";

export type MessageTransmissionError =
    MiddlewareError
    | MessageSerializationError
    | AddressNotFoundError
    | AddressAlreadyInUseError
    | MessageChannelTransmissionError
    | MessageDeserializationError
    | EnvironmentInactiveError

export function isMessageTransmissionError(e: Error): e is MessageTransmissionError {
    return e instanceof MiddlewareError ||
        e instanceof MessageSerializationError ||
        e instanceof AddressNotFoundError ||
        e instanceof AddressAlreadyInUseError ||
        e instanceof MessageChannelTransmissionError ||
        e instanceof MessageDeserializationError ||
        e instanceof EnvironmentInactiveError
}