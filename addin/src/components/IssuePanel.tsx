import type { Issue, ValidationReport } from "@/lib/types";

function Row({ issue }: { issue: Issue }) {
  const isHard = issue.severity === "hard";
  return (
    <li>
      <span className={`tag ${isHard ? "hard" : "soft"}`}>{issue.code}</span>
      <div className="issue-body">
        <b>
          {issue.field}
          {issue.cell_ref ? ` · cellule ${issue.cell_ref}` : ""}
        </b>
        <p>{issue.message_fr}</p>
      </div>
    </li>
  );
}

/** Liste des problèmes, groupés par sévérité (erreurs dures d'abord). */
export default function IssuePanel({ report }: { report: ValidationReport }) {
  const hard = report.issues.filter((i) => i.severity === "hard");
  const soft = report.issues.filter((i) => i.severity === "soft");

  if (report.issues.length === 0) {
    return <p className="status ok"><span className="dot" /> Aucun problème détecté.</p>;
  }

  return (
    <>
      {hard.length > 0 && (
        <>
          <h2>Erreurs bloquantes ({hard.length})</h2>
          <ul className="issues">{hard.map((i, k) => <Row key={`h${k}`} issue={i} />)}</ul>
        </>
      )}
      {soft.length > 0 && (
        <>
          <h2 style={{ marginTop: 14 }}>Avertissements ({soft.length})</h2>
          <ul className="issues">{soft.map((i, k) => <Row key={`s${k}`} issue={i} />)}</ul>
        </>
      )}
    </>
  );
}
