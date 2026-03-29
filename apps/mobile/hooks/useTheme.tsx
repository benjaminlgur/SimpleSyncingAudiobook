import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useColorScheme } from "nativewind";
import AsyncStorage from "@react-native-async-storage/async-storage";

type ThemePreference = "light" | "dark" | "system";

interface ThemeContextType {
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
  isDark: boolean;
}

const THEME_KEY = "audiobook_theme";

const ThemeContext = createContext<ThemeContextType>({
  theme: "system",
  setTheme: () => {},
  isDark: false,
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { colorScheme, setColorScheme } = useColorScheme();
  const [theme, setThemeState] = useState<ThemePreference>("system");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(THEME_KEY).then((stored) => {
      if (stored === "light" || stored === "dark" || stored === "system") {
        setThemeState(stored);
        setColorScheme(stored);
      } else {
        setColorScheme("system");
      }
      setLoaded(true);
    });
  }, [setColorScheme]);

  const setTheme = useCallback(
    (next: ThemePreference) => {
      setThemeState(next);
      setColorScheme(next);
      AsyncStorage.setItem(THEME_KEY, next);
    },
    [setColorScheme],
  );

  const isDark = colorScheme === "dark";

  if (!loaded) return null;

  return (
    <ThemeContext.Provider value={{ theme, setTheme, isDark }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
