/**
 * Labels for the export flow. One entry per supported target language;
 * the user picks one in the export tab and the book is translated to
 * that language at export time, with the labels here used by the
 * PDF / markdown / EPUB / DOCX builders.
 *
 * The UI itself stays English — only the *output* file is translated.
 * The source book is always English (the orchestrator prompts in
 * English), so the dropdown default is 'en' and the export skips the
 * LLM translation pass when the user keeps the default.
 *
 * Adding a new language is a pure-data change: add the code to the
 * `ExportLanguage` union, add an entry below, and the export component
 * will pick it up automatically.
 */

export type ExportLanguage = 'en' | 'pl' | 'es' | 'fr' | 'de' | 'it' | 'pt' | 'nl' | 'ru' | 'uk' | 'cs';

export interface ExportLanguageMeta {
  /** ISO 639-1 code. */
  code: ExportLanguage;
  /** English name of the language, shown in the dropdown. */
  englishName: string;
  /** Native name of the language, shown next to the English name. */
  nativeName: string;
}

export const EXPORT_LANGUAGES: ExportLanguageMeta[] = [
  { code: 'en', englishName: 'English',     nativeName: 'English'     },
  { code: 'pl', englishName: 'Polish',      nativeName: 'Polski'      },
  { code: 'es', englishName: 'Spanish',     nativeName: 'Español'     },
  { code: 'fr', englishName: 'French',      nativeName: 'Français'    },
  { code: 'de', englishName: 'German',      nativeName: 'Deutsch'     },
  { code: 'it', englishName: 'Italian',     nativeName: 'Italiano'    },
  { code: 'pt', englishName: 'Portuguese',  nativeName: 'Português'   },
  { code: 'nl', englishName: 'Dutch',       nativeName: 'Nederlands'  },
  { code: 'ru', englishName: 'Russian',     nativeName: 'Русский'     },
  { code: 'uk', englishName: 'Ukrainian',   nativeName: 'Українська'  },
  { code: 'cs', englishName: 'Czech',       nativeName: 'Čeština'     }
];

/** Human-readable name used in the LLM system prompt for translations. */
export const LANGUAGE_DISPLAY_NAME: Record<ExportLanguage, string> = {
  en: 'English',
  pl: 'Polish',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  nl: 'Dutch',
  ru: 'Russian',
  uk: 'Ukrainian',
  cs: 'Czech'
};

/**
 * Labels injected into the exported file for the chosen target
 * language. Every builder (PDF, markdown, EPUB, DOCX) reads from this
 * so they all stay in sync.
 */
export interface ExportLabels {
  /** Front-cover / title-page byline for the AI author. */
  bookAuthor: string;
  /** "a novel" / "powieść" / "un roman" tag on the front cover. */
  aBookLabel: string;
  /** Heading for the table of contents. */
  tocLabel: string;
  /** "Chapter" / "Rozdział" / "Chapitre" label. */
  chapterLabel: string;
  /** Fallback for an empty book title (e.g. "Untitled"). */
  untitledFallback: string;
  /** Status string shown in the UI when the user clicks Stop. */
  stopping: string;
  /** Short status string shown while the export is translating the book. */
  translating: string;
  /** Back-cover section heading. */
  backCoverHead: string;
  /** Back-cover subject sentence (the AI author description). */
  backCoverSubject: string;
  /** Connector between subject and theme list. */
  backCoverVerb: string;
  /** Fallback theme fragment when the book config has no themes. */
  backCoverUnknownTheme: string;
  /** Fallback protagonist name when the config has no protagonist name. */
  backCoverUnknownProtagonist: string;
  /** Fallback book title used in the back-cover blurb when none is set. */
  backCoverUnknownTitle: string;
  /**
   * Back-cover blurb template. The renderer substitutes
   * `{title}`, `{protagonist}`, and `{themePart}` for the book's
   * actual values, so a single template per language covers every
   * book. The template ends with a period; the renderer only adds
   * a trailing ellipsis if the resulting string exceeds the cap.
   */
  backCoverBlurbTemplate: string;
  /**
   * ISBN placeholder on the back cover. Most languages use the same
   * "ISBN 000-0-00-000000-0" string, but it's here in case a
   * localisation team wants to localise the label itself.
   */
  isbnPlaceholder: string;
  /**
   * Theme-list separator. Latin/Cyrillic scripts use ", "; some
   * scripts prefer a different list punctuation.
   */
  themeSeparator: string;
}

const DEFAULT_ISBN = 'ISBN 000-0-00-000000-0';
const DEFAULT_THEME_SEPARATOR = ', ';

const ENGLISH_LABELS: ExportLabels = {
  bookAuthor: 'Written by artificial intelligence',
  aBookLabel: 'a novel',
  tocLabel: 'Table of Contents',
  chapterLabel: 'Chapter',
  untitledFallback: 'Untitled',
  stopping: 'Stopping...',
  translating: 'Translating...',
  backCoverHead: 'About the author',
  backCoverSubject: 'AutoBook, an AI-powered storytelling assistant',
  backCoverVerb: ' exploring themes such as',
  backCoverUnknownTheme: 'mystery',
  backCoverUnknownProtagonist: 'A protagonist',
  backCoverUnknownTitle: 'This book',
  backCoverBlurbTemplate: '"{title}" is a story about {protagonist}, where {themePart} collide with unexpected turns. A page-turner that stays with you.',
  isbnPlaceholder: DEFAULT_ISBN,
  themeSeparator: DEFAULT_THEME_SEPARATOR
};

const POLISH_LABELS: ExportLabels = {
  bookAuthor: 'Napisała sztuczna inteligencja',
  aBookLabel: 'powieść',
  tocLabel: 'Spis treści',
  chapterLabel: 'Rozdział',
  untitledFallback: 'Bez tytułu',
  stopping: 'Zatrzymywanie...',
  translating: 'Tłumaczenie...',
  backCoverHead: 'O autorze',
  backCoverSubject: 'AutoBook — asystent do opowiadania historii napędzany sztuczną inteligencją',
  backCoverVerb: ' eksplorujący tematy takie jak',
  backCoverUnknownTheme: 'tajemnicą',
  backCoverUnknownProtagonist: 'Bohater',
  backCoverUnknownTitle: 'Ta książka',
  backCoverBlurbTemplate: '„{title}" to opowieść o {protagonist}, w której {themePart} łączą się z niespodziewanymi zwrotami akcji. Pełna napięcia historia, która zostaje w pamięci.',
  isbnPlaceholder: DEFAULT_ISBN,
  themeSeparator: DEFAULT_THEME_SEPARATOR
};

const SPANISH_LABELS: ExportLabels = {
  bookAuthor: 'Escrito por inteligencia artificial',
  aBookLabel: 'una novela',
  tocLabel: 'Índice',
  chapterLabel: 'Capítulo',
  untitledFallback: 'Sin título',
  stopping: 'Deteniendo...',
  translating: 'Traduciendo...',
  backCoverHead: 'Sobre el autor',
  backCoverSubject: 'AutoBook, un asistente de narración impulsado por inteligencia artificial',
  backCoverVerb: ' que explora temas como',
  backCoverUnknownTheme: 'el misterio',
  backCoverUnknownProtagonist: 'Un protagonista',
  backCoverUnknownTitle: 'Este libro',
  backCoverBlurbTemplate: '«{title}» es una historia sobre {protagonist}, en la que {themePart} se entrelazan con giros inesperados. Una lectura que permanece en la memoria.',
  isbnPlaceholder: DEFAULT_ISBN,
  themeSeparator: DEFAULT_THEME_SEPARATOR
};

const FRENCH_LABELS: ExportLabels = {
  bookAuthor: 'Écrit par une intelligence artificielle',
  aBookLabel: 'un roman',
  tocLabel: 'Table des matières',
  chapterLabel: 'Chapitre',
  untitledFallback: 'Sans titre',
  stopping: 'Arrêt...',
  translating: 'Traduction...',
  backCoverHead: 'À propos de l’auteur',
  backCoverSubject: 'AutoBook, un assistant de narration alimenté par l’intelligence artificielle',
  backCoverVerb: ' explorant des thèmes tels que',
  backCoverUnknownTheme: 'le mystère',
  backCoverUnknownProtagonist: 'Un protagoniste',
  backCoverUnknownTitle: 'Ce livre',
  backCoverBlurbTemplate: '« {title} » est une histoire sur {protagonist}, dans laquelle {themePart} se mêlent à des rebondissements inattendus. Un page-turner qui reste avec vous.',
  isbnPlaceholder: DEFAULT_ISBN,
  themeSeparator: DEFAULT_THEME_SEPARATOR
};

const GERMAN_LABELS: ExportLabels = {
  bookAuthor: 'Geschrieben von künstlicher Intelligenz',
  aBookLabel: 'ein Roman',
  tocLabel: 'Inhaltsverzeichnis',
  chapterLabel: 'Kapitel',
  untitledFallback: 'Ohne Titel',
  stopping: 'Wird gestoppt...',
  translating: 'Übersetzung...',
  backCoverHead: 'Über den Autor',
  backCoverSubject: 'AutoBook, ein KI-gestützter Geschichtenerzähler',
  backCoverVerb: ' der Themen wie',
  backCoverUnknownTheme: 'Geheimnisse',
  backCoverUnknownProtagonist: 'Eine Protagonistin',
  backCoverUnknownTitle: 'Dieses Buch',
  backCoverBlurbTemplate: '„{title}" ist eine Geschichte über {protagonist}, in der {themePart} auf unerwartete Wendungen treffen. Ein Pageturner, der in Erinnerung bleibt.',
  isbnPlaceholder: DEFAULT_ISBN,
  themeSeparator: DEFAULT_THEME_SEPARATOR
};

const ITALIAN_LABELS: ExportLabels = {
  bookAuthor: 'Scritto da un’intelligenza artificiale',
  aBookLabel: 'un romanzo',
  tocLabel: 'Indice',
  chapterLabel: 'Capitolo',
  untitledFallback: 'Senza titolo',
  stopping: 'Arresto...',
  translating: 'Traduzione...',
  backCoverHead: 'Sull’autore',
  backCoverSubject: 'AutoBook, un assistente per la narrazione alimentato dall’intelligenza artificiale',
  backCoverVerb: ' che esplora temi come',
  backCoverUnknownTheme: 'il mistero',
  backCoverUnknownProtagonist: 'Una protagonista',
  backCoverUnknownTitle: 'Questo libro',
  backCoverBlurbTemplate: '«{title}» è una storia su {protagonist}, in cui {themePart} si intrecciano con colpi di scena inaspettati. Una lettura che resta con te.',
  isbnPlaceholder: DEFAULT_ISBN,
  themeSeparator: DEFAULT_THEME_SEPARATOR
};

const PORTUGUESE_LABELS: ExportLabels = {
  bookAuthor: 'Escrito por inteligência artificial',
  aBookLabel: 'um romance',
  tocLabel: 'Sumário',
  chapterLabel: 'Capítulo',
  untitledFallback: 'Sem título',
  stopping: 'Parando...',
  translating: 'Traduzindo...',
  backCoverHead: 'Sobre o autor',
  backCoverSubject: 'AutoBook, um assistente de narrativa alimentado por inteligência artificial',
  backCoverVerb: ' explorando temas como',
  backCoverUnknownTheme: 'o mistério',
  backCoverUnknownProtagonist: 'Um protagonista',
  backCoverUnknownTitle: 'Este livro',
  backCoverBlurbTemplate: '«{title}» é uma história sobre {protagonist}, na qual {themePart} colidem com reviravoltas inesperadas. Uma leitura que fica com você.',
  isbnPlaceholder: DEFAULT_ISBN,
  themeSeparator: DEFAULT_THEME_SEPARATOR
};

const DUTCH_LABELS: ExportLabels = {
  bookAuthor: 'Geschreven door kunstmatige intelligentie',
  aBookLabel: 'een roman',
  tocLabel: 'Inhoudsopgave',
  chapterLabel: 'Hoofdstuk',
  untitledFallback: 'Zonder titel',
  stopping: 'Stoppen...',
  translating: 'Vertalen...',
  backCoverHead: 'Over de auteur',
  backCoverSubject: 'AutoBook, een door AI aangestuurde verhalenverteller',
  backCoverVerb: ' die thema’s verkent zoals',
  backCoverUnknownTheme: 'mysterie',
  backCoverUnknownProtagonist: 'Een protagonist',
  backCoverUnknownTitle: 'Dit boek',
  backCoverBlurbTemplate: '‘{title}’ is een verhaal over {protagonist}, waarin {themePart} samenkomen met onverwachte wendingen. Een pageturner die bij je blijft.',
  isbnPlaceholder: DEFAULT_ISBN,
  themeSeparator: DEFAULT_THEME_SEPARATOR
};

const RUSSIAN_LABELS: ExportLabels = {
  bookAuthor: 'Написано искусственным интеллектом',
  aBookLabel: 'роман',
  tocLabel: 'Содержание',
  chapterLabel: 'Глава',
  untitledFallback: 'Без названия',
  stopping: 'Остановка...',
  translating: 'Перевод...',
  backCoverHead: 'Об авторе',
  backCoverSubject: 'AutoBook — ассистент для создания историй на основе искусственного интеллекта',
  backCoverVerb: ' исследующий темы, такие как',
  backCoverUnknownTheme: 'тайна',
  backCoverUnknownProtagonist: 'Главный герой',
  backCoverUnknownTitle: 'Эта книга',
  backCoverBlurbTemplate: '«{title}» — это история о {protagonist}, в которой {themePart} переплетаются с неожиданными поворотами сюжета. Книга, которая остаётся в памяти.',
  isbnPlaceholder: 'ISBN 000-0-00-000000-0',
  themeSeparator: ', '
};

const UKRAINIAN_LABELS: ExportLabels = {
  bookAuthor: 'Написано штучним інтелектом',
  aBookLabel: 'роман',
  tocLabel: 'Зміст',
  chapterLabel: 'Розділ',
  untitledFallback: 'Без назви',
  stopping: 'Зупинка...',
  translating: 'Переклад...',
  backCoverHead: 'Про автора',
  backCoverSubject: 'AutoBook — асистент для створення історій на основі штучного інтелекту',
  backCoverVerb: ' що досліджує теми, такі як',
  backCoverUnknownTheme: 'таємниця',
  backCoverUnknownProtagonist: 'Головний герой',
  backCoverUnknownTitle: 'Ця книга',
  backCoverBlurbTemplate: '«{title}» — це історія про {protagonist}, у якій {themePart} переплітаються з несподіваними поворотами сюжету. Книга, що залишається в пам’яті.',
  isbnPlaceholder: 'ISBN 000-0-00-000000-0',
  themeSeparator: ', '
};

const CZECH_LABELS: ExportLabels = {
  bookAuthor: 'Napsáno umělou inteligencí',
  aBookLabel: 'román',
  tocLabel: 'Obsah',
  chapterLabel: 'Kapitola',
  untitledFallback: 'Bez názvu',
  stopping: 'Zastavování...',
  translating: 'Překlad...',
  backCoverHead: 'O autorovi',
  backCoverSubject: 'AutoBook, asistent pro vyprávění příběhů poháněný umělou inteligencí',
  backCoverVerb: ' zkoumající témata jako',
  backCoverUnknownTheme: 'tajemství',
  backCoverUnknownProtagonist: 'Hlavní hrdina',
  backCoverUnknownTitle: 'Tato kniha',
  backCoverBlurbTemplate: '„{title}" je příběh o {protagonist}, ve kterém se {themePart} prolínají s nečekanými zvraty. Kniha, která ve vás zůstane.',
  isbnPlaceholder: DEFAULT_ISBN,
  themeSeparator: DEFAULT_THEME_SEPARATOR
};

/** Lookup by language code. Falls back to English if a code is added without labels. */
const LABELS: Record<ExportLanguage, ExportLabels> = {
  en: ENGLISH_LABELS,
  pl: POLISH_LABELS,
  es: SPANISH_LABELS,
  fr: FRENCH_LABELS,
  de: GERMAN_LABELS,
  it: ITALIAN_LABELS,
  pt: PORTUGUESE_LABELS,
  nl: DUTCH_LABELS,
  ru: RUSSIAN_LABELS,
  uk: UKRAINIAN_LABELS,
  cs: CZECH_LABELS
};

export function getExportLabels(language: ExportLanguage): ExportLabels {
  return LABELS[language] ?? ENGLISH_LABELS;
}
