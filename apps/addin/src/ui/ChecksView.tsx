// Contrôles (R2): what the checks across documents found — an invoice against its order, its delivery
// notes, the price list — each with its money at stake and the cells to look at; and the documents
// that look alike with no number to tie them, for a « Oui » or a « Non ». A line sold under its
// purchase price (R3) points at the purchase: a row of « Achats », or the supplier's invoice in
// « Réception ». The fiche of an invoice shows its own findings with the same card.
import { frDate, frMoney } from '@fi/core';
import { type MessageKey, t } from '@fi/shared';
import {
  Badge,
  Button,
  Caption1,
  Card,
  makeStyles,
  Spinner,
  Subtitle2,
  Text,
  tokens,
} from '@fluentui/react-components';
import type { Evidence, Finding, ProposedLink } from '../api';
import { parisTime, useFi } from './context';
import { CorrectedCard, EditCardView } from './EditCard';
import { TEST_ORANGE } from './theme';

const useStyles = makeStyles({
  section: { display: 'flex', flexDirection: 'column', gap: '10px' },
  list: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  card: { display: 'flex', flexDirection: 'column', gap: '6px', padding: '10px' },
  line: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
  stake: { fontWeight: tokens.fontWeightSemibold },
  muted: { color: tokens.colorNeutralForeground3 },
});

const SEVERITY: Record<Finding['severity'], MessageKey> = {
  blocking: 'addin.checks.blocking',
  warning: 'addin.checks.warning',
  info: 'addin.checks.info',
};

/** « Voir la commande »… for each document a finding points at, other than the invoice itself. */
const SEE: Record<Exclude<Evidence['role'], 'invoice'>, MessageKey> = {
  order: 'addin.checks.see.order',
  delivery: 'addin.checks.see.delivery',
  price_list: 'addin.checks.see.price_list',
  history: 'addin.checks.see.history',
  purchase: 'addin.checks.see.purchase',
};

const seeLabel = (e: Evidence): MessageKey =>
  e.role === 'purchase' && !e.cell ? 'addin.checks.see.inbound' : SEE[e.role as keyof typeof SEE];

const money = (cents: number) => frMoney(cents, 'EUR');

/** One finding: its money, its wording, and the buttons to the cells. */
export function FindingCard({ finding, onFiche }: { finding: Finding; onFiche?: boolean }) {
  const styles = useStyles();
  const [state, fi] = useFi();
  // The invoice's own cell is the one to correct: the last invoice evidence is the one it is about.
  const fix = finding.evidence.findLast((e) => e.role === 'invoice' && e.cell);
  const card = state.card?.findingId === finding.id ? state.card : null;
  const seen = new Set<string>();
  const others = finding.evidence.filter((e) => {
    if (e.role === 'invoice' || !(e.cell || e.inboundId) || seen.has(e.role)) return false;
    seen.add(e.role);
    return true;
  });
  return (
    <Card className={styles.card} data-testid="finding">
      <span className={styles.line}>
        <Badge appearance="tint" color={finding.severity === 'blocking' ? 'danger' : 'warning'}>
          {t(SEVERITY[finding.severity])}
        </Badge>
        {finding.amount !== null && (
          <Text className={styles.stake}>
            {t('addin.checks.amount', { amount: money(finding.amount) })}
          </Text>
        )}
        {finding.isTest && (
          <Badge appearance="filled" style={{ backgroundColor: TEST_ORANGE, color: '#1f1300' }}>
            {t('addin.checks.test')}
          </Badge>
        )}
      </span>
      <Text>{finding.message}</Text>
      <span className={styles.line}>
        {fix && (
          <Button
            size="small"
            appearance="primary"
            disabled={state.busy.includes('select')}
            onClick={() => void fi.showEvidence(fix)}
          >
            {t('addin.checks.fixLine')}
          </Button>
        )}
        {others.map((e) => (
          <Button
            key={e.role}
            size="small"
            disabled={state.busy.includes('select')}
            onClick={() => void fi.showEvidence(e)}
          >
            {t(seeLabel(e))}
          </Button>
        ))}
        {finding.costLinkId && (
          <Button
            size="small"
            appearance="subtle"
            disabled={state.busy.includes(`link:${finding.costLinkId}`)}
            onClick={() => finding.costLinkId && void fi.notSameItem(finding.costLinkId)}
          >
            {t('addin.checks.notSameItem')}
          </Button>
        )}
        {!onFiche && finding.invoiceId && (
          <Button
            size="small"
            appearance="subtle"
            onClick={() => finding.invoiceId && void fi.openInvoice(finding.invoiceId)}
          >
            {t('addin.checks.openInvoice')}
          </Button>
        )}
      </span>
      {(finding.fix || state.checks?.assistant) && !card && (
        <span className={styles.line}>
          {finding.fix && (
            <Button
              size="small"
              appearance="primary"
              disabled={state.busy.includes(`fix:${finding.id}`) || state.card !== null}
              onClick={() => void fi.fixFinding(finding.id)}
            >
              {t('addin.checks.fixForMe')}
            </Button>
          )}
          {state.checks?.assistant && (
            <Button size="small" onClick={() => void fi.openChat(finding.id)}>
              {t('addin.checks.ask')}
            </Button>
          )}
        </span>
      )}
      {card && <EditCardView card={card} />}
    </Card>
  );
}

function linkQuestion(link: ProposedLink): string {
  const from = link.from?.number ?? t('check.noNumber');
  const to = link.to?.number ?? t('check.noNumber');
  if (link.kind === 'fulfils') return t('addin.checks.link.fulfils', { from, to });
  return link.from?.kind === 'delivery'
    ? t('addin.checks.link.delivery', { from, to })
    : t('addin.checks.link.order', { from, to });
}

function linkDetails(link: ProposedLink): string {
  const doc = link.from;
  return [
    doc?.partyName,
    doc?.issueDate ? frDate(doc.issueDate) : null,
    doc?.netTotal !== null && doc?.netTotal !== undefined
      ? t('addin.checks.link.net', { amount: money(doc.netTotal) })
      : null,
    t('addin.checks.link.score', { score: link.score }),
  ]
    .filter(Boolean)
    .join(' · ');
}

export function ChecksView() {
  const styles = useStyles();
  const [state, fi] = useFi();
  const checks = state.checks;
  if (!checks) {
    return state.busy.includes('checks') ? <Spinner label={t('addin.loading')} /> : null;
  }
  const real = checks.findings.filter((f) => !f.isTest);
  // An undo card for a finding the correction closed: it is no longer in the list.
  const loose =
    state.card && !checks.findings.some((f) => f.id === state.card?.findingId) ? state.card : null;
  return (
    <section className={styles.section} aria-labelledby="checks-title">
      <Subtitle2 as="h2" id="checks-title">
        {t('addin.checks.title')}
      </Subtitle2>
      <Caption1 className={styles.muted}>{t('addin.checks.intro')}</Caption1>
      <span className={styles.line}>
        <Text className={styles.stake} data-testid="checks-summary">
          {real.length > 0
            ? t('addin.checks.atStake', { amount: money(checks.atStake), count: real.length })
            : t('addin.checks.none')}
        </Text>
        {checks.checkedAt && (
          <Caption1 className={styles.muted}>
            {t('addin.checks.checkedAt', { time: parisTime(checks.checkedAt) })}
          </Caption1>
        )}
        {state.busy.includes('checks') && <Spinner size="tiny" />}
      </span>

      {loose && <EditCardView card={loose} />}
      {state.corrected?.undoable && !loose && <CorrectedCard edit={state.corrected} />}

      {checks.links.length > 0 && (
        <>
          <Subtitle2 as="h3">{t('addin.checks.links.title')}</Subtitle2>
          <Caption1 className={styles.muted}>{t('addin.checks.links.intro')}</Caption1>
          <ul className={styles.list}>
            {checks.links.map((link) => (
              <li key={link.id}>
                <Card className={styles.card} data-testid="proposed-link">
                  <Text weight="semibold">{linkQuestion(link)}</Text>
                  <Caption1 className={styles.muted}>{linkDetails(link)}</Caption1>
                  <span className={styles.line}>
                    <Button
                      size="small"
                      appearance="primary"
                      disabled={state.busy.includes(`link:${link.id}`)}
                      onClick={() => void fi.decideLink(link.id, 'confirmed')}
                    >
                      {t('addin.checks.yes')}
                    </Button>
                    <Button
                      size="small"
                      disabled={state.busy.includes(`link:${link.id}`)}
                      onClick={() => void fi.decideLink(link.id, 'rejected')}
                    >
                      {t('addin.checks.no')}
                    </Button>
                  </span>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}

      {checks.findings.length > 0 ? (
        <ul className={styles.list}>
          {checks.findings.map((f) => (
            <li key={f.id}>
              <FindingCard finding={f} />
            </li>
          ))}
        </ul>
      ) : (
        checks.links.length === 0 && (
          <Caption1 className={styles.muted}>{t('addin.checks.hint')}</Caption1>
        )
      )}
    </section>
  );
}
