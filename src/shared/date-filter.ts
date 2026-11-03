export function localDateTime(at: number) {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
export function inDateRange(
  publishedAt: number | null,
  start: number | null,
  end: number | null,
) {
  if (start === null && end === null) return true;
  if (publishedAt === null || !Number.isFinite(publishedAt)) return false;
  if (
    (start !== null && !Number.isFinite(start)) ||
    (end !== null && !Number.isFinite(end))
  )
    return false;
  return (
    (start === null || publishedAt >= start) &&
    (end === null || publishedAt <= end)
  );
}
