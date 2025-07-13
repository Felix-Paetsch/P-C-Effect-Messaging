import { Data, Effect } from "effect";

export function dangerouslyRunPromise<T>(e: Effect.Effect<T>): Promise<T> {
    return Effect.runPromise(e);
}


export type ErrorResult<Err extends Error> = {
    is_error: true,
    error: Err
}

export type SuccessResult<Res> = {
    is_error: false,
    result: Res
}

export type Result<Res, Err extends Error> = SuccessResult<Res> | ErrorResult<Err>
export type ResultPromise<Res, Err extends Error> = Promise<Result<Res, Err>>

export function EffectAsPromise<T, E extends Error>(e: Effect.Effect<T, E>): () => Promise<Result<T, E>> {
    return () => runEffectAsPromise(e)
}

export function runEffectAsPromise<T, E extends Error>(e: Effect.Effect<T, E>): Promise<Result<T, E>> {
    return Effect.runPromise(e.pipe(
        Effect.map(res => ({ result: res, is_error: false as const })),
        Effect.catchAll(err => Effect.succeed({ is_error: true as const, error: err }))
    ));
}

export function EffectAsPromiseFlash<T, E extends Error>(e: Effect.Effect<T, E>): () => Promise<Result<null, E>> {
    return () => runEffectAsPromiseFlash(e)
}

export function runEffectAsPromiseFlash<T, E extends Error>(e: Effect.Effect<T, E>): Promise<Result<null, E>> {
    return Effect.runPromise(e.pipe(
        Effect.as({ result: null, is_error: false as const }),
        Effect.catchAll(err => Effect.succeed({ is_error: true as const, error: err }))
    ));
}

export function resultToEffect<T, E extends Error>(r: Result<T, E>): Effect.Effect<T, E> {
    if (r.is_error) return Effect.fail(r.error);
    return Effect.succeed(r.result);
}

export class CallbackError extends Data.TaggedError("CallbackError")<{
    error: unknown;
}> { }

function syncCallbackAsEffect<T extends (...args: any[]) => any>(cb: T): (...args: Parameters<T>) => Effect.Effect<ReturnType<T>, CallbackError> {
    return ((...args: Parameters<T>) => Effect.try({
        try: () => {
            return cb(...args);
        },
        catch: (e) => {
            return Effect.fail(new CallbackError({ error: e }));
        }
    })) as (...args: Parameters<T>) => Effect.Effect<ReturnType<T>, CallbackError>;
}

export function callbackAsEffect<T extends (...args: any[]) => any>(
    cb: T
): (...args: Parameters<T>) => Effect.Effect<Awaited<ReturnType<T>>, CallbackError> {
    return (...args: Parameters<T>) =>
        Effect.gen(function* () {
            const res = yield* syncCallbackAsEffect(cb)(...args);
            if ((res as any) instanceof Promise) {
                return yield* Effect.tryPromise({
                    try: () => res,
                    catch: (e) => new CallbackError({ error: e })
                });
            }
            return res;
        }) as Effect.Effect<Awaited<ReturnType<T>>, CallbackError>;
}