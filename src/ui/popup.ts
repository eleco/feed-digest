import { button, command, el, link, notice, runSummary, shell } from "./common";
import { current, lastScan } from "../storage/db";
import { active } from "../shared/types";
document.body.classList.add("popup");
const main = shell(
  "A little less noise.",
  "Reads a bounded sample from your signed-in X home feeds. Scanning opens a visible, dedicated X tab.",
);
const state = el("p", "Ready when you are.", "status-line");
state.setAttribute("aria-live", "polite");
main.append(state);
const actions = el("div", undefined, "actions");
const scan = button(
  "Scan both feeds",
  async () => {
    await command("start");
    await update();
  },
  "primary",
);
const open = button("Open digest", () =>
  chrome.tabs.create({ url: chrome.runtime.getURL("digest.html") }),
);
const stop = button("Stop", async () => {
  await command("stop");
  await update();
});
actions.append(scan, open, stop);
const links = el("p", undefined, "popup-links");
links.append(
  link("AI activity", "activity.html"),
  el("span", " · "),
  link("Settings", "settings.html"),
);
main.append(
  actions,
  links,
  el(
    "p",
    "Posts stay on this device. Use Analyse with AI in the digest to add categories.",
    "muted",
  ),
);
async function update() {
  const r = await current();
  const busy = active(r);
  scan.disabled = busy;
  stop.hidden = !busy;
  state.textContent = runSummary(busy ? r : ((await lastScan()) ?? r));
}
void command("recover")
  .then(update)
  .catch((e) => notice(e.message));
setInterval(() => void update(), 1500);

for (const a of document.querySelectorAll<HTMLAnchorElement>("a"))
  a.addEventListener("click", (event) => {
    event.preventDefault();
    void chrome.tabs.create({ url: a.href });
  });
