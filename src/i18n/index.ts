import en from "./messages/en.json";
import es from "./messages/es.json";
import fr from "./messages/fr.json";
import vi from "./messages/vi.json";
import zhCN from "./messages/zh-CN.json";

const dictionaries = { vi, en, es, fr, "zh-CN": zhCN } as const;

export type Locale = keyof typeof dictionaries;

export const localeOptions: ReadonlyArray<{ code: Locale; label: string }> = [
  { code: "vi", label: "Tiếng Việt" },
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "zh-CN", label: "简体中文" },
];

export function isLocale(value: string): value is Locale {
  return Object.hasOwn(dictionaries, value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function translate(locale: Locale, key: string): string {
  let value: unknown = dictionaries[locale];

  for (const segment of key.split(".")) {
    if (!isRecord(value)) return key;
    value = value[segment];
  }

  return typeof value === "string" ? value : key;
}
