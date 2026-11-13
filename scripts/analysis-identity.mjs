export function normalizeIdentityValue(value) {
  return String(value || "").trim().replace(/\/$/, "");
}

export function matchesAnalysisIdentity({ target, existing, output }) {
  if (!target?.id || !target?.title || !target?.videoUrl) return false;
  if (!existing?.id || !existing?.title || !existing?.videoUrl) return false;
  if (!output?.video_title || !output?.video_url) return false;

  return (
    String(existing.id) === String(target.id)
    && normalizeIdentityValue(existing.title) === normalizeIdentityValue(target.title)
    && normalizeIdentityValue(existing.videoUrl) === normalizeIdentityValue(target.videoUrl)
    && normalizeIdentityValue(output.video_title) === normalizeIdentityValue(target.title)
    && normalizeIdentityValue(output.video_url) === normalizeIdentityValue(target.videoUrl)
  );
}
