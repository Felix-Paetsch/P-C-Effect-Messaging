import { Effect } from "effect";
import { Address } from "../../base/address";
import { Environment, EnvironmentT } from "../../base/environment";
import { Middleware } from "../../base/middleware";
import { Json } from "../../utils/json";
import { Protocol } from "../protocol";
import { ProtocolCommunicationHandlerT } from "./communicationHandler";
import { ProtocolError, ProtocolErrorN } from "./protocol_errors";

export function ProtocolRequestHalf<S>(
    ident: {
        protocol_name: string,
        protocol_ident: Json,
        protocol_version: string
    },
    _run: (this: Protocol<S, void>, address: Address, data: Json)
        => Effect.Effect<S, ProtocolError, EnvironmentT> = () => Effect.fail(new ProtocolErrorN({
            message: "Not implemented"
        }))
): Protocol<S, void> {
    class ProtocolRequestHalf extends Protocol<S, void> {
        get on_first_request(): Effect.Effect<void, ProtocolError, ProtocolCommunicationHandlerT> {
            return ProtocolCommunicationHandlerT.pipe(
                Effect.andThen(ch => ch.not_implemented_error())
            );
        }

        run(address: Address, data: Json): Effect.Effect<S, ProtocolError, EnvironmentT> {
            return _run.bind(this)(address, data);
        }

        middleware(env: Environment): Effect.Effect<Middleware, never, never> {
            return super.request_middleware(env);
        }
    }

    return new ProtocolRequestHalf(ident.protocol_name, ident.protocol_ident, ident.protocol_version);
}

export function ProtocolResponseHalf<S>(ident: {
    protocol_name: string,
    protocol_ident: Json,
    protocol_version: string
}, _on_first_request: (this: Protocol<void, S>) => Effect.Effect<void, ProtocolError, ProtocolCommunicationHandlerT>): Protocol<void, S> {
    class ProtocolResponseHalf extends Protocol<void, S> {
        get on_first_request(): Effect.Effect<void, ProtocolError, ProtocolCommunicationHandlerT> {
            return _on_first_request.bind(this)();
        }

        run(address: Address, data: Json): Effect.Effect<S, ProtocolError, EnvironmentT> {
            return Effect.fail(new ProtocolErrorN({
                message: "Not implemented",
                data
            }));
        }

        middleware(env: Environment): Effect.Effect<Middleware, never, never> {
            return super.response_middleware(env);
        }
    }

    return new ProtocolResponseHalf(ident.protocol_name, ident.protocol_ident, ident.protocol_version);
}

export function ProtocolHalfs<S, T>(
    ident: {
        protocol_name: string,
        protocol_ident: Json,
        protocol_version: string
    },
    _on_first_request: () => Effect.Effect<void, ProtocolError, ProtocolCommunicationHandlerT>,
    _run: (address: Address, data: Json) => Effect.Effect<S, ProtocolError, EnvironmentT> = () => Effect.fail(new ProtocolErrorN({
        message: "Not implemented"
    }))
): {
    request: Protocol<S, void>,
    respond: Protocol<void, T>
} {
    return {
        request: ProtocolRequestHalf(ident, _run),
        respond: ProtocolResponseHalf(ident, _on_first_request)
    }
}