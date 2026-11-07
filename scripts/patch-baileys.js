import fs from "node:fs";

const file = new URL("../node_modules/@whiskeysockets/baileys/lib/Utils/validate-connection.js", import.meta.url);
if (!fs.existsSync(file)) {
  console.error("Baileys validate-connection.js not found; install dependencies first.");
  process.exit(1);
}

let source = fs.readFileSync(file, "utf8");
if (source.includes("UserAgent.Platform.MACOS")) {
  source = source.replace("UserAgent.Platform.MACOS", "UserAgent.Platform.WEB");
  fs.writeFileSync(file, source);
  console.log("Restored Baileys WEB platform for WEB_BROWSER pairing.");
} else if (source.includes("UserAgent.Platform.WEB")) {
  console.log("Baileys WEB platform is already correct.");
} else {
  console.error("Baileys platform declaration was not recognized; no changes made.");
  process.exit(1);
}
