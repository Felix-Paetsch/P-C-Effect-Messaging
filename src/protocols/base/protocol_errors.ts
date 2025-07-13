import { Data, Effect, Schema, pipe } from "effect"
import { Json } from "../../utils/json";
import { ProtocolMessage } from "./protocol_message";

export class ProtocolErrorN extends Data.TaggedError("ProtocolError")<{
    message: string;
    error?: Error;
    data?: Json;
    Message?: ProtocolMessage;
}> {
    constructor(args: {
        message: string,
        data?: Json,
        error?: Error,
        Message?: ProtocolMessage
    }) {
        if (args.error instanceof ProtocolErrorR) {
            return new ProtocolErrorR({
                message: args.message || args.error.message,
                error: args.error.error,
                data: args.data || args.error.data,
                Message: args.error.Message || args.error.Message!
            });
        }
        super(args);
    }

    serialize() {
        return Schema.encodeSync(ProtocolErrorN.ProtocolErrorFromJson)(this);
    }

    to_protocolErrorR(protocol_message: ProtocolMessage) {
        return new ProtocolErrorR({
            message: this.message,
            error: this.error,
            data: this.data,
            Message: protocol_message
        })
    }

    static ProtocolErrorFromJson = Schema.transform(
        Schema.Struct({
            message: Schema.String,
            data: Schema.optionalWith(Schema.Any, { default: () => null })
        }),
        Schema.instanceOf(ProtocolErrorN), {
        decode: (serialized) =>
            new ProtocolErrorN({
                message: serialized.message,
                data: serialized.data as Json
            }),
        encode: (msg: ProtocolErrorN) =>
        ({
            message: msg.message,
            data: msg.data || null
        })
    });

    static throwIfRespondedWithError = (protocol_message: ProtocolMessage) => Effect.gen(function* () {
        if (!(protocol_message.meta_data.protocol as any).is_error) {
            return yield* Effect.void;
        }

        return yield* Schema.decodeUnknown(ProtocolErrorN.ProtocolErrorFromJson)(protocol_message.data).pipe(
            Effect.catchAll(e => Effect.fail(new ProtocolErrorN({
                message: "Invalid response error format",
                error: e
            }))),
            Effect.andThen(e => Effect.fail(e))
        )
    })
}

export class ProtocolErrorR extends ProtocolErrorN {
    constructor(args: {
        message: string,
        data?: Json,
        error?: Error,
        Message: ProtocolMessage
    }) {
        super(args);
        if (this.Message && !this.Message.has_responded) {
            this.Message.respond_error(this).pipe(
                Effect.runPromise
            );
        }
    }

    to_protocolErrorR() {
        return this;
    }
}

export type ProtocolError = ProtocolErrorR | ProtocolErrorN

export function is_protocol_error(e: any): e is ProtocolError {
    return e instanceof ProtocolErrorN
}

export const fail_as_protocol_error = Effect.mapError(e => {
    if (is_protocol_error(e)) {
        return e;
    }

    let message = "An error occurred";
    if (typeof (e as any)?.message === "string") {
        message = (e as any)?.message;
    }

    let error = new Error(message);
    if (e instanceof Error) {
        error = e;
    }

    return new ProtocolErrorN({ message, error })
})

export const fail_with_response = <A, R>(e: Effect.Effect<A, unknown, R>, protocol_message: ProtocolMessage) => pipe(
    e,
    fail_as_protocol_error,
    Effect.catchTag("ProtocolError", e => Effect.gen(function* () {
        if (e instanceof ProtocolErrorR) {
            return yield* e;
        }

        return yield* e.to_protocolErrorR(protocol_message);
    }))
)

export const not_implemented_error = (protocol_message: ProtocolMessage) => Effect.gen(function* () {
    return yield* new ProtocolErrorR(
        {
            message: "Not implemented",
            data: {},
            Message: protocol_message
        }
    )
}) 