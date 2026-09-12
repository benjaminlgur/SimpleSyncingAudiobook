import { useAuthActions } from "@convex-dev/auth/react";
import { useTheme } from "../hooks/useTheme";
import { UpdateNotice } from "./UpdateNotice";
import { useConnectionMode } from "../App";

type ThemePreference = "light" | "dark" | "system";

interface SettingsProps {
  onBack: () => void;
  onDisconnect: () => void;
}

const THEME_OPTIONS: {
  value: ThemePreference;
  label: string;
  icon: React.ReactNode;
}[] = [
  {
    value: "light",
    label: "Light",
    icon: (
      <svg
        className="h-5 w-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z"
        />
      </svg>
    ),
  },
  {
    value: "dark",
    label: "Dark",
    icon: (
      <svg
        className="h-5 w-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z"
        />
      </svg>
    ),
  },
  {
    value: "system",
    label: "System",
    icon: (
      <svg
        className="h-5 w-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25A2.25 2.25 0 0 1 5.25 3h13.5A2.25 2.25 0 0 1 21 5.25Z"
        />
      </svg>
    ),
  },
];

function SignOutButton({ onDisconnect }: { onDisconnect: () => void }) {
  const { signOut } = useAuthActions();

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch {
      // May fail if already signed out
    }
    onDisconnect();
  };

  return (
    <button
      onClick={handleSignOut}
      className="w-full rounded-lg border border-destructive/30 text-destructive bg-destructive/5 hover:bg-destructive/10 px-4 py-3 text-sm font-medium transition-colors text-left"
    >
      Sign out
    </button>
  );
}

export function Settings({ onBack, onDisconnect }: SettingsProps) {
  const { theme, setTheme } = useTheme();
  const mode = useConnectionMode();
  const isHosted = mode === "hosted";

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border px-4 py-3 flex items-center">
        <button
          onClick={onBack}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.75 19.5 8.25 12l7.5-7.5"
            />
          </svg>
          Library
        </button>
      </header>

      <div className="flex-1 p-4 overflow-auto">
        <h1 className="text-lg font-semibold text-foreground mb-6">Settings</h1>
        <UpdateNotice manual />

        <section className="mb-8">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Appearance
          </h2>
          <div className="grid grid-cols-3 gap-2">
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.value}
                onClick={() => setTheme(option.value)}
                className={`flex flex-col items-center gap-2 rounded-lg border p-4 transition-all ${
                  theme === option.value
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground"
                }`}
              >
                {option.icon}
                <span className="text-xs font-medium">{option.label}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="mb-8">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Support
          </h2>
          <a
            href="https://www.buymeacoffee.com/benjaminlgur"
            target="_blank"
            rel="noopener noreferrer"
            className="group flex w-full items-center gap-3 rounded-lg border border-[#FFDD00]/40 bg-[#FFDD00] px-4 py-3 text-sm font-semibold text-[#0D0C22] shadow-sm hover:bg-[#FFE633] hover:border-[#FFDD00] transition-colors"
          >
            <svg
              className="h-5 w-5 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M17 8h1a3 3 0 0 1 0 6h-1" />
              <path d="M3 8h14v7a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V8Z" />
              <path d="M7 4v2" />
              <path d="M11 4v2" />
              <path d="M15 4v2" />
            </svg>
            <span className="flex-1 text-left">Buy me a coffee</span>
            <svg
              className="h-4 w-4 opacity-60 group-hover:opacity-100 transition-opacity"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13.5 6H18m0 0v4.5M18 6 6 18"
              />
            </svg>
          </a>
          <p className="text-xs text-muted-foreground mt-2">
            If you enjoy this app, you can support its development.
          </p>
        </section>

        <section>
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            {isHosted ? "Account" : "Connection"}
          </h2>
          {isHosted ? (
            <SignOutButton onDisconnect={onDisconnect} />
          ) : (
            <button
              onClick={onDisconnect}
              className="w-full rounded-lg border border-destructive/30 text-destructive bg-destructive/5 hover:bg-destructive/10 px-4 py-3 text-sm font-medium transition-colors text-left"
            >
              Disconnect from Convex
            </button>
          )}
          <p className="text-xs text-muted-foreground mt-2">
            {isHosted
              ? "This will sign you out and return to the setup screen."
              : "This will remove the saved deployment URL and return to the setup screen."}
          </p>
        </section>
      </div>
    </div>
  );
}
