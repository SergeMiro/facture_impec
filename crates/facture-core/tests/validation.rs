//! Tests d'intégration du moteur de validation (`facture-core`).
//!
//! Stratégie : une facture de référence **valide**, puis une mutation par règle qui doit
//! déclencher exactement le code attendu et basculer `is_sendable` à `false`.

use facture_core::model::{
    Address, Invoice, Line, Party, Payment, Totals, VatBreakdown, VatCategory,
};
use facture_core::{validate, validate_json};
use rust_decimal_macros::dec;

/// Facture de référence, valide de bout en bout (entité SIREN 732829320).
fn valid_invoice() -> Invoice {
    Invoice {
        invoice_number: Some("F-2026-001".into()),
        issue_date: Some("2026-09-01".into()),
        due_date: Some("2026-10-01".into()),
        type_code: Some("380".into()),
        currency: Some("EUR".into()),
        seller: Party {
            name: Some("Vendeur SARL".into()),
            siren: Some("732829320".into()),
            siret: Some("73282932000074".into()),
            vat_id: Some("FR44732829320".into()),
            address: Address {
                line1: Some("1 rue de Paris".into()),
                postal_code: Some("75001".into()),
                city: Some("Paris".into()),
                country_code: Some("FR".into()),
            },
        },
        buyer: Party {
            name: Some("Acheteur SAS".into()),
            address: Address {
                line1: Some("2 avenue de Lyon".into()),
                postal_code: Some("69001".into()),
                city: Some("Lyon".into()),
                country_code: Some("FR".into()),
            },
            ..Default::default()
        },
        lines: vec![
            Line {
                description: Some("Prestation A".into()),
                quantity: Some(dec!(10)),
                unit: Some("h".into()),
                unit_price: Some(dec!(100.00)),
                line_amount: Some(dec!(1000.00)),
                vat_rate: Some(dec!(20)),
                vat_category: Some(VatCategory::Standard),
                ..Default::default()
            },
            Line {
                description: Some("Prestation B".into()),
                quantity: Some(dec!(2)),
                unit: Some("u".into()),
                unit_price: Some(dec!(50.00)),
                line_amount: Some(dec!(100.00)),
                vat_rate: Some(dec!(20)),
                vat_category: Some(VatCategory::Standard),
                ..Default::default()
            },
        ],
        vat_breakdown: vec![VatBreakdown {
            category: Some(VatCategory::Standard),
            rate: Some(dec!(20)),
            taxable_amount: Some(dec!(1100.00)),
            tax_amount: Some(dec!(220.00)),
            ..Default::default()
        }],
        totals: Totals {
            line_extension_amount: Some(dec!(1100.00)),
            tax_exclusive_amount: Some(dec!(1100.00)),
            tax_amount: Some(dec!(220.00)),
            tax_inclusive_amount: Some(dec!(1320.00)),
            payable_amount: Some(dec!(1320.00)),
            ..Default::default()
        },
        payment: Some(Payment {
            iban: Some("FR1420041010050500013M02606".into()),
            bic: Some("BNPAFRPP".into()),
            terms: Some("30 jours".into()),
        }),
        cells: Default::default(),
    }
}

fn codes(inv: &Invoice) -> Vec<String> {
    validate(inv).issues.into_iter().map(|i| i.code).collect()
}

fn has(inv: &Invoice, code: &str) -> bool {
    codes(inv).iter().any(|c| c == code)
}

#[test]
fn reference_invoice_is_valid() {
    let report = validate(&valid_invoice());
    assert!(
        report.issues.is_empty(),
        "la facture de référence devrait être valide, problèmes: {:?}",
        report.issues
    );
    assert!(report.is_sendable);
}

#[test]
fn missing_mandatory_fields_block() {
    let mut inv = valid_invoice();
    inv.invoice_number = None;
    assert!(has(&inv, "BR-02"));
    assert!(!validate(&inv).is_sendable);

    let mut inv = valid_invoice();
    inv.issue_date = None;
    assert!(has(&inv, "BR-03"));

    let mut inv = valid_invoice();
    inv.currency = None;
    assert!(has(&inv, "BR-05"));

    let mut inv = valid_invoice();
    inv.seller.name = None;
    assert!(has(&inv, "BR-06"));

    let mut inv = valid_invoice();
    inv.seller.address.country_code = None;
    assert!(has(&inv, "BR-09"));

    let mut inv = valid_invoice();
    inv.buyer.name = None;
    assert!(has(&inv, "BR-07"));

    let mut inv = valid_invoice();
    inv.totals.payable_amount = None;
    assert!(has(&inv, "BR-15"));

    let mut inv = valid_invoice();
    inv.lines.clear();
    assert!(has(&inv, "BR-16"));
}

#[test]
fn french_identifiers() {
    // SIREN cassé
    let mut inv = valid_invoice();
    inv.seller.siren = Some("732829321".into());
    assert!(has(&inv, "FR-SIREN-LUHN"));

    // SIRET cassé
    let mut inv = valid_invoice();
    inv.seller.siret = Some("73282932000075".into());
    assert!(has(&inv, "FR-SIRET-LUHN"));

    // Clé TVA FR erronée
    let mut inv = valid_invoice();
    inv.seller.vat_id = Some("FR41303265045".into());
    assert!(has(&inv, "FR-TVA-KEY"));

    // Aucun identifiant légal vendeur
    let mut inv = valid_invoice();
    inv.seller.siren = None;
    inv.seller.siret = None;
    assert!(has(&inv, "FR-MENTIONS-ID"));

    // VAT étranger valide : pas de faux positif
    let mut inv = valid_invoice();
    inv.buyer.vat_id = Some("DE123456789".into());
    assert!(!has(&inv, "FR-TVA-KEY"));
}

#[test]
fn formats() {
    let mut inv = valid_invoice();
    inv.payment.as_mut().unwrap().iban = Some("FR1420041010050500013M02607".into());
    assert!(has(&inv, "FR-IBAN"));

    let mut inv = valid_invoice();
    inv.issue_date = Some("2026-13-40".into());
    assert!(has(&inv, "FF-DATE-FORMAT"));

    let mut inv = valid_invoice();
    inv.currency = Some("EU".into());
    assert!(has(&inv, "FF-CURRENCY-FORMAT"));
}

#[test]
fn line_and_total_calculations() {
    // Montant de ligne incohérent
    let mut inv = valid_invoice();
    inv.lines[0].line_amount = Some(dec!(999.00));
    assert!(has(&inv, "FF-LINE-CALC"));

    // BR-CO-10 : somme des lignes ≠ BT-106
    let mut inv = valid_invoice();
    inv.totals.line_extension_amount = Some(dec!(1200.00));
    assert!(has(&inv, "BR-CO-10"));

    // BR-CO-13 : BT-109 ≠ BT-106
    let mut inv = valid_invoice();
    inv.totals.tax_exclusive_amount = Some(dec!(1000.00));
    assert!(has(&inv, "BR-CO-13"));

    // BR-CO-14 : BT-110 ≠ Σ TVA par catégorie
    let mut inv = valid_invoice();
    inv.totals.tax_amount = Some(dec!(200.00));
    assert!(has(&inv, "BR-CO-14"));

    // BR-CO-15 : TTC ≠ HT + TVA
    let mut inv = valid_invoice();
    inv.totals.tax_inclusive_amount = Some(dec!(1300.00));
    assert!(has(&inv, "BR-CO-15"));

    // BR-CO-16 : net à payer ≠ TTC − payé + arrondi
    let mut inv = valid_invoice();
    inv.totals.payable_amount = Some(dec!(1300.00));
    assert!(has(&inv, "BR-CO-16"));

    // BR-CO-17 : TVA d'une catégorie ≠ base × taux
    let mut inv = valid_invoice();
    inv.vat_breakdown[0].tax_amount = Some(dec!(200.00));
    assert!(has(&inv, "BR-CO-17"));

    // BR-DEC : plus de 2 décimales
    let mut inv = valid_invoice();
    inv.totals.tax_amount = Some(dec!(220.001));
    assert!(has(&inv, "BR-DEC"));
}

#[test]
fn vat_categories() {
    // Standard : taux doit être > 0
    let mut inv = valid_invoice();
    inv.lines[0].vat_rate = Some(dec!(0));
    assert!(has(&inv, "BR-S-05"));

    // Taux zéro : taux doit être 0
    let mut inv = valid_invoice();
    inv.lines[0].vat_category = Some(VatCategory::ZeroRated);
    inv.lines[0].vat_rate = Some(dec!(5));
    assert!(has(&inv, "BR-Z-05"));

    // Exonéré : taux doit être 0
    let mut inv = valid_invoice();
    inv.lines[0].vat_category = Some(VatCategory::Exempt);
    inv.lines[0].vat_rate = Some(dec!(5));
    assert!(has(&inv, "BR-E-05"));

    // Autoliquidation : taux doit être 0
    let mut inv = valid_invoice();
    inv.lines[0].vat_category = Some(VatCategory::ReverseCharge);
    inv.lines[0].vat_rate = Some(dec!(5));
    assert!(has(&inv, "BR-AE-05"));

    // Exonéré (ventilation) : motif requis
    let mut inv = valid_invoice();
    inv.vat_breakdown[0].category = Some(VatCategory::Exempt);
    assert!(has(&inv, "BR-E-10"));
}

#[test]
fn cell_reference_is_resolved_for_highlighting() {
    let mut inv = valid_invoice();
    inv.seller.siren = Some("732829321".into()); // cassé
    inv.cells.insert("seller.siren".into(), "C5".into());

    let report = validate(&inv);
    let issue = report
        .issues
        .iter()
        .find(|i| i.code == "FR-SIREN-LUHN")
        .expect("FR-SIREN-LUHN attendu");
    assert_eq!(issue.cell_ref.as_deref(), Some("C5"));
}

#[test]
fn validate_json_roundtrip() {
    let json = serde_json::to_string(&valid_invoice()).unwrap();
    let report_json = validate_json(&json).unwrap();
    let report: facture_core::ValidationReport = serde_json::from_str(&report_json).unwrap();
    assert!(report.is_sendable);
    assert!(report.issues.is_empty());
}

#[test]
fn soft_warnings_are_non_blocking() {
    let mut inv = valid_invoice();
    inv.currency = Some("USD".into()); // AI-CURRENCY
    inv.due_date = Some("2026-08-01".into()); // antérieure à l'émission → AI-DATE-LOGIC

    let report = validate(&inv);
    let codes: Vec<&str> = report.issues.iter().map(|i| i.code.as_str()).collect();
    assert!(codes.contains(&"AI-CURRENCY"));
    assert!(codes.contains(&"AI-DATE-LOGIC"));
    // Que des avertissements doux → la facture reste envoyable.
    assert!(report.is_sendable);
    assert!(report
        .issues
        .iter()
        .all(|i| i.severity == facture_core::Severity::SoftWarning));
}

#[test]
fn unusual_vat_rate_warns_without_blocking() {
    let mut inv = valid_invoice();
    inv.lines[0].vat_rate = Some(dec!(7)); // hors taux FR usuels
    assert!(has(&inv, "AI-VAT-RATE"));
    assert!(validate(&inv).is_sendable);
}
