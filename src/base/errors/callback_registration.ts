import { Data } from "effect";

export class CallbackRegistrationError extends Data.TaggedError("CallbackRegistrationError")<{
    message: string;
    error: Error;
}> { }