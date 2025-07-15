import { Effect } from "effect";

export function Promisify<R>(e: Effect.Effect<void, never, R>) {
    return Effect.gen(function* () {
        yield* Effect.fork(e)
        yield* Effect.sleep("10 millis");
        return yield* Effect.void;
    })
}