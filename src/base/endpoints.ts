import { Address } from "./address";
import { Equal, Effect, Data } from "effect";
import { RegisteredMiddleware } from "./middleware";
import { CommunicationChannel } from "./communication_channels";

export type Endpoint = {
    address: Address;
    communicationChannels: CommunicationChannel[];
    middlewares: RegisteredMiddleware[];
}

export const endpoints: Endpoint[] = [];

export const findOrCreateEndpoint = (address: Address): Endpoint => {
    const endpoint = endpoints.find(endpoint => Equal.equals(endpoint.address, address));
    if (endpoint) {
        return endpoint;
    }
    const new_endpoint = {
        address,
        communicationChannels: [],
        middlewares: []
    };
    endpoints.push(new_endpoint);
    return new_endpoint;
}