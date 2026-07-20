export function extractWebSources(groundingMetadata) {
  const seen = new Set();
  return (groundingMetadata?.groundingChunks || [])
    .map((chunk) => chunk?.web)
    .filter((source) => source?.uri && source?.title)
    .filter((source) => {
      if (seen.has(source.uri)) return false;
      seen.add(source.uri);
      return true;
    })
    .slice(0, 8)
    .map((source) => ({ title: String(source.title), url: String(source.uri) }));
}

export function notesChatScopeKey(subjectId, lessonId) {
  return lessonId ? `${subjectId}_${lessonId}` : subjectId;
}
