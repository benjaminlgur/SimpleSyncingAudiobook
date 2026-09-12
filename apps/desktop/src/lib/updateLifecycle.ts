let prepare: (() => Promise<void>) | undefined;
export function registerUpdatePreparation(callback: () => Promise<void>) {
  prepare = callback;
  return () => {
    if (prepare === callback) prepare = undefined;
  };
}
export async function prepareForUpdate() {
  await prepare?.();
}
