import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { z } from "zod";

const themeModeSchema = z.enum(["light", "dark", "auto"]);
const resolvedThemeSchema = z.enum(["light", "dark"]);
const themeKey = "theme";

type ThemeMode = z.infer<typeof themeModeSchema>;
type ResolvedTheme = z.infer<typeof resolvedThemeSchema>;

const getResolvedThemeFromDOM = () => {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
};

const getStoredThemeMode = () => {
  try {
    const storedTheme = localStorage.getItem(themeKey);
    return themeModeSchema.parse(storedTheme);
  } catch {
    return "auto";
  }
};

type ThemeContextProps = {
  themeMode: ThemeMode;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemeMode) => void;
  toggleMode: () => void;
};

const ThemeContext = createContext<ThemeContextProps | undefined>(undefined);

type ThemeProviderProps = {
  children: ReactNode;
};

const getSystemTheme = () =>
  window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

const setStoredThemeMode = (theme: ThemeMode) => {
  try {
    const parsedTheme = themeModeSchema.parse(theme);
    localStorage.setItem(themeKey, parsedTheme);
  } catch {
    localStorage.setItem(themeKey, "auto");
  }
};

const updateThemeClass = (themeMode: ThemeMode) => {
  const root = document.documentElement;
  root.classList.remove("light", "dark", "auto");
  const newTheme = themeMode === "auto" ? getSystemTheme() : themeMode;
  root.classList.add(newTheme);

  if (themeMode === "auto") {
    root.classList.add("auto");
  }
};

const getNextTheme = (current: ThemeMode): ThemeMode => {
  const themes: ThemeMode[] =
    getSystemTheme() === "dark"
      ? ["auto", "light", "dark"]
      : ["auto", "dark", "light"];
  return themes[(themes.indexOf(current) + 1) % themes.length];
};

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() =>
    getStoredThemeMode()
  );
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    getResolvedThemeFromDOM()
  );

  // Listen for system theme changes when in auto mode
  useEffect(() => {
    if (themeMode !== "auto") {
      return;
    }
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      updateThemeClass("auto");
      setResolvedTheme(getSystemTheme());
    };
    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, [themeMode]);

  const setTheme = (newTheme: ThemeMode) => {
    setThemeMode(newTheme);
    setStoredThemeMode(newTheme);
    updateThemeClass(newTheme);
    setResolvedTheme(newTheme === "auto" ? getSystemTheme() : newTheme);
  };

  const toggleMode = () => {
    setTheme(getNextTheme(themeMode));
  };

  return (
    <ThemeContext.Provider
      value={{ themeMode, resolvedTheme, setTheme, toggleMode }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
};
