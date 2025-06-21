import { useMiddleware } from "./middleware";
import { KernelEnv } from "./kernel_environment/index";
import { registerCommunicationChannel } from "./communication_channel";
import { listen, listenMessageProcessingError } from "./kernel_environment/listen";
import { Address } from "./address";

export const setLocalAddress = Address._setLocalAddress;
export const send = KernelEnv.send;

export {
    registerCommunicationChannel,
    useMiddleware,
    listen,
    listenMessageProcessingError
}