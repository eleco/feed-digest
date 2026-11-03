import { el, button, link } from "./common";
import { key, saveKey } from "../storage/settings";
import { checkJev, JEV_ORIGIN } from "../ranking/jev";

export async function jevSettings() {
  const panel = el("section", undefined, "panel");
  panel.id = "jevSettings";
  const label = el("label", "Jev API key");
  label.htmlFor = "jevApiKey";
  const input = el("input");
  input.id = "jevApiKey";
  input.type = "password";
  input.autocomplete = "off";
  input.maxLength = 500;
  input.placeholder = "Enter your TypeSafe API key";
  const remember = el("input");
  remember.type = "checkbox";
  const rememberLabel = el("label", undefined, "check");
  rememberLabel.append(
    remember,
    document.createTextNode("Remember Jev key after Chrome restarts"),
  );
  const status = el("p", undefined, "connection-status");
  status.setAttribute("role", "status");
  status.textContent = (await key("jev"))
    ? "A Jev key is stored. Its value is never displayed."
    : "No Jev key stored.";
  const check = el("button", "Save and check Jev connection");
  check.type = "button";
  const manager = button("Open extension manager", () =>
    chrome.tabs.create({ url: "chrome://extensions/?id=" + chrome.runtime.id }),
  );
  manager.hidden = true;
  let controller: AbortController | undefined;
  input.addEventListener("input", () => controller?.abort());
  remember.addEventListener("change", () => controller?.abort());
  check.addEventListener("click", () => {
    if (controller) return;
    controller = new AbortController();
    const current = controller;
    const entered = input.value.trim();
    const persist = remember.checked;
    manager.hidden = true;
    const manifest = chrome.runtime.getManifest();
    const declared = [
      ...(manifest.host_permissions ?? []),
      ...(manifest.optional_host_permissions ?? []),
    ];
    // Request access directly from the click gesture, only for a declared host.
    const permission = declared.includes(JEV_ORIGIN)
      ? chrome.permissions.request({ origins: [JEV_ORIGIN] })
      : Promise.reject(
          new Error(
            "The loaded extension is missing TypeSafe access in its manifest.",
          ),
        );
    check.disabled = true;
    check.textContent = "Checking Jev…";
    status.textContent =
      "Approve TypeSafe access if Chrome asks. Checking can take up to 15 seconds.";
    void (async () => {
      try {
        if (!(await permission))
          throw Error("TypeSafe access was not allowed.");
        const token = entered || (await key("jev"));
        if (!token) throw Error("Enter your TypeSafe API key first.");
        await checkJev(
          token,
          AbortSignal.any([current.signal, AbortSignal.timeout(15000)]),
        );
        current.signal.throwIfAborted();
        if (entered) await saveKey("jev", entered, persist);
        input.value = "";
        status.textContent =
          "Jev connected. Open your digest and click Analyse themes with Jev. No analysis request was made.";
      } catch (error) {
        status.textContent = current.signal.aborted
          ? "Check cancelled because the key changed."
          : error instanceof Error
            ? error.message
            : "Could not connect to Jev.";
        if (/manifest|permissions specified/i.test(status.textContent)) {
          manager.hidden = false;
          status.textContent =
            "Chrome's loaded extension has not registered TypeSafe access. Open the extension manager, reload X Feed Digest, then close this Settings tab and reopen it. The unpacked extension must point to this project's dist folder. If you installed a ZIP copy, update that copy with the rebuilt extension first.";
        }
      } finally {
        controller = undefined;
        check.disabled = false;
        check.textContent = "Save and check Jev connection";
      }
    })();
  });
  const remove = button("Remove Jev key", async () => {
    controller?.abort();
    await Promise.all([
      chrome.storage.session.remove("key:jev"),
      chrome.storage.local.remove("key:jev"),
    ]);
    input.value = "";
    status.textContent = "Jev key removed.";
  });
  const actions = el("div", undefined, "actions");
  actions.append(check, remove, manager);
  panel.append(
    el("h2", "Jev theme matching"),
    el(
      "p",
      "Use TypeSafe Jev to classify today's posts by meaning. This is separate from your analysis provider. Clicking Analyse themes with Jev sends post and quoted text to TypeSafe and may use paid credits.",
    ),
    label,
    input,
    rememberLabel,
    el(
      "small",
      "Session-only by default. Extension storage is not an encrypted vault.",
    ),
    actions,
    status,
    link("TypeSafe data handling", "https://docs.typesafe.ai/legal"),
  );
  window.addEventListener("pagehide", () => controller?.abort());
  return panel;
}
