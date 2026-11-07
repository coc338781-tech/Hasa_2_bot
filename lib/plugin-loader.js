import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function loadPlugins() {
  const directory = path.resolve("./plugins");
  fs.mkdirSync(directory, { recursive: true });
  const modules = [];
  for (const file of fs.readdirSync(directory).filter(name => name.endsWith(".js"))) {
    const loaded = await import(pathToFileURL(path.join(directory, file)).href + "?v=" + Date.now());
    if (typeof loaded.default === "function") modules.push(loaded.default);
  }
  return {
    count: modules.length,
    async handleMessage(sock, message, config, cache) {
      for (const plugin of modules) {
        await plugin({ sock, message, config, cache });
      }
    }
  };
}
