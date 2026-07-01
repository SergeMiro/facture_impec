//! Modèle de données neutre `Invoice`, indépendant de B2Brouter et de Factur-X.
//!
//! Aligné sur les **Business Terms (BT-)** de la norme EN 16931 pour faciliter le
//! mapping vers le format PDP (Phase 3). Profil visé au départ : *Basic WL* → *EN 16931*.
//! Les montants sont des [`rust_decimal::Decimal`] (jamais des flottants) : la cohérence
//! des totaux est une source de vérité, le flottant introduirait des écarts d'arrondi.

use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Facture complète telle que lue depuis la feuille Excel (plages nommées + table de lignes).
///
/// Tous les champs « saisis » sont `Option` afin que les règles de présence (EN 16931 BR-*)
/// puissent distinguer « absent » de « vide » ou « invalide ».
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Invoice {
    /// BT-1 — numéro de facture.
    pub invoice_number: Option<String>,
    /// BT-2 — date d'émission, au format `AAAA-MM-JJ`.
    pub issue_date: Option<String>,
    /// BT-9 — date d'échéance, au format `AAAA-MM-JJ`.
    pub due_date: Option<String>,
    /// BT-3 — code type de facture (ex. `380` = facture commerciale).
    pub type_code: Option<String>,
    /// BT-5 — code devise ISO 4217 (ex. `EUR`).
    pub currency: Option<String>,

    /// Émetteur (BG-4).
    #[serde(default)]
    pub seller: Party,
    /// Acheteur (BG-7).
    #[serde(default)]
    pub buyer: Party,

    /// Lignes de facture (BG-25), au moins une (BR-16).
    #[serde(default)]
    pub lines: Vec<Line>,
    /// Ventilation de la TVA par catégorie/taux (BG-23). Optionnelle au MVP :
    /// si absente, les règles BR-CO-14/17 ne s'appliquent pas.
    #[serde(default)]
    pub vat_breakdown: Vec<VatBreakdown>,
    /// Totaux (BG-22) tels que présents dans la feuille — recalculés et comparés.
    #[serde(default)]
    pub totals: Totals,
    /// Informations de paiement (IBAN/BIC, conditions).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payment: Option<Payment>,

    /// Correspondance « chemin de champ logique → référence de cellule Excel »
    /// (ex. `"seller.siret" → "C5"`, `"lines[2].vat_rate" → "F9"`). Fournie par
    /// `excelBridge.readInvoice()` (Phase 2) ; sert au surlignage. Optionnelle.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub cells: BTreeMap<String, String>,
}

/// Partie prenante (vendeur ou acheteur).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Party {
    /// BT-27 (vendeur) / BT-44 (acheteur) — nom / raison sociale.
    pub name: Option<String>,
    /// SIREN — 9 chiffres (identifiant légal FR).
    pub siren: Option<String>,
    /// SIRET — 14 chiffres (SIREN + NIC).
    pub siret: Option<String>,
    /// BT-31 (vendeur) / BT-48 (acheteur) — n° de TVA intracommunautaire (ex. `FR40303265045`).
    pub vat_id: Option<String>,
    /// Adresse postale.
    #[serde(default)]
    pub address: Address,
}

/// Adresse postale (BG-5 vendeur / BG-8 acheteur).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Address {
    pub line1: Option<String>,
    pub postal_code: Option<String>,
    pub city: Option<String>,
    /// BT-40 (vendeur) / BT-55 (acheteur) — code pays ISO 3166-1 alpha-2 (ex. `FR`).
    pub country_code: Option<String>,
}

/// Ligne de facture (BG-25).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Line {
    /// Identifiant / libellé de ligne (ex. n° de ligne) — sert au mapping cellule.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// BT-153 — description de l'article/service.
    pub description: Option<String>,
    /// BT-129 — quantité facturée.
    pub quantity: Option<Decimal>,
    /// BT-130 — unité de mesure.
    pub unit: Option<String>,
    /// BT-146 — prix unitaire net.
    pub unit_price: Option<Decimal>,
    /// BT-131 — montant net de ligne (quantité × prix unitaire net).
    pub line_amount: Option<Decimal>,
    /// BT-152 — taux de TVA de la ligne, en pourcentage (ex. `20`).
    pub vat_rate: Option<Decimal>,
    /// BT-151 — catégorie de TVA.
    pub vat_category: Option<VatCategory>,
}

/// Catégorie de TVA (BT-151 / BT-118), codes UNCL5305.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(from = "String", into = "String")]
pub enum VatCategory {
    /// `S` — taux standard.
    Standard,
    /// `Z` — taux zéro.
    ZeroRated,
    /// `E` — exonéré de TVA.
    Exempt,
    /// `AE` — autoliquidation (reverse charge).
    ReverseCharge,
    /// Tout autre code (ex. `K`, `G`, `O`) conservé tel quel.
    Other(String),
}

impl VatCategory {
    /// Code UNCL5305 (ex. `"S"`, `"AE"`).
    pub fn code(&self) -> String {
        match self {
            VatCategory::Standard => "S".to_string(),
            VatCategory::ZeroRated => "Z".to_string(),
            VatCategory::Exempt => "E".to_string(),
            VatCategory::ReverseCharge => "AE".to_string(),
            VatCategory::Other(s) => s.clone(),
        }
    }
}

impl From<String> for VatCategory {
    fn from(s: String) -> Self {
        match s.trim().to_uppercase().as_str() {
            "S" => VatCategory::Standard,
            "Z" => VatCategory::ZeroRated,
            "E" => VatCategory::Exempt,
            "AE" => VatCategory::ReverseCharge,
            _ => VatCategory::Other(s),
        }
    }
}

impl From<VatCategory> for String {
    fn from(c: VatCategory) -> Self {
        c.code()
    }
}

/// Une entrée de la ventilation TVA (BG-23).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct VatBreakdown {
    /// BT-118 — catégorie de TVA.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<VatCategory>,
    /// BT-119 — taux de TVA (%).
    pub rate: Option<Decimal>,
    /// BT-116 — base imposable.
    pub taxable_amount: Option<Decimal>,
    /// BT-117 — montant de TVA de la catégorie.
    pub tax_amount: Option<Decimal>,
    /// BT-121 — code du motif d'exonération (ex. `VATEX-FR-FRANCHISE`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exemption_reason_code: Option<String>,
    /// BT-120 — texte du motif d'exonération.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exemption_reason_text: Option<String>,
}

/// Totaux du document (BG-22).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Totals {
    /// BT-106 — somme des montants nets de ligne.
    pub line_extension_amount: Option<Decimal>,
    /// BT-109 — total HT (montant total hors TVA).
    pub tax_exclusive_amount: Option<Decimal>,
    /// BT-110 — total de la TVA.
    pub tax_amount: Option<Decimal>,
    /// BT-112 — total TTC (montant total avec TVA).
    pub tax_inclusive_amount: Option<Decimal>,
    /// BT-113 — montant déjà payé.
    pub paid_amount: Option<Decimal>,
    /// BT-114 — montant d'arrondi.
    pub rounding_amount: Option<Decimal>,
    /// BT-115 — net à payer.
    pub payable_amount: Option<Decimal>,
}

/// Informations de paiement.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Payment {
    pub iban: Option<String>,
    pub bic: Option<String>,
    /// Conditions de paiement (texte).
    pub terms: Option<String>,
}
