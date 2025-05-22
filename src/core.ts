import Address from "./address";
import { CommunicationProvider, Communicator, InCommunicationProvider, SerializedMessageT } from "./communicator";
import Message, { MessageT } from "./message";
import uuidv4, { UUID } from "./utils/uuid";
import { Effect } from "effect";

class MessageCore extends Communicator {
    private communicators: Communicator[] = [];

    constructor(host_id: UUID = uuidv4()) {
        super(new Address(host_id, "core"), {
            send: (msg) => MsgCore.send(msg), // Dealing with "this" issues in super()
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

            const des = Effect.gen(function* (_) {
                return yield* SerializedMessageT.pipe(
                    Effect.andThen(S => S.serialized),
                    Effect.andThen(Message.deserialize),
                )
            });

            (communication_provider as InCommunicationProvider).register_recieve_cb(
                Effect.gen(function* (_) {
                    SerializedMessageT.pipe(
                        Effect.andThen(S => S.serialized),
                        Effect.andThen(Message.deserialize),
                    )

                    const local_address = MsgCore.get_address();
                    const target_address = msg.target instanceof Address ? msg.target : msg.target.get_address();

                    msg.computed_data.local = {
                        local_address,
                        direction: "incomming",
                        is_bridge: local_address.equals(target_address)
                    };

                    yield* _(communicator._middleware_effect("MSG_IN"));
                    return yield* _(MsgCore.send());
                })
            );
        }

        return communicator;
    }

    send(msg: Message | null = null) {
        return Effect.never;
    }

    set_host_uuid(host_uuid: UUID) {
        this.address = new Address(host_uuid, "core");
    }
}

const MsgCore = new MessageCore();
export default MsgCore;