import {
  LightpandaProviderError,
  launchLightpandaPublicSpike,
} from "../src/lib/lightpanda-provider.js";

const AUTH_METHOD_URL =
  "https://ontrack.infotech.monash.edu/api/auth/method";
const OKTA_ORIGIN = "https://monashuni.okta.com";

function requiredLightpandaPath(environment: NodeJS.ProcessEnv): string {
  if (
    environment.ONTRACK_BROWSER?.trim().toLowerCase() !== "lightpanda" ||
    environment.ONTRACK_EXPERIMENTAL_LIGHTPANDA?.trim() !== "1"
  ) {
    throw new Error("LIGHTPANDA_EXPERIMENT_NOT_ENABLED");
  }
  const executablePath = environment.ONTRACK_LIGHTPANDA_PATH?.trim();
  if (!executablePath) {
    throw new Error("LIGHTPANDA_PATH_REQUIRED");
  }
  return executablePath;
}

async function readPublicOktaUrl(): Promise<string> {
  const response = await fetch(AUTH_METHOD_URL, {
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error("AUTH_METHOD_UNAVAILABLE");
  }
  const body = (await response.json()) as {
    method?: unknown;
    redirect_to?: unknown;
  };
  if (body.method !== "saml" || typeof body.redirect_to !== "string") {
    throw new Error("AUTH_METHOD_UNEXPECTED");
  }
  const redirect = new URL(body.redirect_to);
  if (
    redirect.protocol !== "https:" ||
    redirect.origin !== OKTA_ORIGIN ||
    redirect.username !== "" ||
    redirect.password !== "" ||
    redirect.hash !== ""
  ) {
    throw new Error("AUTH_METHOD_ORIGIN_REJECTED");
  }
  return redirect.toString();
}

async function main(): Promise<void> {
  const executablePath = requiredLightpandaPath(process.env);
  const publicUrl = await readPublicOktaUrl();
  const spike = await launchLightpandaPublicSpike({
    purpose: "credential-free-public-spike",
    executablePath,
    publicUrl,
  });
  try {
    const inspection = await spike.inspect();
    console.log(
      JSON.stringify({
        status: "credential_free_public_spike_complete",
        ...inspection,
      }),
    );
  } finally {
    await spike.close();
  }
}

try {
  await main();
} catch (error) {
  const code =
    error instanceof LightpandaProviderError ? error.code : "LIGHTPANDA_SPIKE_FAILED";
  console.error(code);
  process.exitCode = 1;
}
