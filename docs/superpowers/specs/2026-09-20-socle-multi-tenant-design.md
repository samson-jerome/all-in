# Socle multi-tenant — conception (lot 1)

- **Date** : 2026-09-20
- **Projet** : allin — gestion de tickets (développement et incidents)
- **Statut** : validé, prêt pour la rédaction du plan d'implémentation

## 1. Contexte

L'objectif produit est une application de gestion de tickets multi-tenant, accessible
par une interface web Vue.js et adossée à Supabase. Des organisations clientes
externes déposent des tickets ; des agents internes les traitent ; des administrateurs
pilotent le paramétrage. Les tickets relèvent du développement ou de l'incident, et
leur cycle de vie doit être configurable, jusqu'aux actions déclenchées
automatiquement lors des changements de statut.

Ce périmètre couvre quatre sous-systèmes indépendants, spécifiés et implémentés
séparément :

1. **Socle** — authentification, organisations, membres, rôles, cloisonnement des
   données, coquille applicative Vue. *C'est l'objet du présent document.*
2. **Tickets** — modèle de ticket, commentaires, pièces jointes, listes et détail,
   avec des statuts figés en dur.
3. **Moteur de workflow configurable** — statuts, transitions, rôles autorisés par
   transition, champs obligatoires, écrans d'administration. Remplace les statuts
   figés du lot 2.
4. **Actions automatiques** — notifications, assignation automatique, horodatage des
   SLA, webhooks.

Le lot 3 réécrira une partie du lot 2. Ce coût est assumé : concevoir un moteur de
workflow avant d'avoir manipulé de vrais tickets produit un moteur inadapté.

## 2. Périmètre du lot 1

**Inclus** : authentification, modèle de tenancy, rôles, politiques de cloisonnement,
parcours d'invitation et de première connexion, administration des organisations, des
utilisateurs et des invitations, coquille applicative Vue, suite de tests du
cloisonnement.

**Exclu** : toute notion de ticket, audit, notifications, préférences utilisateur,
hiérarchie d'organisations, suppression de données, direction graphique.

## 3. Décisions structurantes

| Sujet | Décision |
|---|---|
| Tenancy | Un client appartient à une organisation ; un agent en couvre plusieurs ; un admin voit tout |
| Rôles | `client`, `agent`, `admin` |
| Authentification | E-mail et mot de passe pour les clients externes ; OAuth (Google ou GitHub) pour les agents et admins |
| Entrée dans le système | Sur invitation préalable uniquement ; aucune inscription libre |
| Autorisation | Politiques RLS adossées à des fonctions SQL `security definer` |
| Opérations privilégiées | Edge Functions en `service_role`, limitées au strict nécessaire |
| Front | Vue 3, TypeScript strict, Vite, Pinia, Tailwind, types générés depuis le schéma |
| Environnement | Supabase en local via la CLI, schéma et politiques en migrations versionnées |
| Tests | pgTAP pour la base ; trois tests Vitest pour le contrôle d'accès des Edge Functions |

### Pourquoi l'autorisation vit dans la base

Deux alternatives ont été écartées.

*Rôle et organisations portés par des claims JWT* (via un Auth Hook) offrent les
politiques les plus rapides, mais un agent couvrant plusieurs organisations porte sa
liste dans son jeton : une réaffectation resterait sans effet jusqu'au rafraîchissement
du token. Un agent conserverait l'accès à une organisation qu'on vient de lui retirer.
Inacceptable sur un produit à clients externes.

*Tout en RPC, aucune table exposée* donnerait un contrôle total, au prix de réécrire à
la main ce que PostgREST fournit (filtres, tri, pagination), de perdre le Realtime sur
les tables et d'exiger une migration à chaque nouveau besoin de lecture. Trop rigide
pour un lot 3 qui rendra les workflows configurables.

## 4. Modèle de données

Un type énuméré et quatre tables dans le schéma `public`. Toutes les tables sont en
`enable row level security` **et** `force row level security`.

```sql
create type app_role as enum ('client', 'agent', 'admin');
```

### `organizations`

Les organisations clientes.

| Colonne | Type | Notes |
|---|---|---|
| `id` | uuid | clé primaire, `gen_random_uuid()` |
| `name` | text | non nul |
| `slug` | text | non nul, unique, identifiant lisible |
| `is_active` | boolean | non nul, défaut `true` |
| `created_at` / `updated_at` | timestamptz | `updated_at` maintenu par trigger |

### `profiles`

Un profil par utilisateur authentifié. **L'absence de profil vaut absence totale
d'accès** : c'est le mécanisme qui neutralise un compte non rattaché.

| Colonne | Type | Notes |
|---|---|---|
| `id` | uuid | clé primaire, `references auth.users(id) on delete cascade` |
| `full_name` | text | non nul |
| `role` | app_role | non nul |
| `org_id` | uuid | `references organizations(id)` ; obligatoire pour un client, interdit sinon |
| `is_active` | boolean | non nul, défaut `true` |
| `created_at` / `updated_at` | timestamptz | |

```sql
constraint client_requires_org check (
  (role =  'client' and org_id is not null) or
  (role <> 'client' and org_id is null)
)
```

### `agent_organizations`

Le portefeuille d'un agent.

| Colonne | Type | Notes |
|---|---|---|
| `agent_id` | uuid | `references profiles(id) on delete cascade` |
| `org_id` | uuid | `references organizations(id) on delete cascade` |
| `created_at` | timestamptz | |

Clé primaire composite `(agent_id, org_id)`, qui sert également d'index à la fonction
`agent_covers_org()`.

### `invitations`

Le pré-enregistrement, par un administrateur, d'un utilisateur attendu.

| Colonne | Type | Notes |
|---|---|---|
| `id` | uuid | clé primaire |
| `email` | citext | non nul, normalisé (`trim` et minuscules) |
| `role` | app_role | non nul |
| `org_id` | uuid | même contrainte `client_requires_org` que `profiles` |
| `invited_by` | uuid | `references profiles(id)` |
| `status` | text | `pending`, `accepted` ou `revoked` ; défaut `pending` |
| `created_at` / `accepted_at` | timestamptz | |

Index unique partiel sur `(email) where status = 'pending'` : une seule invitation en
attente par adresse.

**Pourquoi une table plutôt que les métadonnées de `auth.users`.** Les utilisateurs
internes arrivent par OAuth : ils ne cliquent aucun lien d'invitation et ne portent
donc aucune métadonnée. L'invitation est l'autorisation préalable, saisie par un
administrateur, que le système consomme quel que soit le mode d'arrivée.

**Le portefeuille d'un agent ne se saisit pas à l'invitation.** L'administrateur invite
l'agent, puis lui affecte ses organisations depuis l'écran d'administration.

### Rattachement automatique

Un trigger `handle_new_user` sur `auth.users`, en `after insert`, cherche une invitation
`pending` correspondant à l'adresse e-mail, en n'acceptant que les adresses vérifiées
par le fournisseur d'identité.

- Invitation trouvée : le profil est créé avec le rôle et l'organisation prévus, et
  l'invitation passe en `accepted` avec son horodatage.
- Aucune invitation, ou invitation révoquée : **rien n'est créé**. Le compte existe dans
  `auth.users` sans profil, RLS lui refuse tout, et le front affiche « compte non
  rattaché ».

### Amorçage du premier administrateur

Personne ne peut inviter le premier administrateur. Une migration de seed insère une
invitation `pending` pour une adresse lue en variable d'environnement ; la première
connexion avec cette adresse crée le profil administrateur. Le mécanisme est tracé
dans le SQL, rejouable, et ne laisse aucun compte en dur.

## 5. Autorisation

### Fonctions helpers

Quatre fonctions, toutes `stable`, `security definer`, avec `set search_path = ''` et
un droit d'exécution réservé au rôle `authenticated`.

| Fonction | Retour | Description |
|---|---|---|
| `auth_role()` | `app_role` | Rôle du profil courant ; `null` si le profil est absent ou inactif |
| `auth_org()` | `uuid` | Organisation du client courant ; `null` pour les autres rôles |
| `agent_covers_org(uuid)` | `boolean` | L'agent courant couvre-t-il cette organisation |
| `can_read_org(uuid)` | `boolean` | Administrateur, ou client de cette organisation, ou agent la couvrant |

`can_read_org()` est la définition unique de « cette organisation m'est visible ». Les
lots suivants s'y branchent sans réécrire la règle : une politique sur `tickets`
s'écrira `can_read_org(tickets.org_id)`.

Trois propriétés ne sont pas cosmétiques :

- `security definer` **coupe la récursion**. Une politique sur `profiles` qui appelle
  `auth_role()`, laquelle lit `profiles`, boucle à l'infini si la fonction est soumise à
  RLS.
- `set search_path = ''` empêche le détournement de résolution de noms, risque classique
  des fonctions `security definer`.
- `auth_role()` renvoie `null` lorsque `is_active` est faux : la désactivation d'un
  compte prend effet à la requête suivante, sans attendre l'expiration d'un jeton.

### Matrice des politiques

Toutes les politiques ciblent explicitement `to authenticated`. Le rôle `anon` ne
dispose d'aucun privilège sur le schéma. Ce qui n'est pas listé est refusé.

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `organizations` | `can_read_org(id)` | admin | admin | interdit |
| `profiles` | soi-même, ou administrateur, ou `can_read_org(org_id)` | interdit (trigger seul) | soi-même, colonne `full_name` uniquement | interdit |
| `agent_organizations` | ses propres lignes, ou admin | admin | interdit | admin |
| `invitations` | admin | interdit (Edge Function seule) | interdit (Edge Function seule) | interdit |

### Visibilité des profils

La politique de lecture sur `profiles` s'écrit
`id = auth.uid() or auth_role() = 'admin' or can_read_org(org_id)`.

La clause administrateur n'est pas redondante avec `can_read_org()`. Les profils des
agents et des administrateurs portent un `org_id` nul ; `can_read_org(null)` est faux, y
compris pour un administrateur. Sans cette clause, l'écran d'administration des
utilisateurs serait incapable d'afficher les agents et les administrateurs.

Conséquence assumée à ce stade : un client ne voit que ses collègues d'organisation, et
un agent que les clients des organisations qu'il couvre. Personne d'autre qu'un
administrateur ne voit les profils internes. Le lot 2 devra rouvrir ce point — afficher
le nom de l'agent qui traite un ticket suppose que le client puisse lire ce profil. La
règle sera alors élargie à partir d'un besoin réel, plutôt que devinée ici.

### Deux choix à expliciter

**Aucune politique UPDATE pour l'administrateur sur `profiles`.** Changer le rôle ou
l'organisation d'un utilisateur est l'opération la plus sensible du socle. RLS ne sait
pas restreindre par colonne : une politique administrateur en UPDATE ouvrirait `role` et
`org_id` à toute requête émise depuis le navigateur. Ces changements passent par une
Edge Function. Un utilisateur ne peut modifier que son `full_name`, garanti par un
`grant update (full_name) on profiles to authenticated` — un privilège de colonne, pas
une politique.

**Aucune suppression, nulle part.** On désactive via `is_active`. Supprimer une
organisation cascaderait un jour sur des tickets et leur historique.

### Point d'extension laissé ouvert

Seul un administrateur peut inviter. Autoriser un agent à inviter des clients dans les
organisations qu'il couvre est un besoin plausible, mais non nécessaire au socle ; la
règle se relâchera en une ligne le moment venu.

## 6. Opérations privilégiées

Trois Edge Functions, seules autorisées à écrire dans `invitations` et à modifier les
colonnes sensibles de `profiles`.

| Fonction | Rôle |
|---|---|
| `invite-user` | Crée une invitation et déclenche l'entrée dans le système ; sert aussi au renvoi |
| `revoke-invitation` | Passe une invitation `pending` en `revoked` |
| `admin-update-user` | Modifie le rôle, l'organisation ou l'état actif d'un profil |

Le changement de rôle et la désactivation sont réunis dans une seule fonction : même
écriture, même table, même contrôle. Le portefeuille des agents, lui, reste géré par
politique RLS directe — la ligne entière constitue l'autorisation, RLS la couvre
exactement, et aucune donnée de `auth.users` n'est touchée.

### Contrôle d'accès

Aucune fonction ne fait confiance à ses paramètres. Chacune ouvre d'abord un client
Supabase **avec le jeton de l'appelant**, appelle `auth_role()`, et n'utilise la clé
`service_role` qu'après avoir obtenu `admin`. La clé de service ne sert jamais à décider
qui a le droit, seulement à exécuter ce qui a déjà été autorisé.

### Parcours d'entrée

**Client externe, par mot de passe.** L'administrateur saisit une adresse et une
organisation. `invite-user` insère l'invitation `pending`, **puis** appelle
`inviteUserByEmail()`.

L'ordre n'est pas négociable : cet appel crée immédiatement la ligne dans `auth.users`,
ce qui déclenche `handle_new_user`, qui cherche l'invitation. Invitation insérée après,
c'est un compte sans profil. Si l'appel échoue, la fonction supprime l'invitation
qu'elle vient de créer, pour ne pas laisser une ligne fantôme qui rattacherait
silencieusement un futur inscrit.

L'invité reçoit un lien, définit son mot de passe et se connecte ; son profil existe
déjà.

**Agent ou administrateur, par OAuth.** `invite-user` insère l'invitation `pending` et
**n'appelle pas** `inviteUserByEmail` : cela créerait un compte par mot de passe
parasite pour quelqu'un qui se connectera par Google ou GitHub. Une simple notification
l'invite à se connecter avec son compte. À la première connexion, `auth.users` est créé,
le trigger consomme l'invitation, et le profil existe avant le premier rendu de
l'application.

Le rapprochement se fait sur l'adresse e-mail, d'où le type `citext` et la
normalisation à l'écriture comme à la lecture.

**Compte préexistant sans profil.** Une personne s'est connectée par OAuth sans
invitation : compte créé, aucun profil, écran « compte non rattaché ». Si
l'administrateur crée alors une invitation, `handle_new_user` ne se redéclenchera
jamais, puisque l'utilisateur existe déjà — la personne resterait bloquée
indéfiniment. `invite-user` cherche donc l'adresse dans `auth.users` avant toute chose :
si le compte existe sans profil, elle crée le profil directement au lieu de poser une
invitation en attente.

**Coupure d'accès.** `admin-update-user` positionnant `is_active = false` coupe l'accès
dès la requête suivante, puisque `auth_role()` renvoie `null`. La fonction révoque en
outre les sessions actives, afin que le navigateur de la personne soit effectivement
déconnecté et pas seulement privé de données.

## 7. Application Vue

### Organisation du code

Par domaine fonctionnel plutôt que par type technique : regrouper ce qui change
ensemble tient mieux dans la tête, et dans le contexte d'un agent.

```
src/
  lib/supabase.ts          client unique, typé Database
  lib/database.types.ts    généré par la CLI, jamais édité à la main
  stores/session.ts        Pinia — source de vérité du front
  router/index.ts
  router/guards.ts
  features/auth/           connexion, retour OAuth, mot de passe, compte non rattaché
  features/admin/          organisations, utilisateurs, invitations
  features/account/        mon profil
  components/              AppShell et socle de composants partagés
```

### Store de session

Quatre états, pas deux : `loading`, `anonymous`, `unlinked`, `ready`. Le troisième est
la traduction directe du choix « pas d'invitation, pas de profil » : un état normal du
système, pas une erreur.

Le store détient `user`, `profile` (rôle et organisation) et `agentOrgs`. Il s'initialise
avant le premier rendu et s'abonne à `onAuthStateChange` pour recharger le profil à la
connexion et le vider à la déconnexion.

Aucun sélecteur d'organisation pour l'agent au lot 1 : il n'y a rien à filtrer. Le store
expose néanmoins `agentOrgs`, dont le lot 2 dépendra dès son premier écran.

### Gardes de route

Un garde global unique attend la fin de l'initialisation du store, puis oriente :
anonyme vers la page de connexion, non rattaché vers l'écran dédié, rôle insuffisant
vers une page 403. Les routes déclarent leurs exigences par `meta`.

**Les gardes ne sont pas une sécurité, mais un confort de navigation.** La sécurité est
entièrement dans RLS. Un utilisateur qui force une URL d'administration obtient un écran
incapable de charger quoi que ce soit, et c'est le comportement attendu. Aucune règle
d'accès ne doit exister uniquement dans le front.

### Traitement des refus

Une politique qui refuse une lecture ne renvoie pas d'erreur : elle renvoie **zéro
ligne**. « Invisible » et « inexistant » sont indiscernables côté client, et c'est
voulu — l'interface affiche « introuvable » dans les deux cas, sans révéler l'existence
d'une organisation qu'on n'a pas le droit de voir.

En écriture, une violation de politique remonte bien une erreur. Un helper la traduit en
message lisible, sans exposer le détail de la politique enfreinte.

### Types générés

`supabase gen types typescript --local` régénère `database.types.ts`, branché sur un
script npm à relancer après chaque migration. C'est la contrepartie concrète du choix
TypeScript : une colonne renommée en base casse la compilation au lieu de produire un
`undefined` en production.

### Écrans du lot 1

Connexion (mot de passe et boutons OAuth), retour OAuth, définition de mot de passe,
réinitialisation de mot de passe, compte non rattaché, 403, mon profil. Côté
administration : organisations (liste, création, activation), utilisateurs (liste, rôle,
activation, portefeuille des agents), invitations (liste, création, révocation). Plus un
accueil volontairement vide, place des tickets au lot 2.

### Configuration

`VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` uniquement. La clé anon est publique par
conception : c'est RLS qui protège, pas le secret de la clé. La clé `service_role` ne
doit jamais approcher le front ; elle ne vit que dans les variables des Edge Functions.

L'habillage se limite à Tailwind et un jeu de tokens minimal. La direction graphique
fera l'objet d'une discussion dédiée quand il y aura de vrais écrans métier.

## 8. Tests

### Suite pgTAP

Un seed de test pose une situation discriminante : trois organisations A, B et C ; deux
clients de A et un client de B ; un agent couvrant A et B, un autre couvrant C ; un
administrateur ; un compte désactivé ; un compte sans profil.

L'usurpation d'identité se fait par `set local role authenticated` et le positionnement
de `request.jwt.claims` sur l'utilisateur joué, de sorte que `auth.uid()` répond comme
en conditions réelles.

**Fonctions helpers** — le tableau complet de `can_read_org()` pour chaque rôle ;
`auth_role()` renvoie `null` pour le compte désactivé et pour le compte sans profil.

**`organizations`** — le client de A ne voit que A ; l'agent voit A et B mais pas C ;
l'administrateur voit tout ; la suppression est refusée à tous, administrateur compris.

**`profiles`** — chacun se voit ; le client voit ses collègues d'organisation et personne
d'autre ; l'agent voit les profils des organisations qu'il couvre ; l'insertion est
refusée à tous ; un utilisateur modifie son `full_name` mais échoue à modifier son propre
`role`, ce qui prouve l'effet du privilège de colonne.

**`agent_organizations`** — un agent ne peut pas s'ajouter une organisation. C'est le test
d'escalade de privilèges du socle ; s'il venait à passer pour de mauvaises raisons, tout
le cloisonnement tomberait.

**`invitations`** — invisible et non modifiable pour tous, sauf un administrateur en
lecture.

**Trigger `handle_new_user`** — invitation en attente consommée et profil créé ; aucune
invitation, aucun profil ; invitation révoquée, aucun profil.

**Contraintes** — un client sans organisation et un agent avec organisation sont tous
deux rejetés.

### Contrôle d'accès des Edge Functions

pgTAP n'atteint pas les Edge Functions. Or la vérification « l'appelant est-il
administrateur » y est, avec les politiques, l'autre point où le système peut
s'effondrer : une fonction qui l'oublie manipule `auth.users` avec la clé de service pour
n'importe qui.

Trois tests Vitest, dans le dépôt front, couvrent ce seul aspect : pour chacune des trois
fonctions servies en local, un appelant client et un appelant agent doivent recevoir un
refus. Ce sont de simples appels `fetch` ; aucun runtime supplémentaire n'est requis, et
Vitest est le lanceur dont le front aura besoin par ailleurs.

## 9. Structure du dépôt et commandes

Le répertoire n'est pas encore sous git ; le lot commence par un `git init`.

```
allin/
  supabase/
    config.toml
    migrations/     schéma, fonctions, politiques, triggers, amorçage administrateur
    seed.sql        jeu de données de développement
    tests/          suite pgTAP
    functions/      invite-user, revoke-invitation, admin-update-user, _shared
  web/              application Vue
  docs/superpowers/specs/
  .env.example
  README.md
```

Deux sous-projets côte à côte, sans outil de monorepo : il n'y a qu'un seul paquet front,
un workspace n'apporterait rien.

Les commandes `supabase` se lancent à la racine du dépôt, les commandes `npm` dans
`web/`.

| Commande | Effet |
|---|---|
| `supabase db reset` | Rejoue migrations et seed depuis zéro |
| `supabase test db` | Exécute la suite pgTAP |
| `npm run dev` | Lance le front |
| `npm run test` | Exécute les tests Vitest |
| `npm run types` | Régénère `database.types.ts` depuis le schéma local |

## 10. Critères de fin

Le lot 1 est terminé lorsque :

1. `supabase db reset` reconstruit l'environnement complet sans erreur.
2. `supabase test db` passe intégralement.
3. `npm run test` passe : les trois fonctions refusent un appelant non administrateur.
4. L'administrateur d'amorçage se connecte par OAuth, crée une organisation et invite un
   client.
5. Ce client définit son mot de passe, se connecte, voit son organisation et aucune
   autre.
6. Un agent affecté à deux organisations les voit toutes les deux ; désaffecté de l'une,
   il en perd l'accès immédiatement.
7. Un utilisateur désactivé perd l'accès et sa session est révoquée.
8. Un compte OAuth sans invitation atterrit sur « compte non rattaché », puis est
   débloqué par `invite-user`.
9. Le front compile sans erreur TypeScript.

## 11. Risques

**Identifiants OAuth.** Créer les identifiants chez Google ou GitHub et enregistrer les
URL de redirection locales est une dépendance externe. À traiter au début du lot, sous
peine de découvrir le blocage à la fin.

**E-mails en développement.** Les messages d'invitation partent dans le serveur de test
intégré à `supabase start`. Il faut savoir où les lire avant de conclure à une panne
d'invitation.

**Coût d'évaluation des politiques.** Chaque ligne évaluée déclenche un appel de fonction
helper. Les fonctions sont `stable` et les clés primaires servent d'index ; à surveiller
au lot 2, quand les volumes de tickets apparaîtront.
