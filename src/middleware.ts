import { Effect } from "effect";
import { MessageT } from "./message";

export type MiddlewareError = Error;
export type Middleware = Effect.Effect<never, MiddlewareError, MessageT>;
