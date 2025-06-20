import { Middleware } from "../base/middleware";
import { collection_middleware, harpoon_middleware } from "./collection";

type ExtractPartitionKey<T> = T extends string
    ? T
    : T extends readonly [infer K, any]
    ? K extends string
    ? K
    : never
    : never;

type ExtractPartitionKeys<T extends readonly any[]> = {
    [K in keyof T]: ExtractPartitionKey<T[K]>
}[number];

type PartitionMiddlewareGen<Keys extends string> = (() => Middleware) & {
    [K in Keys]: Middleware[]
}

/*
Call like:   

    const res = partition_middleware([
        "ping",
        ["pong", empty_middleware],
        ["test", [empty_middleware, empty_middleware]]
    ] as const);

for good auto-complete
*/

export function partition_middleware<
    T extends readonly (string | [string, Middleware] | [string, Middleware[]])[]
>(
    partitions: T
): PartitionMiddlewareGen<ExtractPartitionKeys<T>> {
    const partition_arr: Middleware[] = [];
    const partitionMap: { [key: string]: ReturnType<typeof harpoon_middleware> } = {};

    for (const partition of partitions) {
        let key: string;
        let currentHarpoonMiddleware: ReturnType<typeof harpoon_middleware>;

        if (typeof partition === 'string') {
            key = partition;
            currentHarpoonMiddleware = harpoon_middleware([]);
        } else if (Array.isArray(partition)) {
            const [k, middleware] = partition;
            key = k;
            if (Array.isArray(middleware)) {
                currentHarpoonMiddleware = harpoon_middleware(middleware);
            } else {
                currentHarpoonMiddleware = harpoon_middleware([middleware]);
            }
        } else {
            throw new Error("Invalid partition format.");
        }

        partitionMap[key] = currentHarpoonMiddleware;
        partition_arr.push(currentHarpoonMiddleware());
    }

    const mainMiddleware = (): Middleware => {
        return collection_middleware(partition_arr);
    };

    return new Proxy(mainMiddleware, {
        get(target, prop, receiver) {
            if (typeof prop === 'string' && prop in partitionMap) {
                return partitionMap[prop as keyof typeof partitionMap];
            }
            return Reflect.get(target, prop, receiver);
        },
        has(target, prop) {
            return (typeof prop === 'string' && prop in partitionMap) || Reflect.has(target, prop);
        },
        ownKeys(target) {
            return [...Object.keys(partitionMap), ...Reflect.ownKeys(target)];
        },
        getOwnPropertyDescriptor(target, prop) {
            if (typeof prop === 'string' && prop in partitionMap) {
                return {
                    enumerable: true,
                    configurable: true,
                    value: partitionMap[prop as keyof typeof partitionMap]
                };
            }
            return Reflect.getOwnPropertyDescriptor(target, prop);
        }
    }) as PartitionMiddlewareGen<ExtractPartitionKeys<T>>;
}
