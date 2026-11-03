import { defaults, type Settings, type Provider } from "../shared/types";
export async function secureStorage() {
  await Promise.all([
    chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
    chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
  ]);
}
export async function settings(): Promise<Settings> {
  const saved = {
    ...defaults,
    ...((await chrome.storage.local.get("settings")).settings as
      | Partial<Settings>
      | undefined),
  };
  for (const removed of [
    "interests",
    "exclusions",
    "authors",
    "spendCeiling",
    "inputPrice",
    "outputPrice",
    "pricingConfirmed",
    "daily",
    "time",
    "allowFocus",
  ])
    delete (saved as unknown as Record<string, unknown>)[removed];
  return {
    ...saved,
    requestsPerScan: defaults.requestsPerScan,
    requestsPerDay: defaults.requestsPerDay,
    inputTokens: defaults.inputTokens,
    outputTokens: defaults.outputTokens,
  };
}
export async function key(
  provider: Provider | "jev",
): Promise<string | undefined> {
  const name = "key:" + provider;
  const value =
    (await chrome.storage.session.get(name))[name] ??
    (await chrome.storage.local.get(name))[name];
  return typeof value === "string" ? value : undefined;
}
export async function removeKeys() {
  for (const storage of [chrome.storage.local, chrome.storage.session])
    await storage.remove([
      "key:openai",
      "key:openrouter",
      "key:anthropic",
      "key:jev",
    ]);
}
export async function saveKey(
  provider: Provider | "jev",
  value: string,
  remember: boolean,
) {
  if (provider === "basic" || value.length > 500 || !value.trim())
    throw Error("Enter a provider key");
  await secureStorage();
  const name = "key:" + provider;
  await chrome.storage.session.remove(name);
  await chrome.storage.local.remove(name);
  await (remember ? chrome.storage.local : chrome.storage.session).set({
    [name]: value.trim(),
  });
}
