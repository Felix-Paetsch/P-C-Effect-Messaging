import { Effect } from "effect";
import { Address } from "../base/address";
import { Protocol } from "./protocol";
import { is_protocol_error, ProtocolError, ProtocolErrorN } from "./base/protocol_errors";
import { ProtocolMessageT } from "./base/protocol_message";
import { Either } from "effect";
import { ProtocolCommunicationHandlerT } from "./base/communicationHandler";

export class PingProtocol extends Protocol<Either.Either<true, ProtocolError>, void> {
    constructor() {
        super("ping", "ping", "1.0.0");
    }

    run(address: Address) {
        const self = this;
        return Effect.gen(function* (_) {
            yield* yield* self.send_first_message(address, "Ping")
            return true as const;
        }).pipe(
            Effect.mapError(e => {
                if (is_protocol_error(e)) {
                    return e
                }
                return new ProtocolErrorN({
                    message: "ProtocolError",
                    error: e
                });
            }),
            Effect.either
        )
    }

    get on_first_request() {
        return Effect.gen(function* () {
            const ch = yield* ProtocolCommunicationHandlerT;
            yield* ch.close("Pong", true)
        })
    }
}

export const Ping = new PingProtocol();