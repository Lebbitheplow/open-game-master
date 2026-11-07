import os from "node:os";

// Restricted hosts can refuse interface enumeration. Discovery is only a
// hint for sharing: it must not prevent login or setup. An empty snapshot
// offers no LAN addresses and cannot vouch for a saved private URL, while
// public hostnames keep working. Read again next time so recovery is live.
export function safeNetworkInterfaces(): ReturnType<typeof os.networkInterfaces> {
  try {
    return os.networkInterfaces();
  } catch {
    return {};
  }
}
