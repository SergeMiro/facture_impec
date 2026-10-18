// Invoice model, EN 16931 + French rules, CII/UBL builders, Factur-X embedding, state machine, money math (M1, plan §4, §7); Excel sheets → drafts (M3, plan §5).
export * from './compute';
export * from './dates';
export * from './ids';
export * from './model';
export * from './money';
export { frDate, frDecimal, frMoney, frPrice } from './pdf/format';
export * from './rules';
export * from './sheet';
export * from './state';
export * from './xml';
