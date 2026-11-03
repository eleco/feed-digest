import { button, command } from "./common";
import { current } from "../storage/db";
import { active, type Post, type Ranked, type Run } from "../shared/types";
export function pendingAnalysisPosts(
  posts: Pick<Post, "id">[],
  results: Ranked[],
) {
  const analysed = new Set(
    results
      .filter(
        (item) => item.mode === "ai" && item.recommendations !== undefined,
      )
      .map((item) => item.id),
  );
  return posts.filter((post) => !analysed.has(post.id));
}
export function pendingAnalysisCount(
  posts: Pick<Post, "id">[],
  results: Ranked[],
) {
  return pendingAnalysisPosts(posts, results).length;
}
export function updateAnalysisButton(
  control: HTMLButtonElement,
  run?: Run,
  pending = Number(control.dataset.pending ?? 0),
) {
  control.dataset.pending = String(pending);
  control.disabled = active(run) || pending === 0;
  control.textContent = `${control.dataset.label} (${pending})`;
}
export function analysisButton(
  label: string,
  selection: () => { scope: string; postIds: string[] },
  confirmSelection?: () => boolean,
) {
  const control = button(label, async () => {
    const selected = selection();
    if (!selected.postIds.length || (confirmSelection && !confirmSelection()))
      return;
    control.disabled = true;
    control.textContent = "Starting AI…";
    try {
      await command("analyse", selected);
    } finally {
      updateAnalysisButton(control, await current());
    }
  });
  control.dataset.label = label;
  control.disabled = true;
  return control;
}
