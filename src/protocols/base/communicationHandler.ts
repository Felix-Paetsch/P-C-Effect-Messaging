import { ProtocolMessage, ProtocolMessageT } from "./protocol_message";
import { Json } from "../../utils/json";
import { ProtocolErrorN, ProtocolErrorR } from "./protocol_errors";
import { Context, Effect, Layer, pipe } from "effect";

export class ProtocolCommunicationHandlerT extends Context.Tag("ProtocolCommunicationHandlerT")<ProtocolCommunicationHandlerT, ProtocolCommunicationHandler>() { }

export class ProtocolCommunicationHandler {
    constructor(
        protected current_pm: ProtocolMessage
    ) { }

    send(data: Json, timeout?: number) {
        return Effect.gen(this, function* () {
            const pmE = yield* this.current_pm.respond(data, timeout);
            return pmE.pipe(
                Effect.andThen(pm => {
                    this.current_pm = pm;
                    return pm;
                }),
                Effect.as(this),
                Effect.onError(e => this.cleanUp())
            );
        }).pipe(
            Effect.onError(e => this.cleanUp())
        )
    }

    finishExternal(data: Json = "OK") {
        return this.send(data, 0)
    }

    close(data: Json, ignore: false): ReturnType<ProtocolMessage["respond"]>;
    close(data: Json, ignore: true): ReturnType<ProtocolMessage["respond"]> & Effect.Effect<any, never, any>;
    close(data: Json = "OK", ignore: boolean = false) {
        const res = this.current_pm.respond(data, 0)
        return !ignore ? res : res.pipe(Effect.ignore)
    }

    awaitResponse(data: Json, timeout?: number) {
        return Effect.gen(this, function* () {
            const pm = yield* yield* this.current_pm.respond(data, timeout);
            this.current_pm = pm;
            return this;
        }).pipe(
            Effect.onError(e => this.cleanUp())
        )
    }

    private cleanUp() {
        return Effect.all(this.error_handlers).pipe(Effect.andThen(() => Effect.void))
    }
    private error_handlers: Effect.Effect<void, never, never>[] = [];
    onMessageError(e: Effect.Effect<void, never, never>) {
        this.error_handlers.push(e);
    }

    get data(): Json {
        return this.current_pm.data;
    }

    get message(): ProtocolMessage {
        return this.current_pm;
    }

    errorN(obj: {
        message: string;
        data?: Json;
        error?: Error
    }) {
        return new ProtocolErrorN({
            message: obj.message,
            data: obj.data,
            error: obj.error
        })
    }
    errorR(obj: {
        message: string;
        data?: Json;
        error?: Error
    }) {
        return new ProtocolErrorR({
            message: obj.message,
            data: obj.data,
            error: obj.error,
            Message: this.current_pm
        })
    }
    asErrorR<E extends Error>(err: E) {
        return this.errorR({
            message: err.message,
            data: (err as any).data || null,
            error: err
        })
    }
    asErrorN<E extends Error>(err: E) {
        return this.errorN({
            message: err.message,
            data: (err as any).data || null,
            error: err
        })
    }

    static fromProtocolMessage = Layer.effect(
        ProtocolCommunicationHandlerT,
        pipe(
            ProtocolMessageT,
            Effect.andThen(pm => new ProtocolCommunicationHandler(pm))
        )
    )
}