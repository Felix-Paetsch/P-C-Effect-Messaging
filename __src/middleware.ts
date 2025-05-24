import { Data, Effect } from "effect";
import { MessageT } from "./message";

export class MiddlewareError extends Data.TaggedError("MiddlewareError")<{ err: Error }> { }
export type Middleware = Effect.Effect<never, MiddlewareError, MessageT>;
