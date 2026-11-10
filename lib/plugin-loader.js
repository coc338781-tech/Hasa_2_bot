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
      if (typeof loaded.default === "function") modules.push({ name: file, run: loaded.default, onConnection: loaded.onConnection, commands: Array.isArray(loaded.commands) ? loaded.commands : [] });
      else console.warn("Skipping plugin without a default function:", file);
    } catch (error) {
      console.error("Plugin load failed (" + file + "):", error.stack || error.message);
    }
  }
  return {
    count: modules.length,
    names: modules.map(item => item.name),
    commands: modules.flatMap(item => item.commands),
    async onConnection(sock, config) {
      for (const plugin of modules) {
        try {
          if (typeof plugin.onConnection === "function") await plugin.onConnection(sock, config);
        } catch (error) {
          console.error("Plugin connection hook failed (" + plugin.name + "):", error.stack || error.message);
        }
      }
    },
    async onConfigUpdate(sock, config) {
      for (const plugin of modules) {
        try {
          if (typeof plugin.onConfigUpdate === "function") await plugin.onConfigUpdate(sock, config);
        } catch (error) {
          console.error("Plugin config update hook failed (" + plugin.name + "):", error.stack || error.message);
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
