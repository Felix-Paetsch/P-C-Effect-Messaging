import { useMiddleware } from "./middleware";
import { send } from "./send";
import { registerCommunicationChannel } from "./communication_channels";
import { listen, listenMessageProcessingError } from "./listen";
import { Address } from "./address";

export const setLocalAddress = Address._setLocalAddress;

export {
    send,
    registerCommunicationChannel,
    useMiddleware,
    listen,
    listenMessageProcessingError
}