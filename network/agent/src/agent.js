import os from "node:os";
import { statfs } from "node:fs/promises";
import { hostname } from "node:os";
import { pathToFileURL } from "node:url";

const VERSION = "0.1.0";

export async function collectTelemetry(dataPath = process.env.HASA_AGENT_DATA_PATH || "/") {
  const disk = await statfs(dataPath);
  const totalBlocks = Number(disk.blocks);
  const availableBlocks = Number(disk.bavail);
  const blockSize = Number(disk.bsize);

  return {
    hostname: hostname(),
    os_name: os.type(),
    os_release: os.release(),
    architecture: os.arch(),
    agent_version: VERSION,
    cpu_cores: os.cpus().length,
    load_average: os.loadavg().map(value => Number(value.toFixed(2))),
    memory_total_bytes: os.totalmem(),
    memory_available_bytes: os.freemem(),
    disk_total_bytes: totalBlocks * blockSize,
    disk_available_bytes: availableBlocks * blockSize,
    observed_at: new Date().toISOString()
  };
}

async function main() {
  const report = await collectTelemetry();
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  if (process.env.HASA_AGENT_API_URL || process.env.HASA_AGENT_TOKEN) {
    throw new Error("Network reporting is not enabled until the central enrollment and heartbeat API is implemented.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error("HASA Server Agent:", error.message);
    process.exitCode = 1;
  });
}
