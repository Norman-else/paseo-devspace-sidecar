import { defineTranslations, useTranslation } from "@getpaseo/plugin/client";
import { backendMessages, en, zh } from "../shared/messages";

export const messages = defineTranslations({ resources: { en, zh, "zh-CN": zh, "zh-Hans": zh } });
export function useMessages() {
  const { t, locale } = useTranslation(messages);
  const backendMap: Readonly<Record<string, (typeof backendMessages)[keyof typeof backendMessages]>> = backendMessages;
  const translateBackend = (text: string) => {
    const exact = backendMap[text];
    if (exact) return t(exact);
    // RPC errors can include a prefix from the host; retain unknown diagnostic details.
    for (const [message, key] of Object.entries(backendMessages)) if (text.includes(message)) return t(key);
    return text;
  };
  return { t, locale, translateBackend };
}
