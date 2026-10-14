export function buildStagingRequestUrl(path, baseUrl) {
  return new URL(path, `${baseUrl.origin}/`);
}
