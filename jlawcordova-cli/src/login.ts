import { callApi, EXIT, fail, report, workerOrigin, type Deps } from "./api.ts";

/** The GitHub OAuth App the Worker checks tokens against. The client ID is public. */
export const DEFAULT_CLIENT_ID = "Ov23lip0SZYBKRd9VIJ3";
/** The only account the Worker admits, so a token that gets through belongs to it. */
const OWNER_LOGIN = "jlawcordova";

const DEVICE_CODE_URL = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";
const DEFAULT_INTERVAL_S = 5;
const SLOW_DOWN_S = 5;

interface DeviceCode {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval?: number;
}

async function postForm(deps: Deps, url: string, fields: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await deps.fetch(url, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
    signal: AbortSignal.timeout(30_000),
  });
  const body: unknown = await res.json().catch(() => undefined);
  if (typeof body !== "object" || body === null) throw new Error(`GitHub answered HTTP ${res.status} with something that isn't JSON.`);
  return body as Record<string, unknown>;
}

function isDeviceCode(body: Record<string, unknown>): body is Record<string, unknown> & DeviceCode {
  return (
    typeof body.device_code === "string" &&
    typeof body.user_code === "string" &&
    typeof body.verification_uri === "string" &&
    typeof body.expires_in === "number"
  );
}

/** Signs in with GitHub's device flow, checks the token with the Worker, and saves it to the keychain. */
export async function login(deps: Deps): Promise<number> {
  if (deps.platform !== "darwin") {
    return fail(deps, EXIT.refused, "unsupported_platform", "login stores the token in the macOS keychain. Elsewhere, set ACCOMPLISHMENTS_TOKEN instead.");
  }
  const clientId = deps.env.ACCOMPLISHMENTS_CLIENT_ID?.trim() || DEFAULT_CLIENT_ID;

  let device: DeviceCode;
  try {
    const body = await postForm(deps, DEVICE_CODE_URL, { client_id: clientId }); // no scope: the token only proves who I am
    if (body.error === "device_flow_disabled") {
      return fail(deps, EXIT.refused, "device_flow_disabled", "Device Flow is off for this GitHub OAuth App. Turn on \"Enable Device Flow\" in its settings.");
    }
    if (!isDeviceCode(body)) {
      return fail(deps, EXIT.refused, "github_error", typeof body.error_description === "string" ? body.error_description : "GitHub didn't start the sign-in.");
    }
    device = body;
  } catch {
    return fail(deps, EXIT.network, "network", "Couldn't reach github.com.");
  }

  deps.stderr(`Open ${device.verification_uri} and enter the code ${device.user_code}\n`);
  if (device.verification_uri.startsWith("https://github.com/")) {
    await deps.openUrl(device.verification_uri).catch(() => {});
  }

  let intervalS = device.interval ?? DEFAULT_INTERVAL_S;
  let waitedMs = 0;
  let token: string | undefined;
  while (token === undefined) {
    if (waitedMs >= device.expires_in * 1000) {
      return fail(deps, EXIT.auth, "expired_token", "The code expired before it was approved. Run `accomplishments login` again.");
    }
    await deps.sleep(intervalS * 1000);
    waitedMs += intervalS * 1000;

    let body: Record<string, unknown>;
    try {
      body = await postForm(deps, ACCESS_TOKEN_URL, { client_id: clientId, device_code: device.device_code, grant_type: GRANT_TYPE });
    } catch {
      return fail(deps, EXIT.network, "network", "Couldn't reach github.com.");
    }

    if (typeof body.access_token === "string" && body.access_token !== "") {
      token = body.access_token;
    } else if (body.error === "authorization_pending") {
      continue;
    } else if (body.error === "slow_down") {
      intervalS = typeof body.interval === "number" ? body.interval : intervalS + SLOW_DOWN_S;
    } else if (body.error === "expired_token") {
      return fail(deps, EXIT.auth, "expired_token", "The code expired before it was approved. Run `accomplishments login` again.");
    } else if (body.error === "access_denied") {
      return fail(deps, EXIT.auth, "access_denied", "Sign-in was declined on GitHub.");
    } else {
      return fail(deps, EXIT.refused, "github_error", typeof body.error_description === "string" ? body.error_description : "GitHub refused the sign-in.");
    }
  }

  // Nothing is saved unless the Worker accepts the token for the owner.
  const check = await callApi(deps, token, { method: "GET", path: "/api/accomplishments?limit=1" });
  if (!check.ok) {
    if (check.status === 403) {
      return fail(deps, EXIT.auth, "forbidden", `That GitHub account isn't allowed. Sign in to GitHub as ${OWNER_LOGIN} and run \`accomplishments login\` again.`);
    }
    return report(deps, check);
  }

  try {
    await deps.storeToken(token);
  } catch {
    return fail(deps, EXIT.refused, "keychain", "The token couldn't be saved to the keychain.");
  }
  deps.stdout(`${JSON.stringify({ loggedIn: true, login: OWNER_LOGIN, worker: workerOrigin(deps) }, null, 2)}\n`);
  return EXIT.ok;
}
