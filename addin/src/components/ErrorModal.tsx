"use client";

import type { ValidationReport } from "@/lib/types";
import { countBySeverity } from "@/lib/ui";
import IssuePanel from "./IssuePanel";

interface Props {
  report: ValidationReport;
  onClose: () => void;
  onSend: () => void;
}

/**
 * Modale de validation (cf. AGENT_PLAN.md §6.4 / §6.5).
 * - « Corriger » ferme toujours.
 * - « Envoyer quand même » n'est actif que s'il n'y a AUCUNE erreur dure.
 * - Erreurs dures présentes → envoi désactivé (la PDP rejetterait).
 */
export default function ErrorModal({ report, onClose, onSend }: Props) {
  const { hard, soft } = countBySeverity(report);

  let title: string;
  let subtitle: string;
  if (hard > 0) {
    title = "Des erreurs bloquent l'envoi";
    subtitle = "La plateforme agréée rejetterait cette facture. Corrigez les cellules en rouge.";
  } else if (soft > 0) {
    title = "Avertissements détectés";
    subtitle = "Aucune erreur bloquante. Vous pouvez corriger ou envoyer quand même.";
  } else {
    title = "Facture prête à être envoyée";
    subtitle = "Aucun problème détecté.";
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        <div className="modal-body">
          <IssuePanel report={report} />
        </div>
        <div className="modal-foot">
          {hard > 0 && (
            <span className="hint">
              Envoi désactivé tant que des erreurs rouges subsistent.
            </span>
          )}
          <button className="btn" onClick={onClose}>
            Corriger
          </button>
          {report.issues.length === 0 ? (
            <button className="btn primary" onClick={onSend}>
              Envoyer
            </button>
          ) : (
            <button
              className="btn primary"
              onClick={onSend}
              disabled={hard > 0}
              title={
                hard > 0
                  ? "La plateforme rejettera cette facture : corrigez les erreurs en rouge d'abord."
                  : undefined
              }
            >
              Envoyer quand même
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
