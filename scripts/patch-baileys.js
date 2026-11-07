import fs from "node:fs";

const file = new URL("../node_modules/@whiskeysockets/baileys/lib/Utils/validate-connection.js", import.meta.url);
if (!fs.existsSync(file)) {
  console.error("Baileys validate-connection.js not found; cannot apply WhatsApp platform compatibility patch.");
  process.exit(1);
}
let source = fs.readFileSync(file, "utf8");
if (source.includes("UserAgent.Platform.WEB")) {
  source = source.replace("UserAgent.Platform.WEB", "UserAgent.Platform.MACOS");
  fs.writeFileSync(file, source);
  console.log("Applied Baileys MACOS platform compatibility patch.");
} else if (source.includes("UserAgent.Platform.MACOS")) {
  console.log("Baileys MACOS platform compatibility patch already applied.");
} else {
  console.error("Baileys platform declaration was not recognized; no changes made.");
  process.exit(1);
}
