// Documents a BTP company receives, for the document classifier's eval (BTP plan §11): the 14 kinds
// it tells apart, each written plainly, without its title, or damaged by OCR, so that some need the
// model. Synthetic companies and numbers only; real anonymized documents from pilots replace them
// (`docs/TODO.md`).
import type { ClassifyLabel, DocumentText } from '../src/classify';

export interface ClassifyFixture {
  name: string;
  doc: DocumentText;
  expected: ClassifyLabel;
}

const f = (
  name: string,
  expected: ClassifyLabel,
  file: string,
  lines: string[],
  subject?: string,
): ClassifyFixture => ({ name, expected, doc: { name: file, text: lines.join('\n'), subject } });

export const CLASSIFY_FIXTURES: ClassifyFixture[] = [
  // ── facture ──
  f('facture-titled', 'facture', 'F-2026-0412.pdf', [
    'ATELIER DUPONT SARL',
    '12 rue des Forges 21000 Dijon — SIRET 100 000 009 00017',
    'FACTURE N° F-2026-0412',
    'Date : 03/10/2026',
    'Client : Maçonnerie Durand SAS, 4 allée des Saules 21121 Fontaine-lès-Dijon',
    'Fourniture et pose de menuiseries PVC — chantier Tanneurs',
    'Total HT 4 200,00 €   TVA 20 % 840,00 €   Net à payer 5 040,00 €',
    'Échéance : 02/11/2026 — Pénalités de retard : 3 fois le taux légal, indemnité 40 €',
  ]),
  f('facture-ocr', 'facture', 'scan0042.pdf', [
    'ATELlER DUP0NT SARL',
    'F A C T U R E   N° F-2026-0413',
    'Date : O3/1O/2026',
    'Désignation         Qté   P.U.     Montant',
    'Location échafaudage 1   650,OO   650,OO',
    'Total HT 650,OO €  TVA 2O % 130,OO €  Net à paver 780,OO €',
    'Règlement : virement à 30 jours',
  ]),
  f('facture-doit', 'facture', 'document.pdf', [
    'LOCAMAT BOURGOGNE',
    'Doit : Maçonnerie Durand',
    'Réf. chantier : Tanneurs — bon n° 8812',
    'Désignation / Qté / PU HT / Montant HT',
    'Location nacelle 12 m — 3 jours — 120,00 — 360,00',
    'Transport aller-retour — 1 — 90,00 — 90,00',
    'Total HT 450,00 € — TVA 20 % 90,00 € — Total TTC 540,00 €',
    'Règlement à 30 jours fin de mois par virement. Escompte pour paiement anticipé : néant.',
  ]),

  // ── situation ──
  f('situation-titled', 'situation', 'situation-4.pdf', [
    'SITUATION DE TRAVAUX N° 4',
    'Chantier : Résidence Les Tilleuls — Lot gros œuvre',
    'Montant du marché HT 180 000,00 €',
    'Avancement cumulé : 62 %   Travaux cumulés HT 111 600,00 €',
    'Situations précédentes HT 86 400,00 €',
    'Montant de la situation HT 25 200,00 €  Retenue de garantie 5 % : 1 260,00 €',
  ]),
  f('situation-etat', 'situation', 'avancement-septembre.pdf', [
    'Lot plâtrerie — isolation — Bâtiment B',
    'État d’avancement arrêté au 30/09/2026',
    'Poste                      % réalisé    Montant cumulé HT',
    'Cloisons placo             80 %         24 000,00',
    'Doublages                  45 %         9 900,00',
    'Cumul à ce jour 33 900,00 € — Déjà facturé 21 000,00 € — À facturer ce mois 12 900,00 €',
    'Retenue de garantie 5 % — TVA autoliquidée (art. 283-2 nonies du CGI)',
  ]),
  f('situation-ocr', 'situation', 'IMG_2231.jpg', [
    'S1TUATI0N N° 2 — Chantier Ecole J. Moulin',
    'Marché HT 64 OOO,OO',
    'Cumul réalisé 38 % — 24 32O,OO',
    'Déduction situation n° 1 — 12 8OO,OO',
    'Net de la présente 11 52O,OO HT',
  ]),

  // ── avoir ──
  f('avoir-titled', 'avoir', 'AV-2026-007.pdf', [
    'BÉTON SERVICES 21',
    'AVOIR N° AV-2026-007',
    'En référence à la facture F-2026-0388 du 12/09/2026',
    'Motif : retour de 12 sacs de ciment non utilisés',
    'Montant de l’avoir TTC : 158,40 €',
  ]),
  f('avoir-rectificatif', 'avoir', 'document-rectificatif.pdf', [
    'Document rectificatif',
    'Nous annulons partiellement notre facture n° F-2026-0391 du 15/09/2026 :',
    'la livraison du 10/09 a été facturée deux fois.',
    'Montant à déduire de votre prochain règlement : - 240,00 € TTC',
  ]),
  f('avoir-credit-note', 'avoir', 'CN-0045.pdf', [
    'BAUSTOFF HANDEL GMBH',
    'CREDIT NOTE No. CN-0045',
    'Against invoice INV-2201 dated 2026-09-02',
    'Reason: damaged pallets',
    'Total credit EUR 300.00 — Reverse charge',
  ]),

  // ── devis ──
  f('devis-titled', 'devis', 'D-2026-118.pdf', [
    'COUVERTURE MARTIN',
    'DEVIS N° D-2026-118',
    'Objet : réfection de toiture en tuiles mécaniques — 120 m²',
    'Total HT 14 400,00 € — TVA 10 % 1 440,00 € — Total TTC 15 840,00 €',
    'Validité de l’offre : 30 jours',
    'Bon pour accord, date et signature :',
  ]),
  f('devis-proposition', 'devis', 'proposition.pdf', [
    'Proposition d’intervention',
    'Suite à votre demande et à notre visite du 02/10/2026, nous vous proposons :',
    '- dépose et évacuation de l’ancienne chaudière',
    '- fourniture et pose d’une pompe à chaleur air-eau 8 kW',
    'Montant estimé HT 9 800,00 €. Cette proposition reste ouverte un mois.',
    'Merci de nous la retourner signée pour planifier les travaux.',
  ]),
  f('devis-ocr', 'devis', 'scan_devis.pdf', [
    'D E V I S',
    'Ref : 2026-77   Client : SCI Les Tilleuls',
    'Ravalement façade sud — échafaudage compris',
    'TOTAL HT 7 2OO,OO   TVA 2O%   TTC 8 64O,OO',
    'Offre valable 3 mois — acompte 30 % à la commande',
  ]),

  // ── contrat de sous-traitance ──
  f('sous-traitance-titled', 'contrat_sous_traitance', 'contrat-st-moreau.pdf', [
    'CONTRAT DE SOUS-TRAITANCE',
    'Entre : Maçonnerie Durand SAS, entrepreneur principal,',
    'et : Électricité Moreau SARL, ci-après désignée « le sous-traitant »,',
    'Il est convenu ce qui suit, conformément à la loi n° 75-1334 du 31 décembre 1975.',
    'Article 1 — Objet : lot électricité courants forts et faibles.',
  ]),
  f('sous-traitance-conditions', 'contrat_sous_traitance', 'conditions-particulieres.pdf', [
    'Conditions particulières — Lot 07 Électricité',
    'L’entreprise principale confie à l’entreprise désignée ci-après l’exécution des travaux',
    'd’électricité du chantier « Groupe scolaire J. Moulin », pour un montant forfaitaire de',
    '48 000,00 € HT. L’entreprise désignée sera payée directement par le maître de l’ouvrage',
    '(paiement direct). Elle fournit avant tout démarrage ses attestations URSSAF et d’assurance.',
  ]),
  f('sous-traitance-avenant', 'contrat_sous_traitance', 'avenant-1.pdf', [
    'AVENANT N° 1 AU CONTRAT DE SOUS-TRAITANCE du 12/03/2026',
    'Objet : travaux supplémentaires — prises extérieures',
    'Montant de l’avenant HT : 3 200,00 €',
  ]),

  // ── contrat de travail ──
  f('travail-titled', 'contrat_travail', 'cdd-maçon.pdf', [
    'CONTRAT DE TRAVAIL À DURÉE DÉTERMINÉE',
    'Entre la société Maçonnerie Durand SAS, ci-après l’employeur,',
    'et M. Karim Benali, ci-après le salarié,',
    'Motif : accroissement temporaire d’activité. Durée : 6 mois.',
  ]),
  f('travail-engagement', 'contrat_travail', 'lettre-engagement.pdf', [
    'Lettre d’engagement',
    'Monsieur,',
    'Nous avons le plaisir de vous confirmer votre embauche en qualité de maçon N2 P1,',
    'coefficient 185 de la convention collective du bâtiment, à compter du 02/11/2026.',
    'Votre période d’essai est d’un mois. Votre rémunération brute mensuelle sera de 2 150,00 €.',
    'Veuillez nous retourner un exemplaire signé.',
  ]),
  f('travail-apprentissage', 'contrat_travail', 'cerfa.pdf', [
    'CERFA 10103*10',
    'L’EMPLOYEUR — L’APPRENTI(E) — LE CONTRAT',
    'Type de contrat ou d’avenant : 11 — Premier contrat d’apprentissage de l’apprenti',
    'Diplôme préparé : CAP Maçon — CFA du BTP de Dijon',
    'Date de début d’exécution : 01/09/2026',
  ]),

  // ── attestation de vigilance ──
  f('vigilance-titled', 'attestation_vigilance', 'attestation-urssaf.pdf', [
    'ATTESTATION DE VIGILANCE',
    'Délivrée le 12/03/2026',
    'L’Urssaf atteste que l’entreprise ÉLECTRICITÉ MOREAU, SIREN 100 000 009,',
    'est à jour de ses obligations de déclaration et de paiement auprès de l’Urssaf.',
    'Code de sécurité : A1B2C3D4E5F6G7',
  ]),
  f('vigilance-ocr', 'attestation_vigilance', 'scan0107.pdf', [
    'urssaf.fr',
    'ATTESTAT1ON DE VlG1LANCE',
    'L’Urssaf atteste que l’entreprise désignée ci-dessous est à jour de ses obligations',
    'déclaratives et de paiement au 31/08/2026.',
    'Nombre de salariés : 7 — Masse salariale : 182 400 €',
  ]),
  f('vigilance-msa', 'attestation_vigilance', 'msa.pdf', [
    'Mutualité Sociale Agricole de Bourgogne',
    'Attestation de fourniture des déclarations sociales et de paiement des cotisations',
    'et contributions de sécurité sociale (article L. 243-15 du code de la sécurité sociale)',
    'Entreprise : PAYSAGES DUCHÊNE — SIREN 300 000 007',
  ]),

  // ── Kbis ──
  f('kbis-titled', 'kbis', 'kbis.pdf', [
    'Greffe du tribunal de commerce de Dijon',
    'Extrait Kbis',
    'Extrait d’immatriculation principale au registre du commerce et des sociétés',
    'à jour au 5 janvier 2026',
    'Dénomination : ÉLECTRICITÉ MOREAU — Forme : SARL — RCS Dijon 100 000 009',
  ]),
  f('kbis-rne', 'kbis', 'extrait-rne.pdf', [
    'INPI',
    'Attestation d’immatriculation au registre national des entreprises',
    'Entreprise : PLOMBERIE ROUX — SIREN 300 000 007',
    'Activité : plomberie, chauffage — Date de début d’activité : 01/03/2019',
  ]),
  f('kbis-ocr', 'kbis', 'scan0099.pdf', [
    'GREFFE DU TRIBUNAL DE C0MMERCE DE BEAUNE',
    'E X T R A I T   K B I S',
    'Immatriculation au R.C.S. : 2016 B 00412',
    'Gestion du registre : extrait certifié conforme le 02/02/2026',
  ]),

  // ── assurance décennale ──
  f('decennale-titled', 'attestation_assurance_decennale', 'attestation-decennale.pdf', [
    'ATTESTATION D’ASSURANCE RESPONSABILITÉ CIVILE DÉCENNALE',
    'Nous soussignés, Mutuelle du Bâtiment, attestons que l’entreprise ÉLECTRICITÉ MOREAU',
    'est titulaire du contrat n° 4471-22 garantissant sa responsabilité décennale.',
    'Période de validité : du 01/01/2026 au 31/12/2026',
  ]),
  f('decennale-rc-et', 'attestation_assurance_decennale', 'assurance-2026.pdf', [
    'Attestation d’assurance',
    'Responsabilité civile et décennale — Entreprises du bâtiment',
    'Activités garanties : maçonnerie, béton armé',
    'Valable du 01/01/2026 au 31/12/2026',
  ]),
  f('decennale-1792', 'attestation_assurance_decennale', 'certificat.pdf', [
    'Certificat',
    'Nous soussignés certifions que l’entreprise désignée ci-dessous est garantie au titre des',
    'articles 1792 et suivants du Code civil pour les travaux de gros œuvre dont l’ouverture de',
    'chantier intervient entre le 01/01/2026 et le 31/12/2026, ouvrages soumis à obligation',
    'd’assurance, coût total de chantier inférieur à 15 M€.',
  ]),

  // ── assurance RC ──
  f('rc-titled', 'attestation_assurance_rc', 'rc-pro.pdf', [
    'ATTESTATION D’ASSURANCE',
    'Responsabilité civile professionnelle',
    'Nous attestons que PLOMBERIE ROUX est assurée par le contrat n° RC-88-120.',
    'La présente attestation est valable jusqu’au 30/06/2027.',
  ]),
  f('rc-abbr', 'attestation_assurance_rc', 'attestation-rc-exploitation.pdf', [
    'Attestation RC Exploitation',
    'Assuré : Paysages Duchêne — Contrat 2026-PRO-4471',
    'Montant de garantie tous dommages confondus : 6 000 000 € par sinistre',
    'Validité : du 01/04/2026 au 31/03/2027',
  ]),
  f('rc-encourue', 'attestation_assurance_rc', 'attestation-assureur.pdf', [
    'Nous certifions que l’entreprise désignée ci-dessous est titulaire d’un contrat',
    'garantissant les conséquences pécuniaires de la responsabilité civile qu’elle peut encourir',
    'du fait de son activité de paysagiste, à l’égard des tiers, pour les dommages corporels,',
    'matériels et immatériels. Ce contrat ne couvre pas la responsabilité décennale.',
    'Période : du 01/01/2026 au 31/12/2026',
  ]),

  // ── liste des salariés étrangers ──
  f('etrangers-titled', 'liste_salaries_etrangers', 'liste.pdf', [
    'LISTE NOMINATIVE DES SALARIÉS ÉTRANGERS',
    'soumis à autorisation de travail (article D8254-2 du code du travail)',
    'Nom — Prénom — Date d’embauche — Nationalité — Titre — N°',
  ]),
  f('etrangers-article', 'liste_salaries_etrangers', 'D8254-2.pdf', [
    'Article D8254-2 du code du travail',
    'Salariés employés soumis à autorisation de travail',
    'Nom / Prénom / Date d’embauche / Nationalité / Type et numéro du titre valant autorisation',
    'de travail — à remettre au donneur d’ordre lors de la conclusion du contrat puis tous les six mois',
  ]),
  f('etrangers-tableau', 'liste_salaries_etrangers', 'liste-etrangers.pdf', [
    'Entreprise : Façades Lopes — chantier Résidence Les Tilleuls',
    'Salariés étrangers : 3',
    'NOM          NATIONALITÉ   TITRE DE SÉJOUR      N°            VALIDITÉ',
    'Silva J.     portugaise    (UE, sans titre)     —             —',
    'Diallo M.    malienne      carte de séjour      2101234567    12/2027',
  ]),

  // ── PV de réception ──
  f('pv-titled', 'pv_reception', 'pv-reception.pdf', [
    'PROCÈS-VERBAL DE RÉCEPTION DES TRAVAUX',
    'Marché : Groupe scolaire J. Moulin — Lot 02 Gros œuvre',
    'Le maître de l’ouvrage déclare que la réception est prononcée avec réserves',
    'avec effet à la date du 14/09/2026. Liste des réserves en annexe.',
  ]),
  f('pv-levee', 'pv_reception', 'pv-levee-reserves.pdf', [
    'PV de levée des réserves',
    'Les réserves formulées lors de la réception du 14/09/2026 ont été levées le 20/10/2026.',
  ]),
  f('pv-sans-titre', 'pv_reception', 'scan0144.pdf', [
    'Le maître de l’ouvrage, après avoir procédé le 30/09/2026 à la visite des travaux exécutés',
    'par l’entreprise, en présence de celle-ci, déclare que la réception est prononcée sans',
    'réserve avec effet au 30/09/2026. Fait en deux exemplaires.',
  ]),

  // ── DGD ──
  f('dgd-titled', 'dgd', 'dgd.pdf', [
    'DÉCOMPTE GÉNÉRAL ET DÉFINITIF',
    'Marché n° 24-118 — Lot 03 Charpente',
    'Montant initial 92 000,00 € HT — Avenants 4 500,00 € — Pénalités 0,00 €',
    'Total des acomptes versés 91 200,00 € — Solde à payer 5 300,00 € HT',
  ]),
  f('dgd-ocr', 'dgd', 'scan0151.pdf', [
    'D.G.D. — MARCHE 24-ll8',
    'Récapitulatif : montant du marché, avenants, révisions de prix, pénalités, retenue',
    'Total général : 96 5OO,OO HT — acomptes 91 2OO,OO — solde 5 3OO,OO',
    'Le présent décompte devient définitif à défaut de réclamation sous 30 jours.',
  ]),

  // ── autre ──
  f('autre-livraison', 'autre', 'BL-4471.pdf', [
    'BON DE LIVRAISON N° 4471',
    'Livré le 02/10/2026 sur chantier Tanneurs',
    '24 sacs ciment CEM II 35 kg — 2 palettes parpaings 20x20x50',
    'Reçu en bon état, signature du client :',
  ]),
  f('autre-releve', 'autre', 'releve-10-2026.pdf', [
    'Banque Populaire Bourgogne Franche-Comté',
    'Relevé de compte n° 10 — du 01/10/2026 au 31/10/2026',
    'Solde créditeur au 31/10/2026 : 12 480,20 €',
  ]),
  f('autre-relance', 'autre', 'relance.pdf', [
    'Madame, Monsieur,',
    'Sauf erreur de notre part, nous n’avons pas reçu le règlement de notre facture n° F-2026-0301',
    'du 01/08/2026, échue depuis le 31/08/2026, d’un montant de 2 340,00 € TTC.',
    'Nous vous remercions de bien vouloir procéder à son règlement dans les meilleurs délais.',
  ]),
  f('autre-plan', 'autre', 'R+1.pdf', [
    'PLAN D’EXÉCUTION — NIVEAU R+1',
    'Échelle 1/50 — Indice C — Dessiné par BET Structures Bourgogne',
    'Voiles BA ép. 18 cm — Dalle ép. 20 cm — Trémies escalier',
  ]),
  f('autre-paie', 'autre', 'paie-09-2026.pdf', [
    'BULLETIN DE PAIE — Septembre 2026',
    'Salarié : M. Karim Benali — Maçon N2 P1 — Coefficient 185',
    'Salaire de base 2 150,00 € — Indemnités de trajet — Net à payer avant impôt 1 712,40 €',
  ]),
  f('autre-courrier', 'autre', 'courrier-planning.pdf', [
    'Objet : décalage du planning — chantier Résidence Les Tilleuls',
    'Monsieur,',
    'Le coulage de la dalle du R+2 est reporté au 12/11/2026 en raison des intempéries.',
    'Merci d’adapter l’intervention de vos équipes en conséquence.',
  ]),
  f('autre-commande', 'autre', 'commande.pdf', [
    'BON DE COMMANDE N° C-2026-220',
    'Fournisseur : Négoce Bois du Morvan',
    'Livraison souhaitée : semaine 45 — chantier Tanneurs',
  ]),
];
