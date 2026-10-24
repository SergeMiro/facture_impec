// `pnpm org`: the operator's commands for a company (scripts/org/org.ts; docs/RUNBOOK.md § Pilot).
//   export FI_API_URL=https://api.<domain>; read -rs ADMIN_TOKEN; export ADMIN_TOKEN
//   pnpm org list           pnpm org show 732829320           pnpm org pilot 732829320
import { runOrg } from './org';

process.exitCode = await runOrg(process.argv.slice(2), {
  env: process.env,
  out: (line) => console.log(line),
});
