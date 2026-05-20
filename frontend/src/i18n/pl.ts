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
        closePanel: "Zamknij panel",
        noMatches: "Brak wyników",
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
        modelMissing: "Nie ustawiono modelu LLM.",
        modelMissingAction: "Przejdź do Konto → Modele i klucze API",
        emptyState: "Zacznij od pytania. Możesz załączyć .docx lub .pdf.",
        renameTitle: "Zmień tytuł czatu",
        deleteChat: "Usuń czat",
        deleteChatConfirm:
            "Usunąć ten czat? Treść zniknie, ale wpis w dzienniku audytu zostaje.",
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
        // Lista czatow w panelu - brak tytulu
        untitledChat: "Bez tytułu",
        // Greeting fallback (kiedy brak imienia w profilu)
        greetingFallback: "Pani / Panie Mecenasie",
        greetingPrefix: "Witaj",
        // Disclaimer pod polem wejscia (RODO + odpowiedzialnosc zawodowa)
        legalDisclaimer:
            "AI może się mylić. Odpowiedzi nie stanowią porady prawnej.",
        // Aria/title dla przyciskow dolnej belki ChatInput
        openWorkflows: "Otwórz workflowy",
        openProjects: "Otwórz projekty",
        addDocuments: "Dodaj dokumenty",
        // Breadcrumb pickera dokumentow
        breadcrumbAssistant: "Asystent",
        breadcrumbAddDocs: "Dodaj dokumenty",
        breadcrumbStartInProject: "Rozpocznij czat w projekcie",
        continue: "Kontynuuj",
        // Statusy wyboru modelu (ModelToggle)
        modelChoose: "Wybierz model",
        modelLabel: "Model",
        // Etykiety thinking / postep modelu (AssistantMessage)
        thinking1: "Myślę…",
        thinking2: "Rozważam…",
        thinking3: "Analizuję…",
        thinking4: "Przeglądam…",
        thinking5: "Rozumuję…",
        thoughtProcess: "Tok rozumowania",
        // Czytanie / wyszukiwanie / tworzenie / kopiowanie dokumentu
        // (aktywne vs zakonczone)
        readingActive: "Czytam",
        readingDone: "Przeczytano",
        findingActive: "Szukam",
        findingDone: "Znaleziono",
        creatingActive: "Tworzę",
        creatingDone: "Utworzono",
        replicatingActive: "Kopiuję",
        replicatingDone: "Skopiowano",
        editingActive: "Edytuję",
        editingDone: "Zedytowano",
        editingFailed: "Edycja nieudana",
        // Lista zmian sledzonych
        collapseEdits: "Zwiń zmiany",
        expandEdits: "Rozwiń zmiany",
        // Bulk accept / reject po stronie wiadomosci asystenta
        bulkAcceptFailed: "Nie udało się zapisać jednej lub kilku akceptacji.",
        bulkRejectFailed: "Nie udało się zapisać jednego lub kilku odrzuceń.",
        // Sekcja "Powiazane orzeczenia" pod proza wiadomosci
        relatedJudgments: "Powiązane orzeczenia",
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
        nsa: "Orzeczenia z CBOSA (NSA / WSA - sądy administracyjne)",
        isap: "Akty prawa polskiego (Dz.U. / M.P. - Sejm ELI)",
        krs: "Krajowy Rejestr Sądowy (KRS - MS)",
        euSparql: "Akty prawa UE (EUR-Lex / CJEU)",
        // Fallback dla nieznanego serwera MCP - `{server}` jest podstawiane
        // recznie w mcpServerLabel() (nie mamy w t() interpolacji).
        unknownServer: "Powiązane źródła",
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
        apiKeyMissingBodyPrefix: "Brak klucza API dostawcy",
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
            "Patron pracuje na infrastrukturze Twojej kancelarii. Dokumenty klientów przetwarzamy lokalnie zgodnie z RODO. Chronimy tajemnicę zawodową.",
    },

    // ---------------------------------------------------------------------
    // Projects
    // ---------------------------------------------------------------------
    projects: {
        title: "Projekty",
        newProject: "Nowy projekt",
        newProjectPlaceholder: "Nazwa projektu (np. „Klient X / sprawa Y”)",
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
            "Pozwól na edycję osobom z dostępem",
        dismissWarning: "Zamknij ostrzeżenie",
        // Lista projektow
        searchPlaceholder: "Szukaj projektów…",
        nameColumn: "Nazwa",
        filesColumn: "Pliki",
        chatsColumn: "Czaty",
        tabularReviewsColumn: "Przeglądy tabelaryczne",
        createdColumn: "Utworzono",
        cmShort: "Sygnatura",
        cmShortPlaceholder: "Sygn.",
        noProjects: "Brak projektów. Utwórz pierwszy.",
        // Eksplorator dokumentow projektu (foldery + pliki)
        folderNamePlaceholder: "Nazwa folderu",
        renameDocument: "Zmień nazwę dokumentu",
        renameFolder: "Zmień nazwę folderu",
        deleteFolder: "Usuń folder",
        newSubfolder: "Nowy podfolder",
        newSubfolderInside: "Nowy podfolder w",
        // Zakladki projektu (Documents / Assistant / Tabular Reviews)
        tabDocuments: "Dokumenty",
        tabAssistant: "Asystent",
        tabTabularReviews: "Przeglądy tabelaryczne",
        // Breadcrumb pickera dokumentow z poziomu projektu
        breadcrumbProjects: "Projekty",
        breadcrumbAddDocs: "Dodaj dokumenty",
        breadcrumbPeople: "Osoby",
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
        // Modal wyboru workflow w czacie asystenta
        searchPlaceholder: "Szukaj workflowów…",
        noWorkflowsFound: "Brak workflowów asystenta",
        builtIn: "Wbudowany",
        custom: "Niestandardowy",
    },

    // ---------------------------------------------------------------------
    // Strony bledow + 404 + Wsparcie
    // ---------------------------------------------------------------------
    error: {
        somethingWentWrong: "Coś poszło nie tak",
        unexpectedError:
            "Wystąpił nieoczekiwany błąd. Zalogowaliśmy go i sprawdzimy.",
        home: "Strona główna",
        back: "Wróć",
        notFoundTitle: "Strona nie znaleziona",
        notFoundBody:
            "Strona, której szukasz, nie istnieje lub została przeniesiona.",
        goHome: "Wróć do strony głównej",
    },

    support: {
        title: "Wsparcie",
        whatHelp: "W czym możemy pomóc?",
        // Typy zgloszenia
        bugLabel: "Zgłoś błąd",
        bugDescription: "Zgłoś coś, co nie działa.",
        featureLabel: "Propozycja funkcji",
        featureDescription: "Zaproponuj nową funkcję lub usprawnienie.",
        questionLabel: "Pytanie",
        questionDescription: "Zadaj pytanie o korzystanie z Patrona.",
        otherLabel: "Inne",
        otherDescription: "Ogólne uwagi lub inne sprawy.",
        // Pola formularza
        linkOptional: "Link do problemu (opcjonalnie)",
        linkHint:
            "Jeżeli błąd dotyczy konkretnego czatu, najedź na czat w panelu bocznym, kliknij trzy kropki, udostępnij i wklej tutaj link.",
        subject: "Temat",
        message: "Treść",
        messagePlaceholder:
            "Opisz szczegółowo pytanie, problem lub sugestię…",
        respondTo: "Odpowiemy na adres:",
        sending: "Wysyłanie…",
        submit: "Wyślij",
        submitFailed: "Nie udało się wysłać zgłoszenia",
        submitFailedDetail:
            "Nie udało się wysłać zgłoszenia. Spróbuj ponownie.",
        successTitle: "Dziękujemy za pomoc w rozwoju Patrona",
        successBody: "Skontaktujemy się z Tobą wkrótce mailem.",
        backHome: "Wróć do strony głównej",
    },

    // ---------------------------------------------------------------------
    // Modale - kasacja czatow, limit wiadomosci, link share, NewProject
    // ---------------------------------------------------------------------
    modals: {
        // Kasacja wszystkich czatow uzytkownika
        deleteAllTitle: "Usuń wszystkie czaty",
        deleteAllConfirm:
            "Czy na pewno chcesz usunąć wszystkie czaty ({count})? Operacja jest nieodwracalna.",
        deleting: "Usuwanie…",
        deleteAllChats: "Usuń wszystkie czaty",
        deletedTitle: "Czaty usunięte",
        deletedBody: "Historia czatów została usunięta.",
        // Limit wiadomosci na miesiac (credits-exhausted)
        limitTitle: "Osiągnięto limit wiadomości",
        limitBody: "Wykorzystano miesięczny limit 100 wiadomości.",
        limitResetOn: "Limit zostanie odnowiony:",
        limitResetNote:
            "Limit odnawia się pierwszego dnia każdego miesiąca.",
        // Share link
        shareTitle: "Udostępnij czat",
        shareLinkLabel: "Link do udostępniania",
        copyLink: "Kopiuj link",
        linkCopied: "Skopiowano",
        // NewProjectModal
        breadcrumbNewProject: "Nowy projekt",
        projectNamePlaceholder: "Nazwa projektu",
        cmNumberPlaceholder: "Dodaj numer sprawy…",
        members: "Osoby",
        cannotShareWithSelf:
            "Nie możesz udostępnić projektu samemu sobie.",
        addColleagues: "Dodaj współpracowników przez email…",
        selectDocuments: "Wybierz dokumenty",
        noExistingDocuments: "Brak istniejących dokumentów",
        uploadFiles: "Wczytaj pliki",
        creating: "Tworzenie…",
        createProject: "Utwórz projekt",
        failedCreateProject: "Nie udało się utworzyć projektu",
    },

    // ---------------------------------------------------------------------
    // Edit card (panel zmian sledzonych w dokumencie)
    // ---------------------------------------------------------------------
    edit: {
        accept: "Akceptuj",
        accepted: "Zaakceptowano",
        reject: "Odrzuć",
        rejected: "Odrzucono",
        revertAccept: "Nie udało się zapisać akceptacji - cofnięto.",
        revertReject: "Nie udało się zapisać odrzucenia - cofnięto.",
        resolvedNote:
            "Zmiana rozstrzygnięta - nie ma jej już w dokumencie.",
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
