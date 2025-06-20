import { Effect } from "effect";
import { Address } from "../base/address";
import { Protocol, ProtocolError, ProtocolMessageT } from "./protocol";
import { Either } from "effect";

export class PingProtocol extends Protocol<Either.Either<true, ProtocolError>, void> {
    constructor() {
        super("ping", "ping", "1.0.0");
    }

    run(address: Address) {
        return this.send_first_message(address, "Ping").pipe(
            Effect.as(true as const),
            Effect.mapError(e => {
                if (e instanceof ProtocolError) {
                    return e
                }
                return new ProtocolError({
                    message: "ProtocolError",
                    error: e
                });
            }),
            Effect.either
        )
    }

    protected on_first_request = Effect.gen(function* (_) {
        const msg = yield* _(ProtocolMessageT);
        msg.respond("Pong")
    })
}