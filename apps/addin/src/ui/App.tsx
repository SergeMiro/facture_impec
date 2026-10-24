// The task pane: banners on every screen (Mode test, offline, the last notice), then one screen.
// No router: office.js breaks the history API (docs/OFFICE.md §8), and the pane has ten screens.
import { t } from '@fi/shared';
import {
  Button,
  FluentProvider,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  makeStyles,
  Spinner,
  Tab,
  TabList,
  Text,
  Title3,
  tokens,
} from '@fluentui/react-components';
import type { Controller } from '../controller';
import { ChatView } from './ChatView';
import { ChecksView } from './ChecksView';
import { CustomersView } from './CustomersView';
import { ControllerContext, useFi } from './context';
import { Dashboard } from './Dashboard';
import { Detection } from './Detection';
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
    backgroundColor: tokens.colorNeutralBackground1,
  },
  testBanner: {
    backgroundColor: TEST_ORANGE,
    color: '#1f1300',
    padding: '8px 12px',
    borderRadius: tokens.borderRadiusMedium,
    fontWeight: tokens.fontWeightSemibold,
  },
  header: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: '8px',
    paddingBottom: '6px',
    borderBottom: '3px solid transparent',
  },
  brand: { display: 'flex', flexDirection: 'column' },
  center: { display: 'flex', justifyContent: 'center', padding: '48px 0' },
  // Seven tabs are wider than a task pane: they wrap instead of scrolling the pane sideways.
  tabs: { flexWrap: 'wrap' },
});

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
        style={brand?.accentColor ? { borderBottomColor: brand.accentColor } : undefined}
      >
        <span className={styles.brand}>
          <Title3 as="h1">{brand?.full ? brand.firmName : t('app.title')}</Title3>
          {brand && !brand.full && (
            <Text size={200}>{t('addin.brand.by', { firm: brand.firmName })}</Text>
          )}
        </span>
        {state.me && <Text size={200}>{state.me.tenant.name}</Text>}
      </div>

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
        <MessageBar intent="warning" data-testid="offline-banner">
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

      {signedIn && (
        <TabList
          className={styles.tabs}
          selectedValue={tab}
          onTabSelect={(_, data) => {
            const name = data.value;
            if (
              name === 'dashboard' ||
              name === 'detect' ||
              name === 'reception' ||
              name === 'customers' ||
              name === 'registry' ||
              name === 'checks' ||
              name === 'settings'
            ) {
              fi.navigate({ name });
              if (name === 'detect' && !state.detection) void fi.editMapping();
            }
          }}
        >
          <Tab value="dashboard">{t('addin.nav.dashboard')}</Tab>
          <Tab value="detect">{t('addin.nav.columns')}</Tab>
          <Tab value="reception">{t('addin.nav.reception')}</Tab>
          <Tab value="customers">{t('addin.nav.customers')}</Tab>
          <Tab value="registry">{t('addin.nav.registry')}</Tab>
          <Tab value="checks">{t('addin.nav.checks')}</Tab>
          <Tab value="settings">{t('addin.nav.settings')}</Tab>
        </TabList>
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
