import { Context, Effect } from "effect";
import Address from "./address";
import { MessageT } from "./message";
import { Middleware, MiddlewareError } from "./middleware";


export class SerializedMessageT extends Context.Tag("SerializedMessageT")<
    SerializedMessageT,
    { readonly serialized: string }
>() { }

export interface InCommunicationProvider {
    // Run this effect when a message is incoming
    readonly register_recieve_cb: (recieve_effect: Effect.Effect<never, MiddlewareError, SerializedMessageT>) => void;
    // The CommunicationProvider calls the "on_close" callback when the communicator should be removed from the system
    readonly register_close_cb: (on_close: () => void) => void;
}

export interface OutCommunicationProvider {
    readonly send: Effect.Effect<never, MiddlewareError, MessageT>;
    readonly register_close_cb: (on_close: () => void) => void;
}

export type CommunicationProvider =
    InCommunicationProvider
    | OutCommunicationProvider
    | (InCommunicationProvider & OutCommunicationProvider)

export interface ICommunicator {
    get_address(): Address;
    readonly communication_provider: CommunicationProvider;
}

export class CommunicatorT extends Context.Tag("CommunicatorT")<
    CommunicatorT,
    { readonly communicator: Communicator }
>() { }

type MiddlewarePosition = "MSG_IN" | "MSG_OUT" | "ALL";

export class Communicator implements ICommunicator {
    protected address: Address;
    readonly communication_provider: CommunicationProvider;

    private middleware: {
        middleware: Middleware;
        position: MiddlewarePosition;
    }[] = [];

    constructor(address: Address, communication_provider: CommunicationProvider) {
        this.address = address;
        this.communication_provider = communication_provider;
    }

    _middleware_effect(position: MiddlewarePosition) {
        const relevant_middleware = this.middleware.filter(m => m.position == position || m.position == "ALL").map(m => m.middleware);
        return Effect.gen(function* (_) {
            for (const middleware of relevant_middleware) {
                yield* _(middleware);
            }
            return yield* _(Effect.never);
        });
    }

    get_address() {
        return this.address;
    }

    use(middleware: Middleware, position: MiddlewarePosition = "ALL") {
        this.middleware.push({
            middleware,
            position
        });
    }

    remove_middleware(middleware: Middleware) {
        this.middleware = this.middleware.filter(m => m.middleware !== middleware);
    }
}