import { displayName, formatAddressList, type ComposeLabels, type Message } from "@stinkyma/core";
import { formatFullDate, formatList } from "./format.js";
import type { Locale, Translate } from "./i18n.js";

/** Texte für Zitat-Kopf und Weiterleitung in der Sprache der Oberfläche. */
export function composeLabels(t: Translate, locale: Locale): ComposeLabels {
  return {
    wrote: (m: Message) => t("compose.wrote", { date: formatFullDate(m.date, locale), name: displayName(m.from) }),
    forwardHeader: (m: Message) =>
      [
        t("compose.forwardHeader"),
        `${t("compose.forwardFrom")}: ${formatAddressList([m.from])}`,
        `${t("compose.forwardDate")}: ${formatFullDate(m.date, locale)}`,
        `${t("compose.forwardSubject")}: ${m.subject}`,
        `${t("compose.forwardTo")}: ${formatList(m.to.map((a) => formatAddressList([a])), locale)}`,
      ].join("\n"),
  };
}
