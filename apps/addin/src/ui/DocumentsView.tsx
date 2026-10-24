// « Documents » (BTP plan stage 2B, `docs/plans/phase-2.md`; stage 3B, `phase-3.md`): the requests
// waiting for a person (« À valider »), the deadlines the company's documents make, the documents a
// person must say something about, and every document received. In « Mode test », the test ones.
import { frDate, frMoney, isValidSiren } from '@fi/core';
import {
  DEADLINE_DATE,
  DOCUMENT_KINDS,
  type DocumentKind,
  INVOICE_KINDS,
  STANDING_KINDS,
} from '@fi/domain';
import { t } from '@fi/shared';
import {
  Badge,
  Button,
  Caption1,
  Card,
  Field,
  Input,
  Link,
  makeStyles,
  Select,
  Spinner,
  Subtitle2,
  Tab,
  TabList,
  Text,
  tokens,
} from '@fluentui/react-components';
import { useRef, useState } from 'react';
import type { DocumentItem, Obligation, ReviewInput } from '../api';
import { DOCUMENT_HORIZON, YEAR_HORIZON } from '../controller';
import { ActionsPart } from './ActionsPart';
import { parisDateTime, useFi } from './context';
import { daysBetween, when } from './days';

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
  head: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px' },
  muted: { color: tokens.colorNeutralForeground3 },
  excerpt: {
    margin: 0,
    padding: '6px 8px',
    borderLeft: `3px solid ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground2,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    fontSize: tokens.fontSizeBase200,
  },
});

/** The files the browser lets the person choose; what they are is read from their bytes. */
const DEPOSIT_ACCEPT = '.pdf,.png,.jpg,.jpeg,.tif,.tiff,.xml';

const STAGE_COLOR = {
  ingested: 'informative',
  classified: 'informative',
  extracted: 'informative',
  validated: 'informative',
  linked: 'informative',
  done: 'success',
  needs_review: 'warning',
} as const;

const DATE_LABEL = {
  issuedOn: 'addin.documents.form.issuedOn',
  validTo: 'addin.documents.form.validTo',
  receptionOn: 'addin.documents.form.receptionOn',
} as const;

const reasonText = (reason: string | null) =>
  reason && REASONS.has(reason)
    ? t(`addin.documents.reason.${reason as Reason}`)
    : t('addin.documents.reason.other');
const REASON_CODES = [
  'unclassified',
  'invoice_without_data',
  'dates_missing',
  'party_unclear',
  'other_company',
  'missing_file',
  'no_text',
  'damaged',
  'xml',
] as const;
type Reason = (typeof REASON_CODES)[number];
const REASONS = new Set<string>(REASON_CODES);

function Due({ item, today }: { item: Obligation; today: string }) {
  const styles = useStyles();
  const [state, fi] = useFi();
  const busy = state.busy.includes(`obligation:${item.id}`);
  const who =
    item.party?.name ?? (item.siren ? t('addin.documents.siren', { siren: item.siren }) : null);
  return (
    <li>
      <Card className={styles.card} data-testid={`due-${item.kind}`}>
        <span className={styles.head}>
          <span className={styles.line}>
            <Text weight="semibold">{frDate(item.dueOn)}</Text>
            {item.overdue && (
              <Badge color="danger" appearance="filled">
                {t('addin.documents.overdue')}
              </Badge>
            )}
          </span>
          <Caption1 className={styles.muted}>{when(daysBetween(today, item.dueOn))}</Caption1>
        </span>
        <Text>{t(`addin.documents.due.${item.kind}`)}</Text>
        {who && <Text size={200}>{who}</Text>}
        <Caption1 className={styles.muted}>
          {item.amount !== null && `${frMoney(item.amount)} · `}
          {item.document
            ? t('addin.documents.from', { file: item.document.name })
            : t('addin.documents.fromInvoice')}
        </Caption1>
        <span className={styles.line}>
          <Button
            size="small"
            disabled={busy}
            onClick={() => void fi.closeObligation(item.id, 'done')}
          >
            {t('addin.documents.done')}
          </Button>
          <Button
            size="small"
            appearance="subtle"
            disabled={busy}
            onClick={() => void fi.closeObligation(item.id, 'dismissed')}
          >
            {t('addin.documents.dismiss')}
          </Button>
          {busy && <Spinner size="tiny" />}
        </span>
      </Card>
    </li>
  );
}

function DeadlinesPart() {
  const styles = useStyles();
  const [state, fi] = useFi();
  const pane = state.documents;
  if (!pane) return null;
  const year = pane.horizon >= YEAR_HORIZON;
  return (
    <div className={styles.section} data-testid="deadlines">
      {pane.obligations.length === 0 ? (
        <Text>{t(year ? 'addin.documents.noDueYear' : 'addin.documents.noDue')}</Text>
      ) : (
        <ul className={styles.list}>
          {pane.obligations.map((o) => (
            <Due key={o.id} item={o} today={pane.today} />
          ))}
        </ul>
      )}
      <Link
        as="button"
        onClick={() => void fi.loadDocuments(year ? DOCUMENT_HORIZON : YEAR_HORIZON)}
      >
        {t(year ? 'addin.documents.showSoon' : 'addin.documents.showYear')}
      </Link>
    </div>
  );
}

/** The form that answers a review: the kind, then the date and the company that kind needs. */
function ReviewForm({ doc }: { doc: DocumentItem }) {
  const styles = useStyles();
  const [state, fi] = useFi();
  const read = doc.review?.fields ?? null;
  const others = (read?.sirens ?? []).filter((s) => s !== state.me?.tenant.siren);
  const [kind, setKind] = useState<DocumentKind | ''>(doc.kind ?? '');
  const [dates, setDates] = useState({
    issuedOn: read?.issuedOn ?? '',
    validTo: read?.validTo ?? '',
    receptionOn: read?.receptionOn ?? '',
  });
  const [siren, setSiren] = useState(others.length === 1 ? (others[0] ?? '') : '');
  const date = kind ? DEADLINE_DATE[kind] : undefined;
  const standing = kind !== '' && STANDING_KINDS.includes(kind);
  const sirenOk = isValidSiren(siren.replace(/\s/g, ''));
  const ready = kind !== '' && (!date || dates[date] !== '') && (!standing || sirenOk);
  const busy = state.busy.includes(`review:${doc.id}`);

  const save = () => {
    if (!kind) return;
    const input: ReviewInput = { kind };
    if (date) input[date] = dates[date];
    if (standing) input.siren = siren.replace(/\s/g, '');
    void fi.reviewDocument(doc.id, input);
  };

  return (
    <div className={styles.section}>
      <Field label={t('addin.documents.form.kind')}>
        <Select
          value={kind}
          onChange={(_, d) => setKind(d.value as DocumentKind | '')}
          data-testid="review-kind"
        >
          <option value="">{t('addin.documents.form.choose')}</option>
          {DOCUMENT_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`addin.documents.kind.${k}`)}
            </option>
          ))}
        </Select>
      </Field>
      {date && (
        <Field label={t(DATE_LABEL[date])} required>
          <Input
            type="date"
            value={dates[date]}
            onChange={(_, d) => setDates({ ...dates, [date]: d.value })}
            data-testid="review-date"
          />
        </Field>
      )}
      {standing && (
        <Field
          label={t('addin.documents.form.siren')}
          hint={t('addin.documents.form.sirenHint')}
          required
          validationMessage={
            siren !== '' && !sirenOk ? t('addin.documents.form.sirenInvalid') : undefined
          }
        >
          <Input
            value={siren}
            inputMode="numeric"
            onChange={(_, d) => setSiren(d.value)}
            data-testid="review-siren"
          />
        </Field>
      )}
      {kind !== '' && INVOICE_KINDS.includes(kind) && (
        <Caption1 className={styles.muted}>{t('addin.documents.form.invoiceNote')}</Caption1>
      )}
      <span className={styles.line}>
        <Button appearance="primary" disabled={!ready || busy} onClick={save}>
          {t('addin.documents.form.save')}
        </Button>
        {busy && <Spinner size="tiny" />}
      </span>
    </div>
  );
}

function ToReview({ doc }: { doc: DocumentItem }) {
  const styles = useStyles();
  return (
    <li>
      <Card className={styles.card} data-testid="to-review">
        <span className={styles.head}>
          <Text weight="semibold">{doc.name}</Text>
          <Caption1 className={styles.muted}>{parisDateTime(doc.receivedAt)}</Caption1>
        </span>
        <Text>{reasonText(doc.reviewReason)}</Text>
        {doc.review?.excerpt && (
          <>
            <Caption1 className={styles.muted}>{t('addin.documents.excerpt')}</Caption1>
            <p className={styles.excerpt}>{doc.review.excerpt}</p>
          </>
        )}
        <ReviewForm doc={doc} />
      </Card>
    </li>
  );
}

function ReviewPart() {
  const styles = useStyles();
  const [state] = useFi();
  const pane = state.documents;
  if (!pane) return null;
  return (
    <div className={styles.section} data-testid="review">
      {pane.review.length === 0 ? (
        <Text>{t('addin.documents.noReview')}</Text>
      ) : (
        <ul className={styles.list}>
          {pane.review.map((d) => (
            <ToReview key={d.id} doc={d} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Received({ doc }: { doc: DocumentItem }) {
  const styles = useStyles();
  return (
    <li>
      <Card className={styles.card} data-testid="received">
        <span className={styles.head}>
          <Text weight="semibold">{doc.name}</Text>
          <Badge appearance="tint" color={STAGE_COLOR[doc.stage]}>
            {t(`addin.documents.stage.${doc.stage}`)}
          </Badge>
        </span>
        <Text>
          {doc.kind ? t(`addin.documents.kind.${doc.kind}`) : t('addin.documents.notYetKnown')}
          {doc.party && ` · ${doc.party.name}`}
        </Text>
        <Caption1 className={styles.muted}>
          {t(`addin.documents.source.${doc.source}`, { date: parisDateTime(doc.receivedAt) })}
        </Caption1>
      </Card>
    </li>
  );
}

function ReceivedPart() {
  const styles = useStyles();
  const [state, fi] = useFi();
  const pane = state.documents;
  if (!pane) return null;
  return (
    <div className={styles.section} data-testid="received-list">
      {pane.received.length === 0 ? (
        <Text>{t(pane.test ? 'addin.documents.noneTest' : 'addin.documents.none')}</Text>
      ) : (
        <ul className={styles.list}>
          {pane.received.map((d) => (
            <Received key={d.id} doc={d} />
          ))}
        </ul>
      )}
      {pane.received.length < pane.receivedTotal && (
        <span className={styles.line}>
          <Button
            size="small"
            disabled={state.busy.includes('moreDocuments')}
            onClick={() => void fi.moreDocuments()}
          >
            {t('addin.documents.more')}
          </Button>
        </span>
      )}
    </div>
  );
}

type Part = 'approve' | 'deadlines' | 'review' | 'received';

export function DocumentsView() {
  const styles = useStyles();
  const [state, fi] = useFi();
  // Until the person picks a part: « À valider » when something waits, else « Échéances ».
  const [picked, setPart] = useState<Part | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const pane = state.documents;
  if (!pane) return <Spinner label={t('addin.documents.loading')} />;
  const depositing = state.busy.includes('deposit');
  const part = picked ?? (pane.actions.length > 0 ? 'approve' : 'deadlines');

  return (
    <div className={styles.section}>
      <span className={styles.head}>
        <Subtitle2 as="h2">
          {t(pane.test ? 'addin.documents.testTitle' : 'addin.documents.title')}
        </Subtitle2>
        <Button
          size="small"
          appearance="subtle"
          disabled={state.busy.includes('documents')}
          onClick={() => void fi.loadDocuments()}
        >
          {t('addin.documents.refresh')}
        </Button>
      </span>
      <Caption1>{t('addin.documents.intro')}</Caption1>
      <input
        ref={input}
        type="file"
        accept={DEPOSIT_ACCEPT}
        hidden
        data-testid="deposit-input"
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          // The same file chosen twice must fire again.
          e.currentTarget.value = '';
          if (file) void fi.depositDocument(file, file.name);
        }}
      />
      <span className={styles.line}>
        <Button onClick={() => input.current?.click()} disabled={depositing}>
          {t('addin.documents.deposit')}
        </Button>
        {depositing && <Spinner size="tiny" />}
      </span>

      <TabList size="small" selectedValue={part} onTabSelect={(_, d) => setPart(d.value as Part)}>
        <Tab value="approve">
          {t('addin.documents.part.approve', { count: pane.actions.length })}
        </Tab>
        <Tab value="deadlines">
          {t('addin.documents.part.deadlines', { count: pane.obligations.length })}
        </Tab>
        <Tab value="review">{t('addin.documents.part.review', { count: pane.reviewTotal })}</Tab>
        <Tab value="received">{t('addin.documents.part.received')}</Tab>
      </TabList>

      {part === 'approve' && <ActionsPart />}
      {part === 'deadlines' && <DeadlinesPart />}
      {part === 'review' && <ReviewPart />}
      {part === 'received' && <ReceivedPart />}
    </div>
  );
}
