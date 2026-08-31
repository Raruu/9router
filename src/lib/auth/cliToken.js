// Shared CLI token check. The launcher (cli/) derives the same value from the
// machine id + the secret both sides read out of DATA_DIR, so a matching header
// proves the caller is the local CLI rather than a remote client.
//
// Lives here rather than in dashboardGuard.js because route handlers need it too
// and must not import the guard (it pulls in next/server and the whole
// middleware graph).
import { getConsistentMachineId } from "@/shared/utils/machineId";

export const CLI_TOKEN_HEADER = "x-9r-cli-token";
const CLI_TOKEN_SALT = "9r-cli-auth";

let cachedCliToken = null;
async function getCliToken() {
  if (!cachedCliToken) cachedCliToken = await getConsistentMachineId(CLI_TOKEN_SALT);
  return cachedCliToken;
}

export async function hasValidCliToken(request) {
  const token = request?.headers?.get?.(CLI_TOKEN_HEADER);
  if (!token) return false;
  return token === await getCliToken();
}
