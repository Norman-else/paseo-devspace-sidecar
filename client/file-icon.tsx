import { Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/ui";
import { fileIcon } from "../shared/file-icons";
import type { Colors } from "./review-ui";

/** A file-type mark sized like the surrounding icons (see shared/file-icons for the mapping). */
export function FileTypeIcon({ path, size = 14, colors }: { path: string; size?: number; colors: Colors }) {
  const icon = fileIcon(path);
  if (icon.kind === "svg") return <Icon icon={{ svg: icon.svg }} size={size} color={colors.foregroundMuted} />;
  if (icon.kind === "lucide") return <Icon name={icon.name} size={size} color={icon.color ?? colors.foregroundMuted} />;
  const fontSize = Math.round(size * 0.64 * (icon.scale ?? 1) * 10) / 10;
  return <View accessible={false} style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
    <Text numberOfLines={1} allowFontScaling={false} style={{ color: icon.color, fontSize, lineHeight: size, fontWeight: "800", letterSpacing: -0.4 }}>{icon.text}</Text>
  </View>;
}
