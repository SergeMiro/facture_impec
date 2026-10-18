<?php
// Imports a FEC into a fresh Paheko the way its screen « Importer des écritures » does
// (www/admin/acc/years/import.php of the pinned image): format FEC, columns matched from the header
// as the screen pre-fills them, « Créer toutes les écritures », « Créer les comptes qui n'existent pas
// dans le plan comptable ». Prints one JSON line: what was created and what the books now hold.
// Run by scripts/accounting/check.ts inside the container, after `bin/paheko init`.
namespace Paheko;

use Paheko\Accounting\Charts;
use Paheko\Accounting\Export;
use Paheko\Accounting\Import;
use Paheko\Entities\Accounting\Year;

define('Paheko\SKIP_STARTUP_CHECK', true);
$_SERVER['HTTP_HOST'] = 'localhost';
$_SERVER['DOCUMENT_ROOT'] = '/var/www/paheko/www';
require_once '/var/www/paheko/include/init.php';

[, $file, $start, $end] = $argv;
$db = DB::getInstance();

// A new organisation has no financial year yet: one on the chart of accounts for companies, as a
// TPE/PME would pick on the screen « Nouvel exercice ».
$year = new Year;
$year->importForm([
	'label' => 'Exercice de contrôle',
	'start_date' => $start,
	'end_date' => $end,
	'id_chart' => Charts::getOrInstall('fr_pcg_2025'),
]);
$year->save();

$type = Export::FEC;
$columns = array_flip(array_filter(Export::COLUMNS[$type]));
unset($columns['letter']);
$columns_table = array_intersect_key(array_flip(Export::COLUMNS_FULL + ['Code du journal' => 'journal']), $columns);

$csv = new CSV_Custom(null, 'fi_check');
$csv->clear();
$csv->setColumns($columns_table, $columns);
$csv->setMandatoryColumns(Export::MANDATORY_COLUMNS[$type]);
$csv->loadFile($file, basename($file));
$csv->skip(1);
// What templates/common/_csv_match_columns.tpl pre-selects: a header guess the screen offers no option
// for (DateLet → letter_date) shows « Ne pas importer cette colonne ».
$offered = array_column($csv->getColumnsWithDefaults(), 'key');
$csv->setTranslationTable(array_map(fn ($c) => in_array($c, $offered, true) ? $c : null, $csv->getSelectedTable([])));

// As on the screen: a dry run shows what would be created, then « Importer » writes it.
$options = ['ignore_ids' => true, 'auto_create_accounts' => true];
try {
	$preview = Import::import($type, $year, $csv, 1, $options + ['dry_run' => true, 'return_report' => true]);
	Import::import($type, $year, $csv, 1, $options);
}
catch (UserException $e) {
	echo json_encode(['error' => $e->getMessage(), 'details' => $e->getDetails()], JSON_UNESCAPED_UNICODE), PHP_EOL;
	exit(1);
}

$id = $year->id();
echo json_encode([
	'mapped' => array_values(array_filter($csv->getTranslationTable())),
	'preview' => [
		'created' => $preview['created_count'],
		'modified' => $preview['modified_count'],
		'accounts' => array_values(array_map(fn ($a) => $a->code, $preview['accounts'])),
	],
	'transactions' => (int) $db->firstColumn('SELECT COUNT(*) FROM acc_transactions WHERE id_year = ?;', $id),
	'lines' => (int) $db->firstColumn('SELECT COUNT(*) FROM acc_transactions_lines l JOIN acc_transactions t ON t.id = l.id_transaction WHERE t.id_year = ?;', $id),
	'debit' => (int) $db->firstColumn('SELECT SUM(l.debit) FROM acc_transactions_lines l JOIN acc_transactions t ON t.id = l.id_transaction WHERE t.id_year = ?;', $id),
	'credit' => (int) $db->firstColumn('SELECT SUM(l.credit) FROM acc_transactions_lines l JOIN acc_transactions t ON t.id = l.id_transaction WHERE t.id_year = ?;', $id),
	'unbalanced' => (int) $db->firstColumn('SELECT COUNT(*) FROM (SELECT t.id FROM acc_transactions t JOIN acc_transactions_lines l ON l.id_transaction = t.id WHERE t.id_year = ? GROUP BY t.id HAVING SUM(l.debit) != SUM(l.credit));', $id),
	'byAccount' => $db->getAssoc('SELECT a.code, SUM(l.debit) - SUM(l.credit) FROM acc_transactions_lines l JOIN acc_transactions t ON t.id = l.id_transaction JOIN acc_accounts a ON a.id = l.id_account WHERE t.id_year = ? GROUP BY a.code ORDER BY a.code;', $id),
], JSON_UNESCAPED_UNICODE), PHP_EOL;
