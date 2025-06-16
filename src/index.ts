import { Effect } from "effect";
import { init, addrA, sendMessage, registerListener } from "./demo/setUp";
import { Message } from "./base/message";


console.log("Starting...");
Effect.runPromise(init).then(() => {
    registerListener((msg) => {
        console.log("Recieved: ", msg);
    });
}).then(() => {
    sendMessage(new Message(addrA, "Hello!"));
});