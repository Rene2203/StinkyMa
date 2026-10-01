import { ShieldAlert, X } from "lucide-react";
import type { PhishingAssessment, PhishingReason } from "@stinkyma/core";
import { useState } from "react";
import { useUi } from "../context.js";
import type { Translate } from "../i18n.js";

export function reasonText(reason: PhishingReason, t: Translate): string {
  switch (reason.code) {
    case "brandMismatch":
      return t("phishing.brandMismatch", { brand: reason.brand, domain: reason.domain });
    case "freemailOfficial":
      return t("phishing.freemailOfficial", { name: reason.name, domain: reason.domain });
    case "linkMismatch":
      return t("phishing.linkMismatch", { shown: reason.shown, target: reason.target });
    case "ipLink":
      return t("phishing.ipLink", { target: reason.target });
    case "shortLink":
      return t("phishing.shortLink", { target: reason.target });
    case "pressure":
      return t("phishing.pressure", { phrase: reason.phrase });
    case "credentials":
      return t("phishing.credentials", { phrase: reason.phrase });
    case "paymentLink":
      return t("phishing.paymentLink", { phrase: reason.phrase });
    case "tooGood":
      return t("phishing.tooGood", { phrase: reason.phrase });
    case "giftCards":
      return t("phishing.giftCards");
    case "riskyAttachment":
      return t("phishing.riskyAttachment", { filename: reason.filename });
    case "aiSuspect":
      return t("phishing.aiSuspect");
  }
}

/** Warnleiste über einer verdächtigen Mail – mit nachvollziehbaren Gründen. */
export function PhishingBanner({ assessment }: { assessment: PhishingAssessment }) {
  const { t } = useUi();
  const [hidden, setHidden] = useState(false);
  if (assessment.level === "none" || hidden) return null;
  return (
    <section className={`phishing-banner ${assessment.level}`} role="alert" data-testid="phishing-banner">
      <ShieldAlert size={18} aria-hidden="true" />
      <div className="phishing-text">
        <strong>{assessment.level === "danger" ? t("phishing.danger") : t("phishing.caution")}</strong>
        <ul>
          {assessment.reasons.map((reason, index) => (
            <li key={index}>{reasonText(reason, t)}</li>
          ))}
        </ul>
        <span className="small">{t("phishing.advice")}</span>
      </div>
      <button type="button" className="icon-button" title={t("phishing.hide")} aria-label={t("phishing.hide")} onClick={() => setHidden(true)}>
        <X size={14} />
      </button>
    </section>
  );
}
