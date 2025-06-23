import { Data } from "effect";

export class CallbackRegistrationError extends Data.TaggedError("CallbackRegistrationError")<{
    err: Error;
}> { }