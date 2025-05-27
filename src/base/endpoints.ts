import { Address } from "./address";
import { Equal, Effect, Data } from "effect";
import { RegisteredMiddleware } from "./middleware";

export type Endpoint = {
    address: Address;
    communicationChannels: any[];
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

class AddressAlreadyInUseError extends Data.TaggedError("AddressAlreadyInUseError")<{
    address: Address;
}> { }

export const setLocalAddress = (new_address: Address) => Effect.gen(function* (_) {
    for (const endpoint of endpoints) {
        if (Equal.equals(endpoint.address, new_address)) {
            return yield* _(Effect.fail(new AddressAlreadyInUseError({
                address: new_address
            })));
        }
    }

    const old_endpoint = findOrCreateEndpoint(Address.local_address());
    Address._setLocalAddress(new_address);
    old_endpoint.address = Address.local_address();

    return yield* _(Effect.void);
});