import Address from "./address";
import { CommunicationProvider, Communicator, CommunicatorT, InCommunicationProvider, OutCommunicationProvider, SerializedMessageT } from "./communicator";
import Message, { MessageParseError, MessageT } from "./message";
import uuidv4, { UUID } from "./utils/uuid";
import { Data, Effect, Equal, pipe, Schema } from "effect";

class TargetNotFoundError extends Data.TaggedError("TargetNotFoundError")<{ readonly target: string }> { }
class CommunicatorCantSendError extends Data.TaggedError("CommunicatorCantSendError")<{}> { }

class MessageCore extends Communicator {
    private communicators: Communicator[] = [this];

    constructor(host_id: UUID = uuidv4()) {
        super(new Address(host_id, "core"), {
            send: MessageCore.recieve, // Dealing with "this" issues in super()
            register_recieve_cb: () => { /* Recieve will never be triggered this way */ },
            register_close_cb: () => { /* Close will never be called */ }
        });
    }

    create_communicator(address: Address, communication_provider: CommunicationProvider) {
        const communicator = new Communicator(address, communication_provider);
        this.communicators.push(communicator);
        communication_provider.register_close_cb(() => {
            this.communicators = this.communicators.filter(c => c !== communicator);
        });

        if (typeof (communication_provider as any).register_recieve_cb === "function") {
            (communication_provider as InCommunicationProvider).register_recieve_cb(
                Effect.provideService(MessageCore.in_msg_effect, CommunicatorT, { communicator })
            );
        }

        return communicator;
    }

    static recieve = Effect.never;

    static in_msg_effect = Effect.gen(function* (_) {
        const { communicator } = yield* _(CommunicatorT);
        const { serialized } = yield* _(SerializedMessageT);
        const msg = yield* _(Schema.decode(Message.MessageFromString)(serialized));
        const local_address = MsgCore.get_address();
        const target_address = msg.target instanceof Address ? msg.target : msg.target.get_address();

        msg.computed_data.local = {
            local_address,
            direction: "incomming",
            is_bridge: !Equal.equals(local_address.host_id, target_address.host_id)
        };

        return yield* _(Effect.provideService(
            pipe(
                communicator._middleware_effect("MSG_IN"),
                Effect.andThen(MessageCore.send_effect)
            ),
            MessageT,
            {
                msg: msg
            }
        ));
    }).pipe(
        Effect.catchTag(
            "ParseError", () => Effect.fail(new MessageParseError())
        )
    )

    static send_effect = Effect.gen(function* (_) {
        const { msg } = yield* _(MessageT);
        if (msg.computed_data.local) {
            msg.computed_data.local = {
                local_address: MsgCore.get_address(),
                direction: "outgoing",
                is_bridge: false
            };

            yield* _(MsgCore._middleware_effect("MSG_OUT"));
        } else {
            yield* _(MsgCore._middleware_effect("MSG_IN"));
        }


        if (msg.target instanceof Communicator) {
            const communication_provider = msg.target.communication_provider;
            if (typeof (communication_provider as any).send === "function") {
                return yield* _((communication_provider as OutCommunicationProvider).send);
            }
            return yield* _(Effect.fail(new CommunicatorCantSendError()));
        }

        for (const communicator of MsgCore.communicators) {
            if (
                Equal.equals(communicator.get_address(), msg.target)
                && typeof (communicator.communication_provider as any).send === "function"
            ) {
                return yield* _((communicator.communication_provider as OutCommunicationProvider).send);
            }
        }

        for (const communicator of MsgCore.communicators) {
            if (
                Equal.equals(communicator.get_address().host_id, msg.target.host_id)
                && typeof (communicator.communication_provider as any).send === "function"
            ) {
                return yield* _((communicator.communication_provider as OutCommunicationProvider).send);
            }
        }

        return yield* _(Effect.fail(new TargetNotFoundError({
            target: Schema.encodeSync(Address.AddressFromString)(msg.target)
        })));
    })

    set_host_uuid(host_uuid: UUID) {
        this.address = new Address(host_uuid, "core");
    }
}

const MsgCore = new MessageCore();
export default MsgCore;