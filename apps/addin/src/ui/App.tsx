// The task pane: banners on every screen (Mode test, offline, the last notice), then one screen.
// No router: office.js breaks the history API (docs/OFFICE.md §8), and the pane has six screens.
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
import { ControllerContext, useFi } from './context';
import { Dashboard } from './Dashboard';
import { Detection } from './Detection';
import { InvoiceView } from './InvoiceView';
import { Login } from './Login';
import { ReceptionView } from './ReceptionView';
import { SettingsView } from './SettingsView';
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
  header: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px' },
  center: { display: 'flex', justifyContent: 'center', padding: '48px 0' },
});

export function App({ controller }: { controller: Controller }) {
  return (
    <ControllerContext.Provider value={controller}>
      <FluentProvider theme={theme}>
        <Pane />
      </FluentProvider>
    </ControllerContext.Provider>
  );
}

function Pane() {
  const styles = useStyles();
  const [state, fi] = useFi();
  const signedIn = state.me !== null;
  const tab = state.screen.name === 'invoice' ? 'dashboard' : state.screen.name;

  if (state.outsideExcel) {
    return (
      <main className={styles.root}>
        <Title3 as="h1">{t('addin.outside.title')}</Title3>
        <Text>{t('addin.outside.text')}</Text>
      </main>
    );
  }

  return (
    <main className={styles.root}>
      <div className={styles.header}>
        <Title3 as="h1">{t('app.title')}</Title3>
        {state.me && <Text size={200}>{state.me.tenant.name}</Text>}
      </div>

      {state.testMode && (
        <div className={styles.testBanner} role="status" data-testid="test-banner">
          {t('banner.testMode')}
        </div>
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
          selectedValue={tab}
          onTabSelect={(_, data) => {
            const name = data.value;
            if (
              name === 'dashboard' ||
              name === 'detect' ||
              name === 'reception' ||
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
  if (!state.me)
    return state.screen.name === 'login' ? <Login /> : <Spinner label={t('addin.loading')} />;
  switch (state.screen.name) {
    case 'login':
      return <Login />;
    case 'detect':
      return <Detection />;
    case 'dashboard':
      return <Dashboard />;
    case 'invoice':
      return <InvoiceView />;
    case 'reception':
      return <ReceptionView />;
    case 'settings':
      return <SettingsView />;
  }
}
