import { useState } from "react";
import { Image, Text, View } from "react-native";
import { ExternalLink } from "@getpaseo/plugin/client/ui";
import type { ReviewThread } from "../shared/review-details";
import type { Colors } from "./review-ui";
import { useMessages } from "./messages";
type Comment = ReviewThread["comments"][number];
export function CommentAvatar({ comment, colors, size = 32 }: { comment?: Comment; colors: Colors; size?: number }) {
  const { t } = useMessages();
  const [failed, setFailed] = useState<string | null>(null);
  const name = comment?.name?.trim() || comment?.author || "?";
  const uri = comment?.avatarUrl?.startsWith("https://") ? comment.avatarUrl : null;
  return <View style={{ width: size, height: size, flexShrink: 0, borderRadius: size / 2, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
    {uri && failed !== uri ? <Image accessibilityLabel={t("authorAvatar", { name })} source={{ uri }} onError={() => setFailed(uri)} style={{ width: size, height: size }} /> : <Text accessibilityLabel={t("authorAvatar", { name })} style={{ color: colors.foregroundMuted, fontSize: Math.round(size * 0.45), fontWeight: "500" }}>{Array.from(name)[0]?.toLocaleUpperCase() ?? "?"}</Text>}
  </View>;
}
export function CommentAuthor({ comment, colors }: { comment: Comment; colors: Colors }) {
  const name = comment.name?.trim() || comment.author;
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
    <CommentAvatar comment={comment} colors={colors} />
    <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
      <ExternalLink href={comment.authorUrl ?? comment.url}><Text numberOfLines={1} style={{ flexShrink: 1, minWidth: 0, color: colors.foreground, fontSize: 13, fontWeight: "500", lineHeight: 18 }}>{name}</Text></ExternalLink>
      {name !== comment.author ? <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 11, lineHeight: 15 }}>@{comment.author}</Text> : null}
    </View>
  </View>;
}
