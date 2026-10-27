// The task pane: banners on every screen (Mode test, offline, the last notice), then one screen.
// No router: office.js breaks the history API (docs/OFFICE.md §8), and the pane has eleven screens.
import { type MessageKey, brand as palette, t } from '@fi/shared';
import {
  Button,
  Caption1,
  FluentProvider,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  makeStyles,
  Spinner,
  Subtitle1,
  Tab,
  TabList,
  Text,
  Title3,
  Tooltip,
  tokens,
} from '@fluentui/react-components';
import {
  Book20Filled,
  Book20Regular,
  bundleIcon,
  DocumentFolder20Filled,
  DocumentFolder20Regular,
  MailInbox20Filled,
  MailInbox20Regular,
  People20Filled,
  People20Regular,
  Receipt20Filled,
  Receipt20Regular,
  Settings20Filled,
  Settings20Regular,
  ShieldCheckmark20Filled,
  ShieldCheckmark20Regular,
  TableSettings20Filled,
  TableSettings20Regular,
} from '@fluentui/react-icons';
import type { Controller } from '../controller';
import { ChatView } from './ChatView';
import { ChecksView } from './ChecksView';
import { CustomersView } from './CustomersView';
import { ControllerContext, useFi } from './context';
import { Dashboard } from './Dashboard';
import { Detection } from './Detection';
import { DocumentsView } from './DocumentsView';
import { InvoiceView } from './InvoiceView';
import { Login } from './Login';
import { ReceptionView } from './ReceptionView';
import { RegistryView } from './RegistryView';
import { SettingsView } from './SettingsView';
import { Signup } from './Signup';
import { TEST_ORANGE, theme } from './theme';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    padding: '12px 14px 24px',
    minHeight: '100vh',
    boxSizing: 'border-box',
    backgroundColor: tokens.colorNeutralBackground2,
    overflowX: 'hidden',
    // A long option or value never pushes a control past the pane's edge.
    '& .fui-Select, & .fui-Input, & .fui-Field': { minWidth: 0, maxWidth: '100%' },
    '& h2, & h3': { margin: 0 },
    // A screen's own tabs (Documents: À valider, Échéances…) wrap instead of running off the pane.
    '& .fui-TabList': { flexWrap: 'wrap' },
    // Fluent's Card matches the pane's own cards (layout.ts group).
    '& .fui-Card': {
      borderRadius: tokens.borderRadiusXLarge,
      border: `1px solid ${tokens.colorNeutralStroke3}`,
      boxShadow: tokens.shadow2,
    },
  },
  testBanner: {
    backgroundColor: TEST_ORANGE,
    color: '#1f1300',
    padding: '6px 10px',
    borderRadius: tokens.borderRadiusMedium,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
  },
  // The brand band runs edge to edge over the root's padding.
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    margin: '-12px -14px 0',
    padding: '12px 14px',
    color: '#fff',
    background: `linear-gradient(135deg, ${palette.leaf[800]}, ${palette.leaf[600]})`,
  },
  logo: {
    width: '22px',
    height: '22px',
    flexShrink: 0,
    padding: '4px',
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: '#fff',
  },
  brand: { display: 'flex', flexDirection: 'column', minWidth: 0, flexGrow: 1 },
  title: { color: '#fff', lineHeight: '20px' },
  tenant: {
    color: 'rgba(255, 255, 255, 0.8)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  center: { display: 'flex', justifyContent: 'center', padding: '48px 0' },
  tabs: { display: 'flex', flexWrap: 'wrap', gap: '6px' },
  // One row of icons that stays on top while the screen scrolls; names in tooltips and the screen's title.
  nav: {
    position: 'sticky',
    top: 0,
    zIndex: 1,
    display: 'flex',
    justifyContent: 'space-between',
    gap: '2px',
    margin: '-12px -14px 0',
    padding: '6px 8px',
    backgroundColor: tokens.colorNeutralBackground1,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    boxShadow: tokens.shadow2,
  },
  navTab: {
    minWidth: '32px',
    height: '32px',
    padding: 0,
    justifyContent: 'center',
    borderRadius: tokens.borderRadiusCircular,
    color: tokens.colorNeutralForeground3,
    '& .fui-Tab__content': { padding: 0, whiteSpace: 'nowrap' },
    '& .fui-Tab__content--reserved-space': { display: 'none' },
    // Fluent's underline indicator: the pill replaces it.
    '::after': { display: 'none' },
    '::before': { display: 'none' },
    ':hover': { backgroundColor: tokens.colorNeutralBackground3 },
    '&[aria-selected="true"], &[aria-selected="true"]:hover': {
      backgroundColor: palette.leaf[600],
    },
    '&[aria-selected="true"] .fui-Tab__icon, &[aria-selected="true"]:hover .fui-Tab__icon': {
      color: '#fff',
    },
  },
  hidden: {
    position: 'absolute',
    width: '1px',
    height: '1px',
    overflow: 'hidden',
    clip: 'rect(0 0 0 0)',
    whiteSpace: 'nowrap',
  },
});

type Nav =
  | 'dashboard'
  | 'reception'
  | 'documents'
  | 'customers'
  | 'checks'
  | 'registry'
  | 'detect'
  | 'settings';

/** Daily work first (invoices out, invoices in, documents, customers), then the set-up. */
const NAV: { value: Nav; label: MessageKey; icon: ReturnType<typeof bundleIcon> }[] = [
  {
    value: 'dashboard',
    label: 'addin.nav.dashboard',
    icon: bundleIcon(Receipt20Filled, Receipt20Regular),
  },
  {
    value: 'reception',
    label: 'addin.nav.reception',
    icon: bundleIcon(MailInbox20Filled, MailInbox20Regular),
  },
  {
    value: 'documents',
    label: 'addin.nav.documents',
    icon: bundleIcon(DocumentFolder20Filled, DocumentFolder20Regular),
  },
  {
    value: 'customers',
    label: 'addin.nav.customers',
    icon: bundleIcon(People20Filled, People20Regular),
  },
  {
    value: 'checks',
    label: 'addin.nav.checks',
    icon: bundleIcon(ShieldCheckmark20Filled, ShieldCheckmark20Regular),
  },
  { value: 'registry', label: 'addin.nav.registry', icon: bundleIcon(Book20Filled, Book20Regular) },
  {
    value: 'detect',
    label: 'addin.nav.columns',
    icon: bundleIcon(TableSettings20Filled, TableSettings20Regular),
  },
  {
    value: 'settings',
    label: 'addin.nav.settings',
    icon: bundleIcon(Settings20Filled, Settings20Regular),
  },
];

const isNav = (name: unknown): name is Nav => NAV.some((n) => n.value === name);

export function App({
  controller,
  host = 'excel',
}: {
  controller: Controller;
  host?: 'excel' | 'sheets';
}) {
  return (
    <ControllerContext.Provider value={controller}>
      <FluentProvider theme={theme}>
        <Pane host={host} />
      </FluentProvider>
    </ControllerContext.Provider>
  );
}

function Pane({ host }: { host: 'excel' | 'sheets' }) {
  const styles = useStyles();
  const [state, fi] = useFi();
  const signedIn = state.me !== null;
  const tab =
    state.screen.name === 'invoice'
      ? 'dashboard'
      : state.screen.name === 'chat'
        ? 'checks'
        : state.screen.name;

  if (state.outsideExcel) {
    return (
      <main className={styles.root}>
        <Title3 as="h1">
          {t(host === 'sheets' ? 'sheets.outside.title' : 'addin.outside.title')}
        </Title3>
        <Text>{t(host === 'sheets' ? 'sheets.outside.text' : 'addin.outside.text')}</Text>
      </main>
    );
  }

  // An accounting firm's brand (white label): its name, its colour; « full » drops ours.
  const brand = state.me?.tenant.whiteLabel ?? null;
  return (
    <main className={styles.root}>
      <div
        className={styles.header}
        style={brand?.accentColor ? { background: brand.accentColor } : undefined}
      >
        {!brand?.full && <img className={styles.logo} src="assets/icon-32.png" alt="" />}
        <span className={styles.brand}>
          <Subtitle1 as="h1" className={styles.title}>
            {brand?.full ? brand.firmName : t('app.title')}
          </Subtitle1>
          {brand && !brand.full && (
            <Caption1 className={styles.tenant}>
              {t('addin.brand.by', { firm: brand.firmName })}
            </Caption1>
          )}
          {state.me && (
            <Caption1 className={styles.tenant} title={state.me.tenant.name}>
              {state.me.tenant.name}
            </Caption1>
          )}
        </span>
      </div>

      {signedIn && (
        <TabList
          className={styles.nav}
          size="small"
          selectedValue={tab}
          aria-label={t('addin.nav.label')}
          onTabSelect={(_, data) => {
            const name = data.value;
            if (!isNav(name)) return;
            fi.navigate({ name });
            if (name === 'detect' && !state.detection) void fi.editMapping();
          }}
        >
          {NAV.map(({ value, label, icon: Icon }) => (
            <Tooltip key={value} content={t(label)} relationship="inaccessible" withArrow>
              <Tab value={value} icon={<Icon />} className={styles.navTab}>
                <span className={styles.hidden}>{t(label)}</span>
              </Tab>
            </Tooltip>
          ))}
        </TabList>
      )}

      {host === 'sheets' && signedIn && (
        <div role="toolbar" aria-label={t('sheets.toolbar')} className={styles.tabs}>
          <Button size="small" onClick={() => void fi.verifyFromRibbon()}>
            {t('sheets.verify')}
          </Button>
          <Button size="small" onClick={() => void fi.sendFromRibbon()}>
            {t('sheets.send')}
          </Button>
          <Button
            size="small"
            aria-pressed={state.testMode}
            onClick={() => void fi.toggleTestModeFromRibbon()}
          >
            {t('sheets.test')}
          </Button>
        </div>
      )}

      {state.testMode && (
        <div className={styles.testBanner} role="status" data-testid="test-banner">
          {t('banner.testMode')}
        </div>
      )}

      {state.me?.awaitingGoLive && (
        <MessageBar intent="info" layout="multiline" data-testid="go-live-banner">
          <MessageBarBody>{t('addin.goLive.waiting')}</MessageBarBody>
        </MessageBar>
      )}

      {state.offline && (
        <MessageBar layout="multiline" intent="warning" data-testid="offline-banner">
          <MessageBarBody>
            {state.offline.length > 0
              ? t('addin.offline.banner', { count: state.offline.length })
              : t('addin.offline.bannerIdle')}
          </MessageBarBody>
          <MessageBarActions>
            <Button size="small" onClick={fi.online}>
              {t('addin.offline.retry')}
            </Button>
          </MessageBarActions>
        </MessageBar>
      )}

      {state.notice && (
        <MessageBar intent={state.notice.tone} layout="multiline" data-testid="notice">
          <MessageBarBody>{state.notice.text}</MessageBarBody>
          <MessageBarActions>
            <Button size="small" appearance="transparent" onClick={fi.dismiss}>
              {t('addin.notice.close')}
            </Button>
          </MessageBarActions>
        </MessageBar>
      )}

      {!state.booted ? (
        <div className={styles.center}>
          <Spinner label={t('addin.loading')} />
        </div>
      ) : (
        <Screen />
      )}
    </main>
  );
}

function Screen() {
  const [state] = useFi();
  if (!state.me) {
    if (state.screen.name === 'signup') return <Signup />;
    return state.screen.name === 'login' ? <Login /> : <Spinner label={t('addin.loading')} />;
  }
  switch (state.screen.name) {
    case 'login':
      return <Login />;
    case 'signup':
      return <Signup />;
    case 'detect':
      return <Detection />;
    case 'dashboard':
      return <Dashboard />;
    case 'invoice':
      return <InvoiceView />;
    case 'reception':
      return <ReceptionView />;
    case 'documents':
      return <DocumentsView />;
    case 'customers':
      return <CustomersView />;
    case 'registry':
      return <RegistryView />;
    case 'checks':
      return <ChecksView />;
    case 'chat':
      return <ChatView />;
    case 'settings':
      return <SettingsView />;
  }
}
