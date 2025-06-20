import { Effect } from "effect";
import { Address } from "../address";
import { Environment } from "../environment";
import { Middleware, MiddlewareConfT, useMiddleware } from "../middleware";
import { kernel_send } from "./send";

export const KernelEnv: Environment = {
    ownAddress: Address.local_address,
    send: kernel_send,
    remove: Effect.void,
    useMiddleware: (middleware: Middleware) => useMiddleware.pipe(
        Effect.provideService(MiddlewareConfT, {
            middleware: middleware,
            address: Address.local_address
        })
    )
}