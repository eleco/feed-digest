import { jevSettings } from "./jev-settings";
import { $, button, command, el, link, notice, shell } from "./common";
import {
  defaults,
  validateSettings,
  type Provider,
  type Settings,
} from "../shared/types";
import {
  key,
  removeKeys,
  saveKey,
  secureStorage,
  settings,
} from "../storage/settings";
import {
  catalogue,
  connection,
  origins,
  CLAUDE_MODEL,
} from "../ranking/providers";
import { current, transaction } from "../storage/db";
const main = shell(
  "Make it your kind of read.",
  "Connect an AI provider to categorise posts and surface interesting reads. Adjust how much each scan collects below.",
);
main.classList.add("settings");
const form = el("form");
form.innerHTML = `
<section class="panel"><h2>AI insights</h2><p>Use AI to label posts by sector, such as finance or health, and tone, such as humour or dramatic. It also scores how insightful each post is and tags explicit buy or sell calls.</p><label for="provider">Analysis provider</label><select id="provider"><option value="basic">No AI analysis</option><option value="openrouter">Free online AI · OpenRouter</option><option value="openai">OpenAI API · paid</option><option value="anthropic">Claude API · Anthropic · paid</option></select><p class="muted">Without AI, posts are ordered using recency and text length, and every collected post stays visible. Sector and tone labels require AI analysis.</p>
<div id="online" hidden><p>AI analysis sends post text and quoted text to your chosen provider. It returns labels, scores and buy/sell tags, not summaries.</p><p id="policies"></p><label for="model">Model</label><select id="model" aria-describedby="modelHelp"><option value="">Choose a model</option></select><small id="modelHelp" hidden>Enter your key, then click Check connection to load the current free models. The first available model is selected if you have not chosen one.</small><label for="apiKey">Your provider API key</label><input id="apiKey" type="password" autocomplete="off" maxlength="500" placeholder="Leave blank to keep a stored key"><small id="keyStatus"></small><label class="check"><input type="checkbox" id="remember">Remember key after Chrome restarts. Extension storage is not an encrypted vault.</label><p class="muted">Session-only is the default. After restart, missing keys cause Basic fallback. Claude and ChatGPT subscriptions do not include API credits.</p><div class="actions" id="keyActions"></div><p id="connectionStatus" class="connection-status" aria-live="polite" aria-atomic="true"></p><div id="permissionHelp" hidden></div>



<p id="enableStatus" class="connection-status" aria-live="polite">Checking setup…</p></div></section>
<section class="panel"><h2>Scan settings</h2><p class="muted">These limits apply separately to Following and For You. Each feed stops as soon as any limit is reached, or when no new posts load.</p>
<label for="stopMode">Stop scrolling at</label><select id="stopMode" aria-describedby="stopModeHelp"><option value="checkpoint">Where my previous scan started</option><option value="last24hours">Posts older than 24 hours</option></select><small id="stopModeHelp">Previous scan: Following stops at the newest post from your last completed scan, so you mostly collect what is new. For You is not in date order, so it always runs to your limits. 24 hours: older posts are skipped, and the feed stops after three of them in a row. Post, time and scroll limits always apply.</small>
<label class="check"><input id="hideImages" type="checkbox" aria-describedby="hideImagesHelp">Hide post images while scanning</label><small id="hideImagesHelp">Hides photos and avatars in the scan tab only. Images may still download.</small>
<div class="form-grid">
<div><label for="maxPosts">Posts per feed (maximum 1,000)</label><input id="maxPosts" type="number" min="1" max="1000" aria-describedby="maxPostsHelp"><small id="maxPostsHelp">Maximum number of distinct posts to collect from each feed. A post found in both feeds is saved once.</small></div>
<div><label for="maxSeconds">Seconds per feed (maximum 90)</label><input id="maxSeconds" type="number" min="5" max="90" aria-describedby="maxSecondsHelp"><small id="maxSecondsHelp">Time spent scrolling each feed. AI analysis is separate.</small></div>
<div><label for="maxSteps">Scroll steps per feed (maximum 100)</label><input id="maxSteps" type="number" min="1" max="100" aria-describedby="maxStepsHelp"><small id="maxStepsHelp">Maximum automatic scrolls in each feed. Each scroll waits 1.5 to 3 seconds for posts to load.</small></div>
</div><div id="checkpointActions" class="actions"></div><small>Resetting forgets where previous scans started, so the next scan goes as deep as the limits allow.</small></section>
<p id="saveStatus" class="muted" aria-live="polite">Changes save automatically and apply to the next scan.</p>`;
main.append(form);
form.after(await jevSettings());
$("#checkpointActions").append(
  button("Reset scan checkpoints", async () => {
    await command("resetCheckpoints");
    notice(
      "Scan checkpoints reset. The next scan collects as far as your limits allow.",
    );
  }),
);
const s = await settings();
for (const [k, v] of Object.entries(s)) {
  const input = document.getElementById(k) as HTMLInputElement | null;
  if (!input || k === "model") continue;
  if (typeof v === "boolean") input.checked = v;
  else input.value = String(v);
}
const provider = () => $("#provider") as HTMLSelectElement;
const chosen = () => provider().value as Provider;
const model = $<HTMLSelectElement>("#model");
function option(id: string, name = id) {
  const o = el("option", name);
  o.value = id;
  model.append(o);
}
function update() {
  const p = chosen();
  $("#online").hidden = p === "basic";
  $("#modelHelp").hidden = p !== "openrouter";
  model.replaceChildren();
  option("", "Choose a model");
  if (p === "anthropic") {
    option(CLAUDE_MODEL, "Claude Haiku 4.5");
  } else if (p === "openai") {
    option("gpt-4.1-mini");
    option("gpt-4.1-nano");
  } else if (p === "openrouter" && s.provider === p && s.model)
    option(s.model, s.model + " (rechecked before use)");
  if (s.provider === p) model.value = s.model;
  const policies = $("#policies");
  policies.replaceChildren(
    link(
      p === "anthropic"
        ? "Anthropic privacy policy"
        : p === "openrouter"
          ? "OpenRouter privacy policy"
          : "OpenAI API data use",
      p === "anthropic"
        ? "https://www.anthropic.com/legal/privacy"
        : p === "openrouter"
          ? "https://openrouter.ai/privacy"
          : "https://developers.openai.com/api/docs/guides/your-data",
    ),
  );
  void key(p).then((k) => {
    $("#keyStatus").textContent = k
      ? "A key is stored. Its value is never displayed."
      : "No key stored for this provider.";
  });
}
let connectionCheck: AbortController | undefined;
let updatingModels = false;
model.addEventListener("change", () => {
  if (!updatingModels) connectionCheck?.abort();
});
provider().addEventListener("change", () => {
  connectionCheck?.abort();
  $<HTMLInputElement>("#apiKey").value = "";
  update();
});
update();
$("#apiKey").addEventListener("input", () => connectionCheck?.abort());
$("#remember").addEventListener("change", () => connectionCheck?.abort());
const checkConnection = el("button", "Check connection");
checkConnection.type = "button";
checkConnection.setAttribute("aria-describedby", "connectionStatus");
checkConnection.addEventListener("click", () => {
  if (connectionCheck) return;
  const controller = new AbortController();
  connectionCheck = controller;
  const p = chosen();
  const enteredKey = $<HTMLInputElement>("#apiKey").value.trim();
  const rememberKey = $<HTMLInputElement>("#remember").checked;
  let selectedModel = model.value;
  checkConnection.disabled = true;
  checkConnection.setAttribute("aria-busy", "true");
  const spinner = el("span", undefined, "spinner");
  spinner.setAttribute("aria-hidden", "true");
  checkConnection.replaceChildren(
    spinner,
    document.createTextNode("Checking…"),
  );
  const status = $("#connectionStatus");
  $("#permissionHelp").hidden = true;
  status.dataset.state = "checking";
  status.textContent = "Checking… Approve provider access if Chrome asks.";
  void (async () => {
    try {
      if (p === "basic") throw Error("Choose an online provider first.");
      if (!selectedModel && p !== "openrouter")
        throw Error("Choose a model first.");
      const manifest = chrome.runtime.getManifest();
      const declared = [
        ...(manifest.host_permissions ?? []),
        ...(manifest.optional_host_permissions ?? []),
      ];
      if (!declared.includes(origins[p])) {
        const error = new Error(
          `This loaded extension does not declare access to ${new URL(origins[p]).hostname}. Open the extension manager, reload X Feed Digest, then close and reopen Settings. If it persists, verify that Chrome loaded this project's dist folder rather than an older copy.`,
        );
        error.name = "ExtensionPermissionError";
        throw error;
      }
      // Keep the permission request in the click's user gesture, before any await.
      const allowed = await chrome.permissions.request({
        origins: [origins[p]],
      });
      if (!allowed)
        throw Error(
          "Provider access was not allowed. Click Check connection again and approve access in Chrome.",
        );
      controller.signal.throwIfAborted();
      status.textContent = `Checking the ${enteredKey ? "entered" : "saved"} key and model… This can take up to 15 seconds.`;
      const signal = AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(15000),
      ]);
      const k = enteredKey || (await key(p));
      if (!k) throw Error("Enter your API key, then click Check connection.");
      if (p === "openrouter") {
        status.textContent =
          "Loading current free models and checking your key…";
        const models = await catalogue(signal);
        controller.signal.throwIfAborted();
        if (!models.length)
          throw Error(
            "No free models are currently available. Try again later.",
          );
        model.replaceChildren();
        for (const entry of models) option(entry.id, entry.name ?? entry.id);
        selectedModel = models.some((entry) => entry.id === selectedModel)
          ? selectedModel
          : models[0].id;
        model.value = selectedModel;
        updatingModels = true;
        try {
          model.dispatchEvent(new Event("change", { bubbles: true }));
        } finally {
          updatingModels = false;
        }
        await pendingSave;
      }
      controller.signal.throwIfAborted();
      await connection(p, k, selectedModel, signal);
      controller.signal.throwIfAborted();
      if (enteredKey) {
        await saveKey(p, enteredKey, rememberKey);
        controller.signal.throwIfAborted();
        $<HTMLInputElement>("#apiKey").value = "";
        $("#keyStatus").textContent = "Key saved.";
      }
      await pendingSave;
      controller.signal.throwIfAborted();
      status.dataset.state = "success";
      status.textContent =
        "Connected. In your digest, click Analyse with AI to label collected posts. No generation request was made.";
      notice(
        "Provider accepted the key and selected model. No generation request was made.",
      );
      await pendingSave;
      await refreshEnableStatus();
    } catch (error) {
      let message =
        error instanceof Error ? error.message : "Connection check failed.";
      if (
        error instanceof Error &&
        (error.name === "ExtensionPermissionError" ||
          /Only permissions specified in the manifest may be requested/i.test(
            error.message,
          ))
      ) {
        $("#permissionHelp").hidden = false;
        if (error.name !== "ExtensionPermissionError")
          message = `Chrome rejected access to ${p === "basic" ? "the provider" : new URL(origins[p]).hostname} despite the loaded manifest declaring it. Reload X Feed Digest in the extension manager, then close and reopen Settings. If it persists, use Copy permission details to share the loaded configuration.`;
      } else if (controller.signal.aborted)
        message =
          "Check cancelled because the provider, model or key changed. Check again when ready.";
      else if (
        error instanceof Error &&
        ["TimeoutError", "AbortError"].includes(error.name)
      )
        message =
          "Connection timed out after 15 seconds. Check your network and try again.";
      else if (error instanceof TypeError)
        message =
          "Could not reach the provider. Check your network and provider permissions, then try again.";
      else {
        const code = message.match(/^Provider HTTP (\d+)$/)?.[1];
        const help: Record<string, string> = {
          "401": `Authentication was rejected by ${p === "basic" ? "the provider" : new URL(origins[p]).hostname}. Make sure the key was issued by the selected provider. Paste it into the API key field and check again.`,
          "403": "Access denied. Check your API account and model permissions.",
          "404":
            "This model was not found or is unavailable to your API account.",
          "429":
            "The provider is rate limiting requests. Wait before trying again.",
        };
        if (code && help[code]) message = `${help[code]} (HTTP ${code})`;
      }
      status.dataset.state = "error";
      status.textContent = message;
    } finally {
      connectionCheck = undefined;
      checkConnection.disabled = false;
      checkConnection.removeAttribute("aria-busy");
      checkConnection.textContent = "Check connection";
    }
  })();
});
$("#permissionHelp").append(
  button("Open extension manager", () =>
    chrome.tabs.create({ url: "chrome://extensions/?id=" + chrome.runtime.id }),
  ),
  button("Copy permission details", async () => {
    const manifest = chrome.runtime.getManifest();
    const selectedProvider = chosen();
    await navigator.clipboard.writeText(
      JSON.stringify(
        {
          extensionId: chrome.runtime.id,
          version: manifest.version,
          provider: selectedProvider,
          requestedOrigin:
            selectedProvider === "basic" ? null : origins[selectedProvider],
          declaredHosts: manifest.host_permissions ?? [],
          optionalHosts: manifest.optional_host_permissions ?? [],
          grantedHosts: (await chrome.permissions.getAll()).origins ?? [],
        },
        null,
        2,
      ),
    );
    $("#connectionStatus").textContent =
      "Permission details copied. They contain no API key or post data.";
  }),
);
$("#keyActions").append(
  button("Save key", async () => {
    connectionCheck?.abort();
    await saveKey(
      chosen(),
      $<HTMLInputElement>("#apiKey").value,
      $<HTMLInputElement>("#remember").checked,
    );
    $<HTMLInputElement>("#apiKey").value = "";
    $("#keyStatus").textContent = "Key saved.";
    notice("Key saved. Click Check connection to verify your setup.");
    await pendingSave;
    await refreshEnableStatus();
  }),
  checkConnection,
  button("Remove keys", async () => {
    connectionCheck?.abort();
    await removeKeys();
    await pendingSave;
    // Only a running AI analysis needs the keys; scans are left alone.
    const run = await current();
    const stoppedAnalysis = run?.state === "ranking";
    if (stoppedAnalysis) await command("stop");
    const saved = await settings();
    saved.enabled = false;
    await chrome.storage.local.set({ settings: saved });
    $("#keyStatus").textContent = "All provider keys removed.";
    notice(
      stoppedAnalysis
        ? "Keys removed. The running AI analysis was stopped because it needs a key."
        : "Keys removed from session and persistent storage.",
    );
    await refreshEnableStatus();
  }),
);
// Serialize writes so rapid edits cannot overwrite one another.
let pendingSave = Promise.resolve();
let editVersion = 0;
const saveErrors = new Map<string, string>();
async function enableRequirements(saved: Settings): Promise<string[]> {
  if (saved.provider === "basic") return ["Choose an online provider"];
  const missing: string[] = [];
  if (!saved.model) missing.push("Choose a model");
  if (!(await key(saved.provider)))
    missing.push("Enter your API key and click Check connection");
  if (
    !(await chrome.permissions.contains({ origins: [origins[saved.provider]] }))
  )
    missing.push("Click Check connection to approve provider access");
  return missing;
}
let enableStatusVersion = 0;
async function refreshEnableStatus() {
  const version = ++enableStatusVersion;
  try {
    const saved = await settings();
    const missing = await enableRequirements(saved);
    if (version !== enableStatusVersion) return;
    const status = $("#enableStatus");
    status.dataset.state = missing.length ? "setup" : "ready";
    status.replaceChildren();
    if (missing.length) {
      status.append(
        document.createTextNode("To set up AI analysis, complete these steps:"),
      );
      const list = el("ul");
      for (const step of missing) list.append(el("li", step));
      status.append(list);
    } else {
      saveErrors.delete("enabled");
      status.textContent =
        "Setup complete. In your digest, click Analyse with AI after a scan.";
    }
  } catch {
    if (version === enableStatusVersion)
      $("#enableStatus").textContent =
        "Could not check setup. Reopen Settings and try again.";
  }
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.settings) void refreshEnableStatus();
});
void refreshEnableStatus();
form.addEventListener("submit", (event) => event.preventDefault());
function autosave(event: Event) {
  const input = event.target;
  if (
    !(
      input instanceof HTMLInputElement ||
      input instanceof HTMLTextAreaElement ||
      input instanceof HTMLSelectElement
    )
  )
    return;
  if (!Object.hasOwn(defaults, input.id)) return;
  // Selects and checkboxes commit on change; text/numbers save as they are edited.
  const discrete =
    input instanceof HTMLSelectElement ||
    (input instanceof HTMLInputElement && input.type === "checkbox");
  if (event.type !== (discrete ? "change" : "input")) return;
  const field = input.id as keyof Settings;
  const value =
    typeof defaults[field] === "boolean"
      ? (input as HTMLInputElement).checked
      : typeof defaults[field] === "number"
        ? input.value.trim() === ""
          ? NaN
          : Number(input.value)
        : input.value;
  const patch = { [field]: value } as Partial<Settings>;
  if (field === "provider")
    Object.assign(patch, {
      model: model.value,
      enabled: false,
    });
  const valid = input.validity.valid;
  const version = ++editVersion;
  $("#saveStatus").textContent = "Saving…";
  pendingSave = pendingSave
    .then(async () => {
      if (!valid)
        throw Error(
          "Enter a valid value for " +
            (input.labels?.[0]?.textContent ?? field),
        );
      const next = { ...(await settings()), ...patch };
      if (next.provider === "basic") next.enabled = false;
      validateSettings(next);
      const missing = await enableRequirements(next);
      if (next.enabled && missing.length) {
        // Removing a required setting must save the edit and turn analysis off.
        next.enabled = false;
      }
      await secureStorage();
      await chrome.storage.local.set({ settings: next });
      saveErrors.delete(field);
      if (field !== "enabled") saveErrors.delete("enabled");
      input.removeAttribute("aria-invalid");
    })
    .catch((error: unknown) => {
      const message =
        error instanceof Error ? error.message : "Could not save changes";
      saveErrors.set(field, message);
      input.setAttribute("aria-invalid", "true");
    })
    .then(async () => {
      if (version !== editVersion) return;
      if (!saveErrors.has("enabled")) await refreshEnableStatus();
      if (version !== editVersion) return;
      $("#saveStatus").textContent = saveErrors.size
        ? "Not saved: " + [...saveErrors.values()].join(". ")
        : "Changes saved. Applies to the next scan.";
    });
}
form.addEventListener("input", autosave);
form.addEventListener("change", autosave);
const data = el("section", undefined, "panel");
data.append(
  el("h2", "Your data, on your device."),
  el(
    "p",
    "Posts are kept for 30 days, with a 5,000-post cap. Pinned posts are retained until you unpin or delete them. Feedback is reversible. No cloud sync or analytics.",
    "muted",
  ),
  button("Reset all feedback", async () => {
    await transaction(["feedback"], async (tx) => {
      tx.objectStore("feedback").clear();
    });
    notice("All Useful and Not useful feedback cleared.");
  }),
);
const confirm = el("label", undefined, "check");
const check = el("input");
check.type = "checkbox";
confirm.append(
  check,
  document.createTextNode(
    "I want to permanently remove all posts, digests, preferences, keys and caches.",
  ),
);
data.append(
  confirm,
  button(
    "Delete all data",
    async () => {
      if (!check.checked) throw Error("Select the deletion checkbox first.");
      await pendingSave;
      await command("delete");
      location.reload();
    },
    "danger",
  ),
);
main.append(data);
const rules = el("p", undefined, "muted");
rules.append(
  document.createTextNode(
    "X’s rules prohibit non-API automation, including scripting its website, and warn of suspension. This project does not establish compliance or account safety. ",
  ),
  link(
    "Read X’s automation rules",
    "https://help.x.com/en/rules-and-policies/x-automation",
  ),
);
main.append(rules);
