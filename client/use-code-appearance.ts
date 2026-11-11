import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { DEFAULT_MONO_FONT } from "../shared/appearance";
import { readCodeAppearance, watchCodeAppearance } from "./web";

const fallback = Platform.OS === "web" ? DEFAULT_MONO_FONT : Platform.OS === "ios" ? "ui-monospace" : "monospace";
export function useCodeAppearance() {
  const [appearance, setAppearance] = useState(() => readCodeAppearance(fallback));
  useEffect(() => watchCodeAppearance(fallback, setAppearance), []);
  return appearance;
}
