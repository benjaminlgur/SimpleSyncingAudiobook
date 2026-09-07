export function normalizeDeploymentUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== "https:" || !url.hostname.endsWith(".convex.cloud") || url.username || url.password || url.port || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Enter a Convex deployment URL such as https://your-project.convex.cloud");
  }
  return url.origin;
}
