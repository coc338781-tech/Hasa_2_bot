import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
const exec = promisify(execFile);
export default async function downloader({ sock, message, config }) {
  const jid = message.key.remoteJid;
  const text = message.message?.conversation || message.message?.extendedTextMessage?.text || "";
  const prefix = config.prefix || ".";
  if (!text.startsWith(prefix+"dl ")) return;
  const url = text.slice((prefix+"dl ").length).trim();
  if (!/^https?:\\/\\//i.test(url)) return sock.sendMessage(jid,{text:"Usage: .dl https://... "},{quoted:message});
  const dir = path.resolve(config.downloadDir || "downloads");
  fs.mkdirSync(dir,{recursive:true});
  await sock.sendMessage(jid,{text:"Downloading..."} ,{quoted:message});
  try {
    const out = path.join(dir,Date.now()+"-%(title).80s.%(ext)s");
    await exec("yt-dlp",["--no-playlist","-f","bv*+ba/b","--merge-output-format","mp4","-o",out,url],{timeout:180000});
    const files = fs.readdirSync(dir).map(f=>path.join(dir,f)).filter(f=>fs.statSync(f).isFile()).sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs);
    if (!files.length) throw new Error("No downloaded file found");
    const file=files[0], data=fs.readFileSync(file);
    if (data.length>64*1024*1024) throw new Error("File exceeds WhatsApp upload limit configured for this bot");
    await sock.sendMessage(jid,{video:data,caption:path.basename(file)});
    fs.unlinkSync(file);
  } catch(error) { await sock.sendMessage(jid,{text:"Downloader failed: "+error.message+"\\nInstall yt-dlp in Termux: pip install -U yt-dlp"}); }
}
