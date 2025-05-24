import { useMiddleware } from "./middleware";
import { send } from "./send";
import { registerCommunicationChannel } from "./communication_channels";
import { setLocalHostId } from "./endpoints";

export {
    setLocalHostId,
    send,
    registerCommunicationChannel,
    useMiddleware
}