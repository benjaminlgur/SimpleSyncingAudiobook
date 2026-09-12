import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { prepareForUpdate } from "../lib/updateLifecycle";

export function UpdateNotice({ manual = false }: { manual?: boolean }) {
  const [update, setUpdate] = useState<Update | null>(null);
  const [message, setMessage] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!isTauri() || import.meta.env.DEV || (manual && attempt === 0)) return;
    let disposed = false;
    let found: Update | null = null;
    void check()
      .then((result) => {
        found = result;
        if (disposed) void result?.close();
        else {
          setUpdate(result);
          setMessage(result ? "" : "Up to date.");
        }
      })
      .catch(() => {
        if (!disposed)
          setMessage(
            "Unable to check for updates. Check your connection and retry.",
          );
      });
    return () => {
      disposed = true;
      void found?.close();
    };
  }, [attempt, manual]);
  const install = async () => {
    if (!update) return;
    setMessage("Installing update…");
    try {
      await prepareForUpdate();
      await update.downloadAndInstall();
      await relaunch();
    } catch {
      setMessage("Update failed. Please retry when connected.");
    }
  };
  if (!update)
    return manual && isTauri() && !import.meta.env.DEV ? (
      <div className="p-3 text-sm" role="status">
        <button
          className="underline"
          onClick={() => setAttempt((value) => value + 1)}
        >
          Check for updates
        </button>
        <p>{message}</p>
      </div>
    ) : null;
  return (
    <div className="p-3 bg-card text-sm" role="status">
      Version {update.version} is available. Pause playback before installing.
      <button
        className="underline mx-2"
        disabled={message === "Installing update…"}
        onClick={() => void install()}
      >
        Install and restart
      </button>
      {message}
    </div>
  );
}
