import { Effect } from "effect";
import { Address } from "../base/address";
import { is_protocol_error, Protocol, ProtocolError, ProtocolErrorN, ProtocolMessageT } from "./protocol";
import { Either } from "effect";

export class PingProtocol extends Protocol<Either.Either<true, ProtocolError>, void> {
    constructor() {
        super("ping", "ping", "1.0.0");
    }

    run(address: Address) {
        const self = this;
        return Effect.gen(function* (_) {
            const res = yield* self.send_first_message(address, "Ping")

            return yield* res.pipe(
                Effect.as(true as const)
            )
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

    protected on_first_request = Effect.gen(function* (_) {
        const msg = yield* _(ProtocolMessageT);
        yield* msg.respond("Pong").pipe(
            Effect.ignore
        );
    })
}

export const Ping = new PingProtocol();