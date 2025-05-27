import { Effect } from "effect";
import { init, addrA, addrB } from "./demo/setUp";
import { sendMessage } from "./demo/setUp";
import { Message } from "./base/message";

console.log("Starting...");
Effect.runPromise(init).then(() => {
    console.log("Sending message...");
    sendMessage(new Message(addrA, "Hello!"));
}).catch((e) => {
    console.log(e);
});