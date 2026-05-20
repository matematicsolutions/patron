// Patron - polski slownik UI.
//
// Architektura:
// - Patron = jedna kancelaria = jeden jezyk -> bez next-intl middleware,
//   bez locale w URL. Domyslnie PL, opcjonalnie EN (klucze fallback).
// - Klucze pogrupowane semantycznie (chat / docs / account / nav / common).
// - Format dat DD.MM.RRRR realizowany przez `formatDate` helper, nie w
//   slowniku.
//
// Uzycie:
//   import { t } from "@/i18n";
//   <button>{t("chat.send")}</button>

export const pl = {
    // ---------------------------------------------------------------------
    // Common (przyciski, etykiety wspolne)
    // ---------------------------------------------------------------------
    common: {
        loading: "Ładowanie…",
        save: "Zapisz",
        cancel: "Anuluj",
        delete: "Usuń",
        edit: "Edytuj",
        close: "Zamknij",
        confirm: "Potwierdź",
        back: "Wstecz",
        next: "Dalej",
        accept: "Akceptuj",
        reject: "Odrzuć",
        copy: "Kopiuj",
        copied: "Skopiowano",
        download: "Pobierz",
        share: "Udostępnij",
        search: "Szukaj",
        more: "Więcej",
        less: "Mniej",
        new: "Nowy",
        open: "Otwórz",
        rename: "Zmień nazwę",
        retry: "Spróbuj ponownie",
        error: "Błąd",
        warning: "Uwaga",
        success: "Sukces",
        unknown: "Nieznane",
        none: "Brak",
        yes: "Tak",
        no: "Nie",
        all: "Wszystko",
        clear: "Wyczyść",
        refresh: "Odśwież",
        settings: "Ustawienia",
        signOut: "Wyloguj",
        signIn: "Zaloguj",
        signUp: "Zarejestruj",
    },

    // ---------------------------------------------------------------------
    // Navigation / sidebar
    // ---------------------------------------------------------------------
    nav: {
        assistant: "Asystent",
        assistantHistory: "Historia czatów",
        chats: "Czaty",
        projects: "Projekty",
        documents: "Dokumenty",
        workflows: "Workflowy",
        tabularReviews: "Przeglądy tabelaryczne",
        account: "Konto",
        profile: "Profil",
        modelsAndKeys: "Modele i klucze API",
        support: "Wsparcie",
        openSidebar: "Otwórz menu boczne",
        closeSidebar: "Zamknij menu boczne",
        newChat: "Nowy czat",
        newProject: "Nowy projekt",
        newReview: "Nowy przegląd",
    },

    // ---------------------------------------------------------------------
    // Chat
    // ---------------------------------------------------------------------
    chat: {
        title: "Czat z Patronem",
        placeholder: "Zapytaj Patrona…",
        send: "Wyślij",
        attach: "Załącz plik",
        stop: "Zatrzymaj",
        thinking: "Myślę…",
        loadingCitations: "Pobieram cytaty…",
        streamError: "Błąd strumienia. Odśwież stronę.",
        modelMissing: "Brak skonfigurowanego modelu LLM.",
        modelMissingAction: "Przejdź do Konto → Modele i klucze API",
        emptyState: "Zacznij od pytania. Możesz załączyć .docx lub .pdf.",
        renameTitle: "Zmień tytuł czatu",
        deleteChat: "Usuń czat",
        deleteChatConfirm:
            "Usunąć ten czat? Treść zostanie skasowana, ale ślad w audit log zostaje (compliance).",
        sorryError: "Przepraszamy, wystąpił błąd.",
        // Tool call activity labels (podczas streamingu narzedzi)
        toolCreatingDocument: "Tworzę dokument…",
        toolEditingDocument: "Edytuję dokument…",
        toolReadingDocument: "Czytam dokument…",
        toolReadingDocuments: "Czytam dokumenty…",
        toolSearchingDocument: "Przeszukuję dokument…",
        toolReplicatingDocument: "Kopiuję dokument…",
        toolReadingWorkflow: "Wczytuję workflow…",
        toolListingWorkflows: "Wczytuję listę workflowów…",
        toolListingDocuments: "Wczytuję listę dokumentów…",
        toolRunning: "Uruchamiam:",
        toolWorking: "Pracuję…",
        // Doc activity past/present
        reading: "Czytam",
        readActivity: "Przeczytano",
        creating: "Tworzę",
        createdActivity: "Utworzono",
        editing: "Edytuję",
        editedActivity: "Zedytowano",
        appliedWorkflow: "Zastosowany workflow",
    },

    // ---------------------------------------------------------------------
    // Documents
    // ---------------------------------------------------------------------
    docs: {
        upload: "Wczytaj dokument",
        uploadHint: "Upuść pliki PDF lub DOCX tutaj",
        addDocuments: "Dodaj dokumenty",
        removeDocument: "Usuń dokument",
        documentNotFound: "Dokument nie znaleziony",
        readDocument: "Czytaj dokument",
        editDocument: "Edytuj dokument",
        generateDocx: "Generuj .docx",
        downloadDocx: "Pobierz .docx",
        currentVersion: "Aktualna wersja",
        versionHistory: "Historia wersji",
        files: "Pliki",
        attached: "Załączone",
        attachment: "Załącznik",
        attachments: "Załączniki",
    },

    // ---------------------------------------------------------------------
    // Citations (panel cytatow)
    // ---------------------------------------------------------------------
    citations: {
        title: "Cytaty",
        documentCitations: "Cytaty z dokumentów",
        sources: "Źródła",
        relatedSources: "Powiązane źródła",
        page: "Strona",
        pages: "Strony",
        openSource: "Otwórz źródło",
        noCitations: "Brak cytatów dla tej odpowiedzi.",
        // MCP server labels - odpowiadaja `mcpServerLabel` z AssistantMessage.tsx
        saos: "Orzeczenia z SAOS (sądy powszechne, SN, TK, KIO)",
        nsa: "Orzeczenia z CBOSA (NSA / WSA — sądy administracyjne)",
        isap: "Akty prawa polskiego (Dz.U. / M.P. — Sejm ELI)",
        krs: "Krajowy Rejestr Sądowy (KRS — MS)",
        euSparql: "Akty prawa UE (EUR-Lex / CJEU)",
    },

    // ---------------------------------------------------------------------
    // Account / settings
    // ---------------------------------------------------------------------
    account: {
        title: "Konto",
        profile: "Profil",
        email: "Email",
        models: "Modele i klucze API",
        provider: "Dostawca",
        apiKey: "Klucz API",
        apiKeyMissing: "Brakuje klucza API dla tego modelu.",
        apiKeyRequired: "Klucz API wymagany",
        apiKeyMissingBodyPrefix: "Nie dodałeś jeszcze klucza API dostawcy",
        apiKeyMissingBodySuffix:
            ". Dodaj go w ustawieniach konta, aby użyć tego modelu.",
        apiKeyThisProvider: "tego dostawcy",
        goToAccount: "Przejdź do ustawień konta",
        configuredByAdmin: "Skonfigurowane przez administratora",
        addKey: "Dodaj klucz",
        removeKey: "Usuń klucz",
        keyEncrypted: "Klucz jest szyfrowany przed zapisem.",
    },

    // ---------------------------------------------------------------------
    // Login / signup
    // ---------------------------------------------------------------------
    auth: {
        signInTitle: "Zaloguj się do Patrona",
        signUpTitle: "Załóż konto w Patronie",
        createAccount: "Załóż konto",
        accountCreated: "Konto utworzone",
        redirectingHome: "Przekierowujemy Cię do strony głównej…",
        emailLabel: "Email",
        emailPlaceholder: "imie@kancelaria.pl",
        passwordLabel: "Hasło",
        passwordPlaceholder: "Twoje hasło",
        passwordPlaceholderCreate: "Stwórz hasło (min. 6 znaków)",
        confirmPasswordLabel: "Powtórz hasło",
        confirmPasswordPlaceholder: "Wpisz hasło ponownie",
        nameLabel: "Imię",
        nameOptional: "(opcjonalnie)",
        namePlaceholder: "Twoje imię",
        organisationLabel: "Kancelaria / organizacja",
        organisationPlaceholder: "Nazwa kancelarii",
        signInButton: "Zaloguj się",
        signUpButton: "Zarejestruj się",
        haveAccount: "Masz już konto?",
        noAccount: "Nie masz konta?",
        signInLink: "Zaloguj się",
        signUpLink: "Zarejestruj się",
        emailConfirmation:
            "Sprawdź skrzynkę pocztową. Wysłaliśmy link potwierdzający.",
        signInError: "Logowanie nie powiodło się.",
        signUpError: "Rejestracja nie powiodła się.",
        passwordsDoNotMatch: "Hasła nie są zgodne",
        passwordTooShort: "Hasło musi mieć co najmniej 6 znaków",
        rodoNote:
            "Patron pracuje na infrastrukturze Twojej kancelarii. Dokumenty klientów przetwarzane są lokalnie zgodnie z RODO. Tajemnica zawodowa pozostaje chroniona.",
    },

    // ---------------------------------------------------------------------
    // Projects
    // ---------------------------------------------------------------------
    projects: {
        title: "Projekty",
        newProject: "Nowy projekt",
        newProjectPlaceholder: 'Nazwa projektu (np. „Klient X / sprawa Y")',
        projectNotFound: "Projekt nie znaleziony",
        practiceArea: "Obszar prawa",
        practice: "Obszar",
        cmNumber: "Numer sprawy",
        cmNumberPlaceholder: "Dodaj numer sprawy…",
        peopleWithAccess: "Osoby z dostępem",
        people: "Osoby",
        openProjects: "Otwórz projekty",
        addByEmail: "Dodaj przez email…",
        allowEditingByShareRecipients:
            "Pozwól osobom z dostępem edytować",
        dismissWarning: "Zamknij ostrzeżenie",
    },

    // ---------------------------------------------------------------------
    // Workflows
    // ---------------------------------------------------------------------
    workflows: {
        title: "Workflowy",
        addWorkflow: "Dodaj workflow",
        appliedWorkflow: "Zastosowany workflow",
        browseAll: "Przeglądaj wszystkie",
        openWorkflows: "Otwórz workflowy",
        openWorkflowPeople: "Otwórz osoby workflow",
        addColleaguesByEmail: "Dodaj współpracowników przez email…",
        addPeopleByEmail: "Dodaj osoby przez email…",
        addTag: "Dodaj tag…",
    },

    // ---------------------------------------------------------------------
    // Tabular review (przeglad tabelaryczny)
    // ---------------------------------------------------------------------
    tabular: {
        title: "Przegląd tabelaryczny",
        columns: "Kolumny",
        columnTitle: "Tytuł kolumny",
        editColumn: "Edytuj kolumnę",
        format: "Format",
        created: "Utworzono",
    },
} as const;

// English fallback - tylko klucze, ktore moga nie miec tlumaczenia PL.
// Domyslnie wszystkie sa po polsku - en jest awaryjny.
export const en = {
    common: {
        loading: "Loading…",
        save: "Save",
        cancel: "Cancel",
    },
    // ... (rozszerzymy gdy pojawi sie potrzeba EN-only flow)
} as const;
