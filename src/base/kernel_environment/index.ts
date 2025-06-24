import { Effect } from "effect";
import { Address } from "../address";
import { Environment } from "../environment";
import { Middleware, MiddlewareConfT, useMiddleware } from "../middleware";
import { kernel_send } from "./send";

export const KernelEnv = {
    ownAddress: Address.local_address,
    send: kernel_send.pipe(Effect.catchTag("InvalidMessageFormatError", () => Effect.void)),
    remove: Effect.void,
    useMiddleware: (middleware: Middleware) => useMiddleware.pipe(
        Effect.provideService(MiddlewareConfT, {
            middleware: middleware,
            address: Address.local_address
        }),
        Effect.orDie
    )
} satisfies Environment;