export type ContractFieldName =
  | 'parties'
  | 'term'
  | 'noticePeriod'
  | 'value'
  | 'renewal';

export type ContractClause = string | [field: ContractFieldName, text: string];

export interface ContractSection {
  title: string;
  clauses: ContractClause[];
}

export interface ContractData {
  pdf: string;
  title: string;
  values: Record<ContractFieldName, string | null>;
  sections: ContractSection[];
}

export interface MinutesData {
  pdf: string;
  title: string;
  date: string;
  participants: string[];
  agenda: string[];
  decisions: string[];
}

const GF_CANARY_CLAUSE =
  'Aktenzeichen der Geschäftsführung für die Ablage: CANARY-9E40B7A3.';

const OWN_COMPANY = 'Ostmooimooi Anlagenbau GmbH';

const closingSections: ContractSection[] = [
  {
    title: 'Vertraulichkeit',
    clauses: [
      'Die Parteien behandeln alle nicht öffentlichen Informationen, die sie im Zusammenhang mit diesem Vertrag erhalten, vertraulich.',
      'Die Pflicht zur Vertraulichkeit gilt auch nach Beendigung des Vertrags für einen Zeitraum von drei Jahren fort.',
      'Eine Weitergabe an Mitarbeitende und Berater ist zulässig, soweit diese die Informationen für die Vertragsdurchführung benötigen und zur Vertraulichkeit verpflichtet sind.',
    ],
  },
  {
    title: 'Datenschutz',
    clauses: [
      'Soweit personenbezogene Daten verarbeitet werden, halten die Parteien die geltenden Datenschutzvorschriften ein.',
      'Jede Partei benennt der anderen Partei auf Anfrage eine Ansprechperson für Fragen des Datenschutzes.',
    ],
  },
  {
    title: 'Schlussbestimmungen',
    clauses: [
      'Änderungen und Ergänzungen dieses Vertrags bedürfen der Schriftform. Dies gilt auch für die Aufhebung dieser Schriftformklausel.',
      'Sollte eine Bestimmung dieses Vertrags unwirksam sein, bleibt die Wirksamkeit der übrigen Bestimmungen unberührt.',
      'Erfüllungsort und Gerichtsstand für alle Streitigkeiten aus diesem Vertrag ist Beispielstadt, soweit gesetzlich zulässig.',
      'Es gilt das Recht der Bundesrepublik Deutschland unter Ausschluss des UN-Kaufrechts.',
    ],
  },
];

export const CONTRACTS: ContractData[] = [
  {
    pdf: 'kundenvertrag-stadtwerke-beispielstadt.pdf',
    title: 'Werkvertrag Belebungsstufe',
    values: {
      parties: `${OWN_COMPANY} und Stadtwerke Beispielstadt AöR`,
      term: 'Die Vertragslaufzeit beträgt 24 Monate ab dem 01.04.2026',
      noticePeriod: 'Kündigungsfrist von drei Monaten zum Quartalsende',
      value: '1.200.000,00 € netto',
      renewal: 'verlängert sich der Vertrag um jeweils 12 Monate',
    },
    sections: [
      {
        title: 'Vertragsparteien',
        clauses: [
          [
            'parties',
            `Dieser Vertrag wird geschlossen zwischen ${OWN_COMPANY} und Stadtwerke Beispielstadt AöR, Beispielweg 1, 00000 Beispielstadt.`,
          ],
          `Die ${OWN_COMPANY} handelt als Auftragnehmerin, die Stadtwerke Beispielstadt AöR handeln als Auftraggeberin.`,
        ],
      },
      {
        title: 'Vertragsgegenstand',
        clauses: [
          'Die Auftragnehmerin errichtet auf dem Gelände der Auftraggeberin eine Belebungsstufe einschließlich Gebläsetechnik, Messtechnik und Steuerung.',
          'Der Leistungsumfang ergibt sich aus dem Leistungsverzeichnis, das als Anlage 1 Bestandteil dieses Vertrags ist.',
          'Die Auftragnehmerin stimmt den Bauablauf mit der Betriebsleitung der Auftraggeberin ab und meldet Störungen im Betrieb unverzüglich.',
        ],
      },
      {
        title: 'Vergütung',
        clauses: [
          [
            'value',
            'Der Auftragswert beträgt 1.200.000,00 € netto zuzüglich der gesetzlichen Umsatzsteuer.',
          ],
          'Die Vergütung wird nach Baufortschritt in fünf Raten fällig, die im Zahlungsplan der Anlage 2 festgelegt sind.',
          'Rechnungen sind innerhalb von 30 Tagen nach Zugang ohne Abzug zu bezahlen.',
        ],
      },
      {
        title: 'Laufzeit und Kündigung',
        clauses: [
          ['term', 'Die Vertragslaufzeit beträgt 24 Monate ab dem 01.04.2026.'],
          [
            'noticePeriod',
            'Jede Partei kann den Vertrag mit einer Kündigungsfrist von drei Monaten zum Quartalsende schriftlich kündigen.',
          ],
          [
            'renewal',
            'Wird der Vertrag nicht fristgerecht gekündigt, verlängert sich der Vertrag um jeweils 12 Monate.',
          ],
          'Das Recht zur außerordentlichen Kündigung aus wichtigem Grund bleibt unberührt.',
        ],
      },
      {
        title: 'Gewährleistung',
        clauses: [
          'Die Gewährleistungsfrist beträgt fünf Jahre ab Abnahme der Belebungsstufe.',
          'Mängel sind schriftlich anzuzeigen. Die Auftragnehmerin beginnt die Nacharbeit innerhalb von zehn Werktagen nach Eingang der Anzeige.',
          'Verschleißteile sind von der Gewährleistung ausgenommen, soweit der Verschleiß nicht auf einem Fehler der Anlage beruht.',
        ],
      },
      ...closingSections,
    ],
  },
  {
    pdf: 'rahmenvertrag-wasserverband-muster.pdf',
    title: 'Rahmenvertrag Ersatzteile und Wartung',
    values: {
      parties: `${OWN_COMPANY} und Wasserverband Muster`,
      term: 'Der Rahmenvertrag läuft vom 01.07.2025 bis zum 30.06.2028',
      noticePeriod: 'Kündigungsfrist von sechs Monaten zum Jahresende',
      value: '450.000,00 € netto pro Vertragsjahr',
      renewal: 'verlängert sich der Rahmenvertrag um ein weiteres Jahr',
    },
    sections: [
      {
        title: 'Vertragsparteien',
        clauses: [
          [
            'parties',
            `Dieser Rahmenvertrag wird geschlossen zwischen ${OWN_COMPANY} und Wasserverband Muster, Verbandsstraße 2, 00000 Beispielstadt.`,
          ],
          `Die ${OWN_COMPANY} ist Lieferantin und Dienstleisterin, der Wasserverband Muster ist Besteller.`,
        ],
      },
      {
        title: 'Leistungen',
        clauses: [
          'Die Lieferantin liefert Ersatzteile für die Anlagen des Bestellers und führt jährlich eine Inspektion der Anlagen durch.',
          'Außerdem hält die Lieferantin einen Störungsdienst vor, der werktags innerhalb von vier Stunden nach Meldung beginnt.',
          'Einzelaufträge erteilt der Besteller durch Abruf unter Angabe der Anlage und des gewünschten Termins.',
        ],
      },
      {
        title: 'Vergütung und Abrechnung',
        clauses: [
          [
            'value',
            'Das Rahmenvolumen beträgt 450.000,00 € netto pro Vertragsjahr.',
          ],
          'Abgerufene Leistungen werden nach der Preisliste der Anlage 1 vergütet und quartalsweise abgerechnet.',
          'Wird das Rahmenvolumen in einem Vertragsjahr nicht ausgeschöpft, entsteht daraus kein Anspruch auf Vergütung.',
        ],
      },
      {
        title: 'Laufzeit und Kündigung',
        clauses: [
          [
            'term',
            'Der Rahmenvertrag läuft vom 01.07.2025 bis zum 30.06.2028.',
          ],
          [
            'noticePeriod',
            'Der Rahmenvertrag kann von beiden Parteien mit einer Kündigungsfrist von sechs Monaten zum Jahresende gekündigt werden.',
          ],
          [
            'renewal',
            'Erfolgt keine Kündigung, verlängert sich der Rahmenvertrag um ein weiteres Jahr.',
          ],
        ],
      },
      {
        title: 'Haftung und Gewährleistung',
        clauses: [
          'Die Lieferantin haftet für Schäden nach den gesetzlichen Vorschriften, bei leichter Fahrlässigkeit nur für die Verletzung wesentlicher Vertragspflichten.',
          'Die Gewährleistung für gelieferte Ersatzteile beträgt 24 Monate ab Lieferung.',
          'Der Besteller prüft gelieferte Teile unverzüglich und zeigt offensichtliche Mängel innerhalb von sieben Tagen an.',
        ],
      },
      ...closingSections,
    ],
  },
  {
    pdf: 'liefervertrag-pumpen-fiktivwerk.pdf',
    title: 'Liefervertrag Tauchpumpen',
    values: {
      parties: `${OWN_COMPANY} und Fiktivwerk Pumpen GmbH`,
      term: 'Der Liefervertrag gilt bis zum 31.12.2027',
      noticePeriod: 'Kündigungsfrist von 30 Tagen zum Monatsende',
      value: '186.000,00 € netto',
      renewal: 'einmaligen Verlängerung um 12 Monate',
    },
    sections: [
      {
        title: 'Vertragsparteien',
        clauses: [
          [
            'parties',
            `Dieser Liefervertrag wird geschlossen zwischen ${OWN_COMPANY} und Fiktivwerk Pumpen GmbH, Pumpenallee 3, 00000 Beispielhafen.`,
          ],
          `Die Fiktivwerk Pumpen GmbH ist Lieferantin, die ${OWN_COMPANY} ist Käuferin.`,
        ],
      },
      {
        title: 'Liefergegenstand',
        clauses: [
          'Die Lieferantin liefert zwölf Tauchpumpen mit Steuerung für das Projekt Industrieanlage Beispielhafen.',
          'Die technischen Daten der Pumpen ergeben sich aus dem Datenblatt der Anlage 1.',
          'Die Lieferung erfolgt in zwei Teilmengen zu je sechs Pumpen frei Baustelle.',
          'Die Käuferin prüft jede Teilmenge bei Wareneingang anhand der Checkliste Pumpenpass.',
        ],
      },
      {
        title: 'Preis und Zahlung',
        clauses: [
          [
            'value',
            'Der Gesamtpreis für alle zwölf Pumpen beträgt 186.000,00 € netto zuzüglich der gesetzlichen Umsatzsteuer.',
          ],
          'Die Zahlung erfolgt je Teilmenge innerhalb von 30 Tagen nach Wareneingang und Rechnungsstellung.',
          'Bis zur vollständigen Zahlung bleibt die gelieferte Ware Eigentum der Lieferantin.',
        ],
      },
      {
        title: 'Laufzeit und Kündigung',
        clauses: [
          ['term', 'Der Liefervertrag gilt bis zum 31.12.2027.'],
          [
            'noticePeriod',
            'Jede Partei kann den Vertrag mit einer Kündigungsfrist von 30 Tagen zum Monatsende schriftlich kündigen.',
          ],
          [
            'renewal',
            'Die Käuferin hat bis zum 30.09.2027 das Recht zur einmaligen Verlängerung um 12 Monate durch schriftliche Erklärung.',
          ],
        ],
      },
      {
        title: 'Gewährleistung',
        clauses: [
          'Die Gewährleistungsfrist für die Pumpen beträgt 24 Monate ab Lieferung der jeweiligen Teilmenge.',
          'Die Lieferantin behebt Mängel nach Wahl der Käuferin durch Nachbesserung oder Ersatzlieferung.',
          'Schlägt die Nacherfüllung nach zwei Versuchen fehl, kann die Käuferin den Preis mindern oder vom Vertrag zurücktreten.',
        ],
      },
      ...closingSections,
    ],
  },
  {
    pdf: 'subunternehmervertrag-tiefbau.pdf',
    title: 'Subunternehmervertrag Erdarbeiten Nordhafen',
    values: {
      parties: `${OWN_COMPANY} und Tiefbau Beispiel GmbH`,
      term: 'Der Vertrag ist befristet und gilt bis zur Abnahme des Bauabschnitts Nordhafen',
      noticePeriod: 'Kündigungsfrist von 14 Tagen',
      value: '94.500,00 € netto pauschal',
      renewal: null,
    },
    sections: [
      {
        title: 'Vertragsparteien',
        clauses: [
          [
            'parties',
            `Dieser Vertrag wird geschlossen zwischen ${OWN_COMPANY} und Tiefbau Beispiel GmbH, Grubenweg 5, 00000 Beispielstadt.`,
          ],
          `Die ${OWN_COMPANY} ist Auftraggeberin, die Tiefbau Beispiel GmbH ist Auftragnehmerin.`,
        ],
      },
      {
        title: 'Leistungen',
        clauses: [
          'Die Auftragnehmerin führt für die Kläranlage Nordhafen den Aushub, den Verbau der Baugruben und die Herstellung der Rohrgräben aus.',
          'Der Leistungsumfang ergibt sich aus dem Leistungsverzeichnis der Anlage 1 und den Plänen der Auftraggeberin.',
          'Die Auftragnehmerin stimmt die Arbeiten im wöchentlichen Baustellentermin mit der Bauleitung ab.',
          'Weitere Aufträge werden einzeln und schriftlich vergeben. Aus diesem Vertrag ergibt sich kein Anspruch auf weitere Aufträge.',
        ],
      },
      {
        title: 'Vergütung',
        clauses: [
          [
            'value',
            'Die Vergütung beträgt 94.500,00 € netto pauschal zuzüglich der gesetzlichen Umsatzsteuer.',
          ],
          'Die Abrechnung erfolgt nach Baufortschritt. Abschlagszahlungen werden innerhalb von 21 Tagen nach Rechnungseingang geleistet.',
          'Mehrmengen werden nur vergütet, wenn die Auftraggeberin sie vor der Ausführung schriftlich beauftragt hat.',
        ],
      },
      {
        title: 'Dauer und Kündigung',
        clauses: [
          [
            'term',
            'Der Vertrag ist befristet und gilt bis zur Abnahme des Bauabschnitts Nordhafen.',
          ],
          'Mit der Abnahme endet der Vertrag, ohne dass es einer Kündigung bedarf.',
          [
            'noticePeriod',
            'Die ordentliche Kündigung ist ausgeschlossen. Jede Partei kann den Vertrag aus wichtigem Grund mit einer Kündigungsfrist von 14 Tagen schriftlich kündigen.',
          ],
        ],
      },
      {
        title: 'Sicherheit und Gewährleistung',
        clauses: [
          'Die Auftragnehmerin beachtet die Unfallverhütungsvorschriften und weist ihr Personal vor Arbeitsbeginn in die Baustellenordnung ein.',
          'Die Gewährleistungsfrist beträgt vier Jahre ab Abnahme der Leistungen.',
          'Die Auftragnehmerin unterhält während der Bauzeit eine Betriebshaftpflichtversicherung mit einer Deckungssumme von mindestens drei Millionen Euro.',
        ],
      },
      ...closingSections,
    ],
  },
  {
    pdf: 'softwarelizenzvertrag-planungssoftware.pdf',
    title: 'Softwarelizenzvertrag Planungssoftware',
    values: {
      parties: `Planwerk Software GmbH und ${OWN_COMPANY}`,
      term: 'Die Lizenz wird für die Dauer von 12 Monaten ab dem 01.01.2026 erteilt',
      noticePeriod:
        'Kündigungsfrist von drei Monaten zum Ablauf der Lizenzdauer',
      value: '18.400,00 € netto pro Jahr',
      renewal: 'verlängert sich die Lizenz automatisch um 12 Monate',
    },
    sections: [
      {
        title: 'Vertragsparteien',
        clauses: [
          [
            'parties',
            `Dieser Lizenzvertrag wird geschlossen zwischen Planwerk Software GmbH und ${OWN_COMPANY}, vertreten durch die IT.`,
          ],
          `Die Planwerk Software GmbH ist Anbieterin, die ${OWN_COMPANY} ist Lizenznehmerin.`,
        ],
      },
      {
        title: 'Lizenzumfang',
        clauses: [
          'Die Anbieterin räumt der Lizenznehmerin ein nicht ausschließliches Recht zur Nutzung der Planungssoftware für zehn Arbeitsplatzlizenzen ein.',
          'Die Verwaltung der Lizenzen erfolgt über einen Lizenzserver im Netz der Lizenznehmerin.',
          'Eine Unterlizenzierung oder Weitergabe der Software an Dritte ist ausgeschlossen.',
        ],
      },
      {
        title: 'Lizenzgebühr',
        clauses: [
          [
            'value',
            'Die Lizenzgebühr beträgt 18.400,00 € netto pro Jahr zuzüglich der gesetzlichen Umsatzsteuer.',
          ],
          'Die Gebühr wird jährlich im Voraus in Rechnung gestellt und ist innerhalb von 30 Tagen zu zahlen.',
          'Zusätzliche Arbeitsplatzlizenzen kann die Lizenznehmerin jederzeit zum anteiligen Jahrespreis nachbestellen.',
        ],
      },
      {
        title: 'Laufzeit und Kündigung',
        clauses: [
          [
            'term',
            'Die Lizenz wird für die Dauer von 12 Monaten ab dem 01.01.2026 erteilt.',
          ],
          [
            'noticePeriod',
            'Jede Partei kann den Vertrag mit einer Kündigungsfrist von drei Monaten zum Ablauf der Lizenzdauer schriftlich kündigen.',
          ],
          [
            'renewal',
            'Ohne fristgerechte Kündigung verlängert sich die Lizenz automatisch um 12 Monate.',
          ],
        ],
      },
      {
        title: 'Support und Updates',
        clauses: [
          'Die Anbieterin stellt während der Lizenzdauer alle Updates und Fehlerkorrekturen der Software bereit.',
          'Der Support ist werktags von 08:00 bis 17:00 Uhr per E-Mail und Telefon erreichbar.',
          'Kritische Fehler bearbeitet die Anbieterin vorrangig und meldet sich innerhalb von vier Stunden mit einer ersten Einschätzung.',
        ],
      },
      ...closingSections,
    ],
  },
  {
    pdf: 'beratervertrag-unternehmensentwicklung.pdf',
    title: 'Beratervertrag Unternehmensentwicklung',
    values: {
      parties: `${OWN_COMPANY} und Kompass Beratung Muster GmbH`,
      term: 'Der Beratervertrag läuft bis zum 31.12.2027',
      noticePeriod: 'Kündigungsfrist von 30 Tagen zum Monatsende',
      value: 'Tagessatz von 1.450,00 € netto',
      renewal: 'Eine Verlängerung um sechs Monate ist nur schriftlich möglich',
    },
    sections: [
      {
        title: 'Vertragsparteien',
        clauses: [
          [
            'parties',
            `Dieser Beratervertrag wird geschlossen zwischen ${OWN_COMPANY} und Kompass Beratung Muster GmbH, Lotsenstraße 7, 00000 Beispielstadt.`,
          ],
          `Die ${OWN_COMPANY} handelt als Auftraggeberin, die Kompass Beratung Muster GmbH als Beraterin.`,
        ],
      },
      {
        title: 'Beratungsleistung',
        clauses: [
          'Die Beraterin begleitet die Geschäftsführung bei der Umstrukturierung der Organisation und bei der Entwicklung der Strategie.',
          'Die Beraterin arbeitet weisungsfrei und bestimmt Ort und Zeit ihrer Tätigkeit selbst, soweit Termine mit der Geschäftsführung nichts anderes erfordern.',
          'Ergebnisse legt die Beraterin der Geschäftsführung in Textform vor.',
        ],
      },
      {
        title: 'Honorar',
        clauses: [
          [
            'value',
            'Das Honorar wird nach einem Tagessatz von 1.450,00 € netto je geleistetem Beratertag abgerechnet.',
          ],
          'Die Beraterin rechnet höchstens 80 Beratertage ab. Darüber hinausgehende Tage bedürfen der vorherigen schriftlichen Zustimmung.',
          'Reisekosten werden nach den Richtlinien der Auftraggeberin gegen Nachweis erstattet.',
        ],
      },
      {
        title: 'Laufzeit und Kündigung',
        clauses: [
          ['term', 'Der Beratervertrag läuft bis zum 31.12.2027.'],
          [
            'noticePeriod',
            'Jede Partei kann den Vertrag mit einer Kündigungsfrist von 30 Tagen zum Monatsende schriftlich kündigen.',
          ],
          [
            'renewal',
            'Eine Verlängerung um sechs Monate ist nur schriftlich möglich und bedarf der Unterschrift beider Parteien.',
          ],
        ],
      },
      {
        title: 'Geheimhaltung der Mandatsinhalte',
        clauses: [
          'Der Inhalt des Mandats ist streng vertraulich und nur der Geschäftsführung der Auftraggeberin zugänglich.',
          'Die Beraterin gibt Unterlagen zum Mandat nur an Personen weiter, die die Geschäftsführung ausdrücklich benannt hat.',
        ],
      },
      ...closingSections,
      {
        title: 'Ablage',
        clauses: [GF_CANARY_CLAUSE],
      },
    ],
  },
];

export const SCANNED_CONTRACT: ContractData = {
  pdf: 'wartungsvertrag-serverraum-scan.pdf',
  title: 'Wartungsvertrag Serverraum',
  values: {
    parties: `${OWN_COMPANY} und Serviceprofi Beispiel GmbH`,
    term: 'Die Vertragslaufzeit beträgt 36 Monate ab dem 01.02.2025',
    noticePeriod: 'Kündigungsfrist von sechs Monaten',
    value: '3.600,00 € netto pro Jahr',
    renewal: 'verlängert sich der Vertrag um jeweils 12 Monate',
  },
  sections: [
    {
      title: 'Vertragsparteien',
      clauses: [
        [
          'parties',
          `Dieser Wartungsvertrag wird geschlossen zwischen ${OWN_COMPANY} und Serviceprofi Beispiel GmbH.`,
        ],
      ],
    },
    {
      title: 'Leistungen',
      clauses: [
        'Der Dienstleister prüft vierteljährlich die Klimaanlage, die Notstromversorgung und die Brandmeldeanlage des Serverraums.',
        'Jede Prüfung wird im Prüfbuch dokumentiert.',
      ],
    },
    {
      title: 'Vergütung',
      clauses: [
        [
          'value',
          'Die Vergütung beträgt 3.600,00 € netto pro Jahr zuzüglich der gesetzlichen Umsatzsteuer.',
        ],
      ],
    },
    {
      title: 'Laufzeit und Kündigung',
      clauses: [
        ['term', 'Die Vertragslaufzeit beträgt 36 Monate ab dem 01.02.2025.'],
        [
          'noticePeriod',
          'Jede Partei kann den Vertrag mit einer Kündigungsfrist von sechs Monaten schriftlich kündigen.',
        ],
        [
          'renewal',
          'Ohne Kündigung verlängert sich der Vertrag um jeweils 12 Monate.',
        ],
      ],
    },
  ],
};

export const MINUTES: MinutesData[] = [
  {
    pdf: 'besprechungsprotokoll-nordhafen-kickoff.pdf',
    title: 'Protokoll Kickoff Kläranlage Nordhafen',
    date: '03.03.2026',
    participants: [
      'Sabine Kettler (Projektleitung)',
      'Jörg Ostmoor (Geschäftsführung)',
      'Bauleitung des Auftraggebers',
    ],
    agenda: [
      'TOP 1: Projektziele und Terminrahmen',
      'TOP 2: Baustellenorganisation und Zufahrt',
      'TOP 3: Meldeweg für Änderungen',
    ],
    decisions: [
      'Beschluss 1: Der Baubeginn ist in Kalenderwoche 14.',
      'Beschluss 2: Der Baustellentermin findet wöchentlich dienstags statt.',
      'Beschluss 3: Änderungen werden über die Projektleitung gemeldet.',
      'Offen: Die Zufahrt über das Gelände Möwenkai wird bis zum nächsten Termin geklärt.',
    ],
  },
  {
    pdf: 'besprechungsprotokoll-nordhafen-bauabnahme.pdf',
    title: 'Protokoll Bauabnahme Kläranlage Nordhafen',
    date: '15.09.2026',
    participants: [
      'Sabine Kettler (Projektleitung)',
      'Bauleitung des Auftraggebers',
      'Vertreter der Tiefbau Beispiel GmbH',
    ],
    agenda: [
      'TOP 1: Begehung der Becken und der Maschinentechnik',
      'TOP 2: Feststellung der Mängel',
      'TOP 3: Termin für den Probebetrieb',
    ],
    decisions: [
      'Beschluss 1: Die Abnahme der Becken und der Maschinentechnik ist erfolgt.',
      'Beschluss 2: Es wurden sieben kleinere Mängel festgehalten.',
      'Beschluss 3: Die Bauleitung beseitigt die Mängel bis Ende des Quartals, die Projektleitung kontrolliert.',
      'Beschluss 4: Der Probebetrieb beginnt nach der Mängelbeseitigung.',
    ],
  },
];
