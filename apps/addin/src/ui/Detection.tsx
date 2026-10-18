// Screen 2, Détection (plan §5): the agent's proposal, which the user checks and confirms.
import { CORE_FIELDS, INVOICE_FIELDS, type InvoiceField, type SheetMapping } from '@fi/core';
import { isMessageKey, type MessageKey, t } from '@fi/shared';
import {
  Badge,
  Button,
  Field,
  MessageBar,
  MessageBarBody,
  makeStyles,
  Select,
  SpinButton,
  Spinner,
  Subtitle2,
  Text,
  tokens,
} from '@fluentui/react-components';
import { useEffect, useState } from 'react';
import type { Degraded } from '../api';
import type { Header } from '../controller';
import { useFi } from './context';

const useStyles = makeStyles({
  section: { display: 'flex', flexDirection: 'column', gap: '10px' },
  field: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', alignItems: 'center' },
  label: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' },
  actions: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
  warnings: { margin: 0, paddingLeft: '18px', color: tokens.colorNeutralForeground2 },
});

const DEGRADED: Record<Degraded, MessageKey> = {
  ai_off: 'mapping.degraded.ai_off',
  error: 'mapping.degraded.error',
  daily_budget: 'mapping.degraded.daily_budget',
  run_budget: 'mapping.degraded.run_budget',
};

const fieldLabel = (field: InvoiceField) => {
  const key = `sheet.field.${field}`;
  return isMessageKey(key) ? t(key) : field;
};

const columnLabel = (h: Header) =>
  h.text ? t('addin.detect.column', { col: h.col, header: h.text }) : h.col;

export function Detection() {
  const styles = useStyles();
  const [state, fi] = useFi();
  const proposal = state.detection;
  const [draft, setDraft] = useState<SheetMapping | null>(proposal?.mapping ?? null);
  const [headers, setHeaders] = useState<Header[]>(proposal?.headers ?? []);
  const [edited, setEdited] = useState(false);
  const [all, setAll] = useState(false);

  useEffect(() => {
    setDraft(proposal?.mapping ?? null);
    setHeaders(proposal?.headers ?? []);
    setEdited(false);
  }, [proposal]);

  const busy = state.busy.includes('detect');
  const sheet = state.sheet ?? '';

  if (!draft) {
    return (
      <section className={styles.section}>
        <Subtitle2 as="h2">{t('addin.detect.title', { sheet })}</Subtitle2>
        <Text>{t('addin.detect.intro')}</Text>
        {busy ? (
          <Spinner label={t('addin.detect.running')} />
        ) : (
          <Button appearance="primary" onClick={() => void fi.detect()}>
            {t('addin.detect.run')}
          </Button>
        )}
      </section>
    );
  }

  const update = (patch: Partial<SheetMapping>) => {
    setDraft({ ...draft, ...patch, source: 'user' });
    setEdited(true);
  };
  const setColumn = (field: InvoiceField, col: string) => {
    const mapping = { ...draft.mapping };
    if (col) mapping[field] = { column: col, confidence: 1, needsConfirmation: false };
    else delete mapping[field];
    update({ mapping });
  };
  const toConfirm = Object.values(draft.mapping).filter((m) => m?.needsConfirmation).length;
  const fields = INVOICE_FIELDS.filter(
    (f) => all || (CORE_FIELDS as readonly InvoiceField[]).includes(f) || draft.mapping[f],
  );

  const confirm = () => {
    // Confirming is the user's decision on every column, including the doubtful ones.
    const mapping = Object.fromEntries(
      Object.entries(draft.mapping).map(([f, m]) => [f, m && { ...m, needsConfirmation: false }]),
    );
    void fi.confirmMapping({ ...draft, mapping, ...(edited && { source: 'user' }) });
  };

  return (
    <section className={styles.section} aria-labelledby="detect-title">
      <Subtitle2 as="h2" id="detect-title">
        {t('addin.detect.title', { sheet })}
      </Subtitle2>
      <Text>{t('addin.detect.intro')}</Text>

      {proposal?.degraded && (
        <MessageBar intent="warning">
          <MessageBarBody>{t(DEGRADED[proposal.degraded])}</MessageBarBody>
        </MessageBar>
      )}
      {draft.warnings.length > 0 && (
        <ul className={styles.warnings}>
          {draft.warnings.map((w) => (
            <li key={w}>
              <Text size={200}>{w}</Text>
            </li>
          ))}
        </ul>
      )}

      <Field label={t('addin.detect.headerRow')}>
        <SpinButton
          min={1}
          value={draft.headerRow}
          onChange={(_, d) => {
            const row = d.value ?? Number(d.displayValue);
            if (Number.isInteger(row) && row > 0) {
              update({ headerRow: row });
              setHeaders(fi.headersFor(row));
            }
          }}
        />
      </Field>

      <Field label={t('addin.detect.grouping')}>
        <Select
          value={draft.grouping?.by ?? ''}
          onChange={(_, d) => update({ grouping: d.value ? { by: d.value } : null })}
        >
          <option value="">{t('addin.detect.groupingNone')}</option>
          {headers.map((h) => (
            <option key={h.col} value={h.col}>
              {t('addin.detect.groupingBy', { col: columnLabel(h) })}
            </option>
          ))}
        </Select>
      </Field>

      {fields.map((field) => {
        const current = draft.mapping[field];
        return (
          <div key={field} className={styles.field} data-testid={`field-${field}`}>
            <span className={styles.label}>
              <Text>{fieldLabel(field)}</Text>
              {current?.needsConfirmation && (
                <Badge appearance="tint" color="warning">
                  {t('addin.detect.toConfirm')}
                </Badge>
              )}
            </span>
            <Select
              aria-label={fieldLabel(field)}
              value={current?.column ?? ''}
              onChange={(_, d) => setColumn(field, d.value)}
            >
              <option value="">{t('addin.detect.none')}</option>
              {headers.map((h) => (
                <option key={h.col} value={h.col}>
                  {columnLabel(h)}
                </option>
              ))}
            </Select>
          </div>
        );
      })}

      <Button appearance="transparent" onClick={() => setAll(!all)}>
        {all ? t('addin.detect.showCore') : t('addin.detect.showAll')}
      </Button>

      {toConfirm > 0 && (
        <MessageBar intent="info">
          <MessageBarBody>{t('addin.detect.needsConfirm', { count: toConfirm })}</MessageBarBody>
        </MessageBar>
      )}

      <div className={styles.actions}>
        <Button appearance="primary" onClick={confirm} disabled={state.busy.includes('confirm')}>
          {t('addin.detect.confirm')}
        </Button>
        <Button onClick={() => void fi.detect()} disabled={busy}>
          {t('addin.detect.rerun')}
        </Button>
        {state.mapping && (
          <Button appearance="subtle" onClick={() => fi.navigate({ name: 'dashboard' })}>
            {t('addin.detect.cancel')}
          </Button>
        )}
      </div>
    </section>
  );
}
