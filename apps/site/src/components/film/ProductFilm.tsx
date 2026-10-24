// Editable Motion source for the locally rendered product video. No API, auth or real invoice send.
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { demoFilm as copy, filmState } from '../../content/demo-film';
import { Icon } from '../Icon';
import './film.css';

function useFilmTime() {
  const [time, setTime] = useState(0);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const at = query.get('at');
    if (at !== null) {
      setTime(Math.max(0, Number(at) || 0));
      return;
    }
    let frame = 0;
    let start = 0;
    let cancelled = false;
    const tick = (now: number) => {
      start ||= now;
      const next = (now - start) / 1000;
      setTime(Math.min(copy.duration, next));
      if (next < copy.duration && !cancelled) frame = requestAnimationFrame(tick);
    };
    const begin = () => {
      if (cancelled) return;
      document.documentElement.dataset.filmReady = 'true';
      frame = requestAnimationFrame(tick);
    };
    void document.fonts.ready.then(begin);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, []);
  return time;
}

const enter = { opacity: 0, y: 24, scale: 0.98, filter: 'blur(8px)' };
const shown = { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' };
const transition = { duration: 0.55, ease: [0.22, 1, 0.36, 1] as const };

export default function ProductFilm() {
  const time = useFilmTime();
  const state = filmState(time);
  const ui = copy.ui;
  const amount = state.corrected ? '1 200,00 €' : '900,00 €';
  const status = state.paid
    ? ui.paid
    : state.accepted
      ? ui.accepted
      : state.delivered
        ? ui.delivered
        : state.confirmed
          ? ui.deposited
          : state.corrected
            ? ui.conform
            : state.scene >= 1
              ? ui.review
              : '—';
  return (
    <div
      className={`product-film scene-${state.scene}`}
      data-scene={state.scene}
      data-time={time.toFixed(2)}
    >
      <div className="film-orb film-orb-one" />
      <div className="film-orb film-orb-two" />
      <header className="film-masthead">
        <span className="film-wordmark">
          <i /> Facture Impec
        </span>
        <span className="film-sample">{copy.simulated}</span>
      </header>
      <div className="film-heading">
        <span className="film-kicker">
          {String(state.scene + 1).padStart(2, '0')} / 06 <i /> {state.step.short}
        </span>
        <AnimatePresence mode="wait">
          <motion.h1
            key={state.scene}
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.35 }}
          >
            {state.step.title}
          </motion.h1>
        </AnimatePresence>
      </div>
      <motion.div
        className="film-workspace"
        animate={{ y: state.scene === 5 ? 8 : 0 }}
        transition={transition}
      >
        <div className="film-windowbar">
          <span className="film-dots">
            <i />
            <i />
            <i />
          </span>
          <span>
            <Icon name="sheet" size={18} /> {copy.file}
          </span>
          <span className="film-hosts">
            Excel <b> / </b> Google Sheets
          </span>
        </div>
        <div className="film-ribbon">
          <span>{ui.menuFile}</span>
          <strong>{ui.menuHome}</strong>
          <span>{ui.menuInsert}</span>
          <span className="film-ribbon-app">
            Facture Impec <Icon name="sparkles" size={14} />
          </span>
        </div>
        <div className="film-workspace-body">
          <div className="film-spreadsheet">
            <div className="film-formula">
              <span>{state.scene >= 1 && state.scene <= 2 ? 'K3' : 'A1'}</span>
              <i>ƒx</i>
              <span>
                {state.scene >= 1 && state.scene <= 2
                  ? state.corrected
                    ? '1200'
                    : '900'
                  : copy.invoice}
              </span>
            </div>
            <div className="film-sheet-grid">
              <div className="film-columns">
                <span />
                <span>A</span>
                <span>D</span>
                <span>K</span>
                <span>M</span>
              </div>
              <div className="film-table-row film-table-head">
                <span>1</span>
                <span>{ui.number}</span>
                <span>{ui.customer}</span>
                <span>{ui.amount}</span>
                <span>{ui.status}</span>
              </div>
              <div className="film-table-row film-table-muted">
                <span>2</span>
                <span>F2026-101</span>
                <span>Boulangerie Martin</span>
                <span>450,00 €</span>
                <span>
                  <i className="film-tiny-dot" /> {ui.conform}
                </span>
              </div>
              <div className="film-table-row film-focus-row">
                <span>3</span>
                <span>{copy.invoice}</span>
                <span>{copy.client}</span>
                <motion.span
                  className={`film-amount-cell ${state.scene >= 1 && state.scene <= 2 ? 'film-cell-selected' : ''}`}
                  animate={{
                    backgroundColor: state.corrected
                      ? '#dcfce7'
                      : state.scene >= 1
                        ? '#fff3d5'
                        : '#ffffff',
                  }}
                >
                  <AnimatePresence mode="wait">
                    <motion.b
                      key={amount}
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 8 }}
                    >
                      {amount}
                    </motion.b>
                  </AnimatePresence>
                </motion.span>
                <span>
                  <span
                    className={`film-status-chip ${state.paid ? 'film-paid' : state.confirmed ? 'film-sent' : state.corrected ? 'film-ok' : state.scene >= 1 ? 'film-warning' : ''}`}
                  >
                    {status}
                  </span>
                </span>
              </div>
              <div className="film-table-row film-table-muted">
                <span>4</span>
                <span>F2026-103</span>
                <span>Fleurs & Co</span>
                <span>320,00 €</span>
                <span>
                  <i className="film-tiny-dot" /> {ui.conform}
                </span>
              </div>
              <div className="film-empty-rows">
                {[5, 6, 7, 8, 9].map((n) => (
                  <div className="film-table-row" key={n}>
                    <span>{n}</span>
                    <span />
                    <span />
                    <span />
                    <span />
                  </div>
                ))}
              </div>
            </div>
            <div className="film-sheet-tabs">
              <span>＋</span>
              <strong>{ui.sheet}</strong>
              <span>{ui.orders}</span>
              <span>{ui.purchases}</span>
            </div>
            <AnimatePresence>
              {state.scene === 1 && (
                <motion.div
                  className="film-order-slip"
                  initial={{ opacity: 0, x: -30, rotate: -7 }}
                  animate={{ opacity: 1, x: 0, rotate: -3 }}
                  exit={{ opacity: 0, y: 30 }}
                  transition={{ ...transition, delay: 0.3 }}
                >
                  <span>
                    <Icon name="file" size={20} /> {ui.orderLabel} {copy.order}
                  </span>
                  <b>{copy.article}</b>
                  <strong>
                    1 200,00 € <small>HT</small>
                  </strong>
                  <i>{copy.client}</i>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <aside className="film-pane">
            <div className="film-pane-brand">
              <span className="film-brand-mark">
                <Icon name="check" size={23} />
              </span>
              <div>
                <b>Facture Impec</b>
                <small>{ui.assistant}</small>
              </div>
            </div>
            <div className="film-pane-tabs">
              <span className={state.scene >= 1 && state.scene <= 2 ? 'active' : ''}>
                Contrôles
              </span>
              <span className={state.scene >= 3 ? 'active' : ''}>Factures</span>
            </div>
            <AnimatePresence mode="wait">
              <motion.div
                key={state.scene}
                className="film-pane-scene"
                initial={enter}
                animate={shown}
                exit={{ opacity: 0, y: -12 }}
                transition={transition}
              >
                {state.scene === 0 && (
                  <>
                    <div className="film-intro-icon">
                      <Icon name="shield" size={44} />
                    </div>
                    <h2>{ui.introTitle}</h2>
                    <p>{ui.introLines}</p>
                    <div className="film-app-button">
                      <Icon name="shield" size={18} /> {ui.check}
                    </div>
                  </>
                )}
                {state.scene === 1 && (
                  <>
                    <span className="film-pill film-pill-amber">
                      <Icon name="alert" size={14} /> {ui.issue}
                    </span>
                    <div className="film-impact">
                      <span>300 €</span>
                      <small>{ui.missing}</small>
                    </div>
                    <div className="film-compare">
                      <span>
                        {ui.orderLabel} {copy.order}
                        <b>1 200 €</b>
                      </span>
                      <span>
                        {ui.number} {copy.invoice}
                        <b>900 €</b>
                      </span>
                    </div>
                    <p>{ui.issueDescription}</p>
                    <div className="film-cell-link">
                      <Icon name="eye" size={17} /> {ui.seeCell}
                    </div>
                  </>
                )}
                {state.scene === 2 && (
                  <>
                    <span className="film-pill">
                      <Icon name="eye" size={14} /> {ui.confirmation}
                    </span>
                    <h2>{ui.correctionTitle}</h2>
                    <div className="film-before-after">
                      <div>
                        <small>{ui.before}</small>
                        <b
                          style={{
                            color: '#9a9e90',
                            textDecoration: 'line-through',
                            textDecorationColor: '#c8cdbd',
                            textDecorationThickness: '1px',
                          }}
                        >
                          900 €
                        </b>
                      </div>
                      <Icon name="arrowRight" size={24} />
                      <div>
                        <small>{ui.after}</small>
                        <b>1 200 €</b>
                      </div>
                    </div>
                    <motion.div
                      className={`film-app-button ${state.corrected ? 'film-button-done' : ''}`}
                      animate={{ scale: time >= 13.9 && time < 14.2 ? 0.96 : 1 }}
                    >
                      <Icon name="check" size={18} /> {state.corrected ? ui.applied : ui.apply}
                    </motion.div>
                    <small className="film-undo">{ui.undo}</small>
                    {!state.corrected && (
                      <motion.span
                        className="film-cursor"
                        initial={{ opacity: 0, x: 30, y: 20 }}
                        animate={{ opacity: 1, x: 0, y: 0 }}
                        transition={{ delay: 1.2, duration: 0.7 }}
                      >
                        ↖
                      </motion.span>
                    )}
                  </>
                )}
                {state.scene === 3 && (
                  <>
                    <div className="film-document">
                      <Icon name="file" size={45} />
                      <span>{copy.invoice}</span>
                      <b>{ui.format}</b>
                      <small>{ui.structured}</small>
                    </div>
                    <p className="film-document-note">{ui.readable}</p>
                    <motion.div
                      className={`film-app-button ${state.confirmed ? 'film-button-done' : ''}`}
                      animate={{ scale: time >= 19.9 && time < 20.2 ? 0.96 : 1 }}
                    >
                      <Icon name={state.confirmed ? 'check' : 'send'} size={18} />{' '}
                      {state.confirmed ? ui.sending : ui.confirm}
                    </motion.div>
                    <small className="film-no-send">{copy.noSend}</small>
                  </>
                )}
                {state.scene === 4 && (
                  <>
                    <span className="film-pill">
                      <Icon name="history" size={14} /> {ui.trackingLabel}
                    </span>
                    <h2>{ui.trackingTitle}</h2>
                    <div className="film-timeline">
                      {[
                        [ui.deposited, true],
                        [ui.delivered, state.delivered],
                        [ui.accepted, state.accepted],
                      ].map(([label, done], i) => (
                        <motion.div
                          className={done ? 'done' : ''}
                          key={String(label)}
                          animate={{ opacity: done ? 1 : 0.35, x: done ? 0 : 5 }}
                        >
                          <i>{done ? <Icon name="check" size={13} /> : i + 1}</i>
                          <span>{label}</span>
                        </motion.div>
                      ))}
                    </div>
                    <p>{ui.trackingNote}</p>
                  </>
                )}
                {state.scene === 5 && (
                  <>
                    <motion.div
                      className="film-payment-icon"
                      initial={{ scale: 0.5, rotate: -25 }}
                      animate={{ scale: 1, rotate: 0 }}
                      transition={{ type: 'spring', stiffness: 150, damping: 12 }}
                    >
                      <Icon name="check" size={42} />
                    </motion.div>
                    <span className="film-payment-label">{ui.payment}</span>
                    <div className="film-payment-amount">
                      1 440 €<small>{ui.gross}</small>
                    </div>
                    <span className="film-pill">
                      <Icon name="check" size={14} /> {state.paid ? ui.paid : ui.accepted}
                    </span>
                    <p>{ui.history}</p>
                  </>
                )}
              </motion.div>
            </AnimatePresence>
          </aside>
        </div>
      </motion.div>
      <footer className="film-footer">
        <span>{state.scene === 5 ? ui.promise : ui.footer}</span>
        <div>
          {copy.steps.map((step, i) => (
            <span key={step.id} className={i <= state.scene ? 'filled' : ''} />
          ))}
        </div>
      </footer>
    </div>
  );
}
