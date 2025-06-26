import { Data } from "effect";
import { MessageChannelTransmissionError } from "../communication_channel";
import { AddressNotFoundError } from "../kernel_environment/send";
import { Message } from "../message";

export type MessageTransmissionError =
    AddressNotFoundError
    | MessageChannelTransmissionError

export function isMessageTransmissionError(e: Error): e is MessageTransmissionError {
    return e instanceof AddressNotFoundError ||
        e instanceof MessageChannelTransmissionError
}

export class InvalidMessageFormatError extends Data.TaggedError("InvalidMessageFormatError")<{
    message: Message,
    err: Error,
    descr: string
}> { }