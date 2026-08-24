# Patron : guide pour l'Avocat

**Pas à pas, du premier lancement à l'acte terminé.**
Correspond à l'installateur de juin 2026. Aucune compétence technique n'est requise. Si vous savez travailler avec des documents dans Word, vous savez utiliser Patron.

---

## Table des matières

1. [Ce qu'est Patron (en un paragraphe)](#1-ce-quest-patron)
2. [Premier lancement](#2-premier-lancement)
3. [Carte de l'écran : trois panneaux](#3-carte-de-lécran)
4. [Étape 1 : créer un dossier et charger les fichiers](#4-étape-1-créer-un-dossier-et-charger-les-fichiers)
5. [Étape 2 : dialoguer avec les pièces du dossier](#5-étape-2-dialoguer-avec-les-pièces-du-dossier)
6. [Étape 3 : rechercher la jurisprudence et la législation](#6-étape-3-jurisprudence-et-législation)
7. [Étape 4 : travailler sur les documents et les MODIFIER](#7-étape-4-modifier-les-documents)
8. [Étape 5 : un tableau à partir d'une série de contrats (Revue tabulaire)](#8-étape-5-un-tableau-à-partir-des-contrats)
9. [Étape 6 : les workflows (tâches répétables)](#9-étape-6-les-workflows)
10. [Étape 7 : choisir un modèle IA](#10-étape-7-choisir-un-modèle)
11. [Bibliothèque de compétences](#11-bibliothèque-de-compétences)
12. [Questions et problèmes courants](#12-faq)
13. [Aide-mémoire : instructions prêtes à l'emploi](#13-aide-mémoire-instructions-prêtes-à-lemploi)

---

## 1. Ce qu'est Patron

Patron est votre assistant juridique installé **sur votre propre ordinateur** (une application de bureau, comme Word). Vous chargez les pièces du dossier (contrats, assignations, décisions, numérisations) et Patron :

- **les lit pour vous** et répond à vos questions en citant les sources tirées de vos propres documents,
- **recherche la jurisprudence** et **la législation** (droit français et droit de l'Union européenne) dans un ensemble de bases de données,
- **propose des modifications aux documents** sous forme de révisions (les modifications suivies de Word), que vous acceptez d'un clic,
- **perfectionne vos actes** (relecture, avocat du diable, révision linguistique).

Patron ne prend pas de décisions juridiques et ne remplace pas votre jugement. C'est un outil : une lecture plus rapide du dossier et un premier jet que vous vérifiez dans tous les cas.

---

## 2. Premier lancement

1. Lancez **PATRON** (l'icône sur le bureau ou le menu Démarrer). Un écran de chargement apparaît, puis, après une dizaine de secondes, la fenêtre principale. Aucun compte ni connexion n'est nécessaire. Patron est mono-utilisateur et local : les pièces du dossier, les bases de données et l'historique des conversations restent sur votre ordinateur.
2. **Ajoutez la clé d'un modèle IA.** C'est la seule étape sans laquelle l'assistant ne répondra pas. Ouvrez **Compte → Modèles et clés API** et collez la clé de votre fournisseur (par exemple Libra/Anthropic, ou Gemini/OpenAI). Enregistrez. À partir de ce moment, la conversation, la modification des documents et les tableaux fonctionnent. Détails : [Étape 7](#10-étape-7-choisir-un-modèle).
3. **Internet et conversion des fichiers.** Un modèle cloud et la recherche en direct de jurisprudence et de législation (Legifrance via PISTE) nécessitent une connexion internet. La recherche dans vos propres documents fonctionne aussi hors ligne. Si une erreur de conversion apparaît au chargement de vieux fichiers `.doc`, demandez à votre administrateur d'installer LibreOffice (il est gratuit).

> **Astuce :** Patron s'adresse à vous en disant « Maître ». Il vous parle en français et rédige les actes en français, car ils sont destinés aux juridictions françaises. Vous ne savez pas par où commencer ? Demandez-lui directement dans la conversation : **« Que savez-vous faire ? »** ou **« Par où commencer ? »**, et il vous présentera ses fonctions pas à pas. Si vous ne voyez pas quelque chose, développez le panneau de gauche (**Explorateur**).

---

## 3. Carte de l'écran

L'écran de l'assistant est divisé en **trois panneaux verticaux** :

| Panneau | Nom | À quoi il sert |
|---|---|---|
| **gauche** | **Explorateur** | la liste des dossiers (projets) et des documents ; c'est là que vous chargez les fichiers |
| **centre** | **Visionneuse de documents** | le contenu du document sur lequel vous avez cliqué ; c'est là qu'apparaissent les révisions |
| **droite** | **Assistant** | la conversation, où vous posez vos questions et donnez vos instructions |

Vous pouvez réduire le panneau de gauche (« Réduire l'explorateur ») et le développer à nouveau lorsque vous avez besoin de place pour la visionneuse.

---

## 4. Étape 1 : créer un dossier et charger les fichiers

**Règle 1 : un dossier = un projet.** Ne mélangez pas les fichiers d'affaires différentes. Pour chaque question que vous posez, Patron cherche dans tous les documents du projet.

### 4.1. Créer un projet
1. Dans le panneau de gauche, cliquez sur **Nouveau projet** (ou « Nouveau dossier », raccourci **Ctrl+N**).
2. Donnez-lui un nom parlant, par exemple `Martin c/ Bianchi Construction SARL, action 2026`, et renseignez la **Référence** - elle apparaît ensuite comme colonne propre dans la liste des dossiers.

### 4.2. Charger les documents : trois façons

- **Glisser-déposer :** sélectionnez les fichiers ou le dossier dans l'Explorateur de fichiers Windows et déposez-les sur le panneau (vous verrez « Déposez pour charger »).
- **Charger des documents :** le bouton dans le panneau de gauche, puis choisissez les fichiers (PDF, DOCX, DOC).
- **Importer un dossier d'affaire** (l'option la plus rapide avec beaucoup de fichiers) : indiquez le chemin du répertoire, par exemple `C:\Dossiers\Martin-2026`. Patron importera tous les fichiers en une seule fois, les analysera pour la sécurité et les indexera.

Ce qui se passe en coulisses (vous n'avez rien à faire) : Patron reconnaît la structure rédactionnelle du document (articles, alinéas, points), exécute l'OCR sur les numérisations et le texte intégral entre dans la recherche. Les numérisations papier et les fichiers sans couche de texte fonctionnent aussi.

> **Règle 2 : chargez TOUTES les pièces du dossier avant votre première question.** Plus le dossier est complet, plus les réponses sont précises. Les documents ajoutés plus tard ne modifieront pas rétroactivement les réponses précédentes.

---

## 5. Étape 2 : dialoguer avec les pièces du dossier

Dans le panneau de droite (**Assistant**), saisissez votre question et envoyez-la. Patron sélectionne lui-même les passages les plus pertinents de l'ensemble du dossier (vous n'avez aucun texte à coller).

**Posez des questions précises.** Au lieu de « qu'y a-t-il dans le contrat », écrivez :
- « Quelles obligations le maître d'ouvrage a-t-il au titre de l'article 5 du contrat n° 3 ? »
- « Énumérez tous les délais de paiement et toutes les pénalités contractuelles de ce contrat. »
- « Y a-t-il des éléments pour soulever une prescription ? Indiquez les dates dans le dossier. »
- « Quelles incohérences existe-t-il entre le contrat principal et l'avenant n° 2 ? »

### Lisez le badge de couleur à côté des citations
Chaque citation tirée de vos documents reçoit un indicateur de fiabilité :

- 🟢 **vert :** citation littérale, trouvée dans les pièces de votre dossier. Vous pouvez l'utiliser dans un acte en indiquant la source.
- 🟡 **jaune :** reformulation ou paraphrase possible. Confrontez-la à l'original.
- 🔴 **rouge :** introuvable dans le dossier. **Ne la citez pas sans vérification manuelle.** Il peut s'agir d'une formulation qui ne fait que ressembler à une citation.

> **Règle 3 : avant de coller une citation dans un acte, regardez le badge.** C'est votre filtre anti-hallucination.

---

## 6. Étape 3 : jurisprudence et législation

L'édition française de Patron est fournie avec **le connecteur du droit français intégré** (il fonctionne dès l'installation, sans configuration) :

| Base de données | Ce que vous y trouvez |
|---|---|
| **Legifrance (via PISTE)** | la législation française : la LODA (lois, ordonnances, décrets, arrêtés) et les codes en vigueur, la jurisprudence judiciaire (base JURI), avec l'identifiant ECLI natif |

**Important - identifiants PISTE gratuits.** Le connecteur Legifrance interroge la plateforme PISTE (portail des API de l'État, opéré par l'AIFE). Pour lancer des requêtes en direct, il **requiert des identifiants gratuits**. La marche à suivre :

1. Créez un compte PISTE gratuit sur **piste.gouv.fr** et souscrivez à l'API Legifrance (l'inscription et l'accès sont gratuits).
2. Récupérez vos identifiants (clé client et secret client).
3. Saisissez-les dans Patron sous **Compte → Connecteurs** (section des clés du connecteur).

Sans ces clés, le connecteur reste visible et liste ses outils, mais **il ne peut pas interroger** Legifrance en direct. Une fois les identifiants saisis, la recherche fonctionne.

Les autres connecteurs NE sont PAS inclus dans l'installateur - l'édition reste légère. Le droit de l'Union européenne (**EUR-Lex**, le corpus de conformité **EU-Compliance** hors ligne : RGPD/GDPR, AI Act, DORA, NIS2, eIDAS 2.0, CRA) et les connecteurs d'autres juridictions (y compris les connecteurs polonais : SAOS, NSA, ISAP, KRS) se téléchargent séparément depuis la **MateMatic Boutique** (matematicsolutions.com/boutique) et se rattachent à l'application. Une fois installés, vous les activez dans les paramètres : **Compte → Connecteurs**.

Posez votre question en langage naturel et Patron choisira lui-même la bonne base de données :

- « Trouvez des décisions de la Cour de cassation en matière de responsabilité civile délictuelle. Indiquez les références des arrêts. »
- « Montrez-moi l'article 1240 du Code civil. »
- Avec le connecteur EU-Compliance installé depuis la Boutique : « Quelle est la définition d'un système d'IA à haut risque dans l'AI Act ? »
- Avec les connecteurs polonais installés depuis la Boutique : « Vérifiez le conseil d'administration de Nowak-Bud sp. z o.o. dans le KRS. » Les recherches de jurisprudence polonaise renvoient de vraies décisions de la base SAOS, par exemple **I CSK 90/15**, **III CSK 217/15**, **IV CSK 270/15**, avec dates et liens.

> **À retenir :** les bases de données sont un accès rapide et une piste. Avant de citer une disposition dans un acte, vérifiez son texte en vigueur dans la source officielle, car la législation change.

---

## 7. Étape 4 : modifier les documents

C'est le cœur du travail quotidien. Patron modifie les documents de trois façons. Toutes se terminent par un fichier que vous ouvrez dans Word.

### 7A. Demander une modification, examiner les révisions, accepter

C'est le mode le plus commode pour des corrections ponctuelles dans un contrat ou un acte.

1. Dans l'Explorateur, **cliquez sur un document DOCX**. Il apparaît dans le panneau central (**Visionneuse de documents**).
2. Dans l'Assistant, écrivez ce que vous voulez, **en désignant l'endroit** :
   - « Proposez une modification à l'article 4. Je veux limiter la responsabilité de l'entrepreneur au dommage réel, à l'exclusion du gain manqué. »
   - « Ajoutez à l'article 3 une clause désignant comme juridiction compétente celle du siège du maître d'ouvrage. »
   - « Reformulez l'article 7 pour que le délai de préavis soit de 3 mois, prenant effet à la fin du mois. »
3. Patron répond par des **fiches de modification**. Chaque fiche montre :
   - le texte **ajouté** en vert,
   - le texte **supprimé** en rouge, barré,
   - une brève **justification** de la modification.
4. Chaque fiche vous offre trois boutons :
   - **Accepter :** Patron applique la modification et crée une **nouvelle version** du document (véritables modifications suivies de Word),
   - **Rejeter :** la modification disparaît,
   - **Ouvrir :** aperçu de la modification dans le contexte de l'ensemble du document.
5. Une fois acceptée, téléchargez le fichier terminé (l'icône de téléchargement à côté du document) et ouvrez-le dans Word. Vous verrez les modifications comme une révision en attente d'acceptation finale.

> Vous pouvez accepter les modifications une par une ou en bloc. Chaque acceptation enregistre une nouvelle version, et les versions précédentes restent dans l'historique : vous ne perdez rien.

### 7B. Perfectionner un acte entier : « Projet de réponse » (relecture, avocat du diable, langue)

C'est le mode pour un acte entier, ou pour un passage plus long que vous voulez renforcer.

1. Ouvrez le panneau **Projet de réponse** (l'icône ✨ sous la réponse de l'assistant, ou depuis le menu).
2. Dans le champ **Texte de l'acte**, collez votre texte de travail.
3. Choisissez le point de vue de l'avocat du diable (**« de quel point de vue »**) :
   - **Partie adverse :** comment le conseil de l'autre partie l'attaquera,
   - **Formation de jugement :** ce sur quoi la formation de jugement posera des questions,
   - **Procureur :** l'angle du ministère public.
4. Cliquez sur **Perfectionner l'acte**. Patron fait passer le texte par trois étapes :
   - **Relecteur :** signale les lacunes de raisonnement et les autorités faibles, et renforce l'argumentation,
   - **Avocat du diable :** anticipe et réfute les contre-arguments selon le point de vue choisi,
   - **Écrire simplement :** supprime le « style IA » tout en conservant la précision juridique.
5. Vous obtenez un **Projet finalisé** (que vous pouvez copier) et une section dépliable **« Comment le projet a été élaboré »** qui montre ce que chaque étape a changé.

> **Règle 4 : la chaîne de traitement donne le meilleur sur un texte fini, pas sur une invite vide.** Écrivez votre propre version, collez-la et demandez à la renforcer. Puis ajoutez votre propre correction, et un second passage si nécessaire.

### 7C. Aller-retour : modifier dans Word, revenir dans Patron

Si vous préférez travailler dans Word :

1. Téléchargez le document depuis Patron.
2. Dans Word, apportez **vos propres modifications avec le suivi des modifications activé**, ajoutez des commentaires et, partout où vous voulez que Patron fasse quelque chose, écrivez une instruction dans un commentaire au format `[PATRON : écrivez ici l'instruction]`.
3. Rechargez le fichier (comme nouvelle version). Patron lit vos modifications suivies, vos commentaires et vos instructions `[PATRON : ...]`, et apprend votre style de rédaction.

### 7D. Versions et téléchargements
- Chaque modification acceptée = une nouvelle version (l'historique est conservé).
- Téléchargez un fichier isolé avec l'icône de téléchargement, ou téléchargez l'ensemble du projet sous forme de ZIP.

---

## 8. Étape 5 : un tableau à partir des contrats

Lorsque vous avez **de nombreux documents similaires** (par exemple 30 baux) et que vous voulez les comparer dans un tableau, utilisez la **Revue tabulaire**.

1. Allez dans **Revues tabulaires → + Créer une nouvelle**.
2. Ajoutez des colonnes, soit à partir des préréglages juridiques prêts (Parties, Objet, Pénalité contractuelle, Droit applicable, Délai de préavis…), soit les vôtres, par exemple « Clause RGPD : oui/non ».
3. Cliquez sur **Générer**. Le tableau se remplit en flux : Patron cherche dans chaque document et inscrit le résultat.
4. Chaque cellule a un badge de fiabilité (🟢/🟡/🔴). 🔴 signifie vérification manuelle ; cliquez sur la cellule pour voir la source.
5. Exportez vers Excel pour le client ou l'équipe.

> L'intérêt : vous examinez une série de contrats en un seul passage au lieu de les ouvrir un par un, et chaque cellule renvoie à sa source.

---

## 9. Étape 6 : les workflows

Enregistrez une fois une tâche répétable (par exemple « Analyse de baux », « Revue de due diligence ») comme **workflow** et exécutez-la sur de nouveaux dossiers d'un simple clic.

- Commencez par les workflows intégrés.
- Les vôtres : **Workflows → Ajouter un workflow**, saisissez les instructions étape par étape, puis enregistrez.
- Vous pouvez partager un workflow avec vos confrères, pour que tout le cabinet mène la due diligence sur la même liste de contrôle.

---

## 10. Étape 7 : choisir un modèle

Patron est **neutre vis-à-vis des fournisseurs** : c'est donc vous qui choisissez le modèle. Ce sont **deux** réglages dans **Compte → Modèles et clés API** : le modèle de la conversation et un **Modèle des revues tabulaires** distinct. On donne en général aux tableaux un modèle moins cher - le travail est important et chaque champ est court. Modifier l'un ou l'autre ne nécessite aucune réinstallation.

- **Un modèle cloud (par exemple Libra / Claude, Gemini)** offre la meilleure qualité de rédaction et de raisonnement. C'est le choix de travail ordinaire d'un cabinet. Le contenu de votre requête est alors transmis au fournisseur que vous avez choisi.
- **Un modèle local (Ollama)** fonctionne sans internet, à coût nul. Il nécessite une installation ponctuelle d'Ollama et le téléchargement du modèle sur votre ordinateur.

Vous pouvez les combiner : un modèle moins cher ou local pour explorer le dossier, un plus puissant pour l'acte final. La consommation et les coûts se vérifient dans **Compte → Consommation** (avec un filtre par dossier).

**Affaires couvertes par le secret professionnel et le cloud.** Dans la version de bureau, vous, l'avocat sur votre propre machine, êtes l'hôte des données : votre choix d'un modèle cloud est donc un consentement éclairé. Patron vous permet de travailler avec n'importe quel modèle, y compris sur des affaires marquées comme confidentielles. **Chaque** flux de données vers le modèle est consigné dans un journal d'audit inaltérable (preuve de diligence, AI Act art. 12), et les données personnelles sont masquées avant l'envoi. Si le cabinet souhaite un régime plus strict (par exemple les affaires confidentielles uniquement sur un modèle local), l'administrateur peut le configurer. Par défaut, rien ne vous bloque.

---

## 11. Bibliothèque de compétences

La **Bibliothèque de compétences** est un ensemble de « compétences » que Patron applique lorsqu'il perfectionne les actes :

- **Intégrées** (toujours actives) : **Relecteur**, **Avocat du diable**, **Écrire simplement**.
- **Installées** (les vôtres) : vous activez, désactivez et importez des étapes supplémentaires depuis un fichier.

Les compétences intégrées ne nécessitent aucune configuration. Elles fonctionnent dans le panneau « Projet de réponse ».

---

## 12. FAQ

**L'assistant ne répond pas, ou la conversation renvoie une erreur (surtout juste après l'installation).**
La cause la plus fréquente est l'absence de clé de modèle. Ouvrez **Compte → Modèles et clés API** et ajoutez une clé (par exemple Libra/Anthropic). La deuxième cause est l'absence d'internet avec un modèle cloud. Vérifiez aussi dans **Compte → Modèles et clés API** que le modèle sélectionné est bien un modèle dont vous détenez la clé.

**Mes pièces de dossier partent-elles vers le cloud ?**
Uniquement si vous avez choisi un modèle cloud ; dans ce cas, le contenu de votre requête part vers ce fournisseur. Avec un modèle local, tout reste sur votre ordinateur. Les fichiers, les bases de données et l'historique des conversations sont toujours stockés en local.

**Patron a écrit quelque chose qui n'est pas dans le dossier.**
Regardez le badge : 🔴 signifie non vérifié. Les modèles peuvent « combler les vides ». Le badge et votre propre vérification sont le filtre final, et Patron ne le remplace pas.

**La conversion DOCX/PDF ne fonctionne pas.**
La conversion des documents nécessite LibreOffice sur l'ordinateur. S'il manque quelque chose, signalez-le à l'administrateur du cabinet.

**Comment exporter vers Word un acte avec les commentaires ?**
Demandez les modifications sous forme de révisions (Étape 4A), acceptez celles que vous voulez et téléchargez le DOCX. Dans Word, vous verrez une révision en attente d'acceptation finale.

**Patron vérifie-t-il qu'une norme est en vigueur ?**
Les bases de données offrent un accès rapide au texte, mais elles peuvent être en retard sur le Journal officiel. Vérifiez le texte en vigueur dans la source officielle avant de rédiger.

**Patron prend-il des décisions juridiques ?**
Non. L'appréciation juridique, la signature et la responsabilité professionnelle sont les vôtres.

---

## 13. Aide-mémoire : instructions prêtes à l'emploi

**Dialoguer avec les pièces du dossier**
- « Énumérez tous les délais et pénalités contractuelles de ce contrat. »
- « Quelles incohérences existe-t-il entre le document A et le document B ? »
- « Y a-t-il un problème de prescription ? Indiquez les dates dans le dossier. »

**Jurisprudence et législation**
- « Trouvez des décisions de la Cour de cassation en matière de [sujet]. Indiquez les références des arrêts. »
- « Montrez l'article [X] du [code]. »
- Avec les connecteurs polonais activés : « Vérifiez [nom de la société] dans le KRS. »

**Modifier un document (après avoir cliqué sur un fichier DOCX)**
- « Proposez une modification à l'article [X] : [ce que vous voulez], sous forme de révisions. »
- « Ajoutez à l'article [X] une clause [description]. »
- « Reformulez l'article [X] : [nouveau texte ou objectif]. »

**Perfectionner un acte**
- Le panneau « Projet de réponse » : collez le texte, choisissez le point de vue, puis « Perfectionner l'acte ».

---

*Patron est un outil qui accompagne le travail de l'avocat. Chaque acte est vérifié et signé par l'Avocat avant l'envoi. Ce document reflète l'état de l'application en juin 2026.*
