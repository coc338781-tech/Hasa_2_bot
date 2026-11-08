export async function restartAllSubbots(owners, { stop, start }) {
  const results = [];
  for (const owner of [...new Set(owners.map(String))]) {
    try {
      await stop(owner);
      await start(owner);
      results.push({ owner, ok: true });
    } catch (error) {
      results.push({ owner, ok: false, error: error?.message || String(error) });
    }
  }
  return results;
}

export async function deleteAllSubbots(owners, remove) {
  const results = [];
  for (const owner of [...new Set(owners.map(String))]) {
    try {
      await remove(owner);
      results.push({ owner, ok: true });
    } catch (error) {
      results.push({ owner, ok: false, error: error?.message || String(error) });
    }
  }
  return results;
}
