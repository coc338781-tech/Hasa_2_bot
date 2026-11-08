export async function checkDownloaderTools(execCommand) {
  const checks = await Promise.all([
    ["yt-dlp", ["--version"]],
    ["ffmpeg", ["-version"]]
  ].map(async ([name, args]) => {
    try {
      const result = await execCommand(name, args, { timeout: 15000, maxBuffer: 1024 * 1024 });
      const output = String(result?.stdout || result?.stderr || "").trim().split("\n")[0];
      return { name, ok: true, version: output || "Available" };
    } catch (error) {
      return { name, ok: false, reason: error?.code === "ENOENT" ? "Not installed" : (error?.message || "Check failed") };
    }
  }));
  return checks;
}
