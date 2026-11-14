import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function loadPlugins() {
  const directory = path.resolve("./plugins");
  fs.mkdirSync(directory, { recursive: true });
  const modules = [];
  for (const file of fs.readdirSync(directory).filter(name => name.endsWith(".js")).sort()) {
    try {
      const loaded = await import(pathToFileURL(path.join(directory, file)).href + "?v=" + Date.now());
      if (typeof loaded.default === "function") modules.push({ name: file, run: loaded.default, onConnection: loaded.onConnection });
      else console.warn("Skipping plugin without a default function:", file);
    } catch (error) {
      console.error("Plugin load failed (" + file + "):", error.stack || error.message);
    }
  }
  return {
    count: modules.length,
    names: modules.map(item => item.name),
    async onConnection(sock) {
      for (const plugin of modules) {
        if (typeof plugin.onConnection === "function") {
          try { await plugin.onConnection(sock); }
          catch (error) { console.error("Plugin connection hook failed (" + plugin.name + "):", error.message); }
        }
      }
    },
    async handleMessage(sock, message, config, cache) {
      for (const plugin of modules) {
        try {
          await plugin.run({ sock, message, config, cache });
        } catch (error) {
          console.error("Plugin runtime error (" + plugin.name + "):", error.stack || error.message);
        }
      }
    }
  };
}
