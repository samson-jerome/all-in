# allin — gestion de tickets

Application multi-tenant de gestion de tickets (développement et incidents).
Ce dépôt contient le **lot 1 — socle** : authentification, organisations,
rôles et cloisonnement des données. Les tickets arrivent au lot 2.

## Prérequis

Node 20 ou plus, Docker en fonctionnement, `psql` pour les scripts
d'administration (paquet `postgresql-client`), et [Deno](https://deno.com)
pour la vérification de types des Edge Functions (`npm run fn:check`).

## Démarrage

```bash
npm install
cp .env.example .env            # renseigner les valeurs, cf. le fichier
npm run db:start
npm run db:reset                # migrations et jeu de fixtures
npm run db:types

cd web && npm install && cp .env.example .env.local && npm run dev
```

Les deux fichiers d'exemple ne portent pas les mêmes variables : celui de la
racine sert aux outils d'administration et contient la clé `service_role` ;
celui de `web/` ne contient que l'URL et la clé `anon`. Ne copiez pas l'un à
la place de l'autre.

`npx supabase status` affiche toutes les valeurs locales.

L'application répond sur http://127.0.0.1:5173, les courriels de
développement sont lisibles sur http://127.0.0.1:54324. Les Edge Functions
sont servies par `npm run db:start` ; pour les recharger à chaud pendant leur
développement, `npm run fn:serve` dans un autre terminal.

## Amorcer un environnement

Personne ne peut inviter le premier administrateur : l'invitation est posée
par un administrateur, et il n'y en a aucun. `npm run admin:bootstrap` fait
les deux moitiés du travail — il pose l'invitation `pending` en base, puis
crée le compte par l'API admin de GoTrue, qui est la seule voie restante
puisque l'inscription libre est fermée.

```bash
BOOTSTRAP_ADMIN_EMAIL=vous@exemple.fr npm run admin:bootstrap
```

Il exige `BOOTSTRAP_ADMIN_EMAIL`, `DATABASE_URL`, `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY` et `SITE_URL`, lues dans l'environnement ou dans
le `.env` de la racine, et refuse de démarrer si l'une manque. Il est
idempotent : rejoué, il ne crée rien et le dit. Il termine en affichant le
rôle du profil tel qu'il est en base, et non la promesse qu'il a été posé.

L'administrateur amorcé reçoit un lien d'invitation (sur
http://127.0.0.1:54324 en local), définit son mot de passe, et se connecte.

## Où atterrit un lien d'invitation

Un lien d'invitation **doit** renvoyer sur `<SITE_URL>/auth/callback`. C'est
la seule route qui lise le `type=invite` du lien et envoie la personne
définir un mot de passe. Renvoyée ailleurs — à la racine du site, ce que fait
GoTrue en l'absence de `redirect_to` explicite — elle arrive connectée, sans
qu'on lui demande rien, et se retrouve enfermée dehors dès l'expiration de
cette première session : aucun mot de passe n'aura jamais été défini, et
c'est l'unique porte d'entrée du produit.

C'est pourquoi `invite-user` et `npm run admin:bootstrap` passent tous deux
un `redirect_to` explicite, construit à partir de `SITE_URL` :

| Où | Variable | Source |
|---|---|---|
| Edge Functions | `SITE_URL` | `[edge_runtime.secrets]` dans `supabase/config.toml` en local ; `supabase secrets set` sur un environnement déployé |
| `npm run admin:bootstrap` | `SITE_URL` | l'environnement, ou le `.env` de la racine |

Ni l'un ni l'autre ne retombe silencieusement sur une valeur par défaut :
sans la variable, `invite-user` répond `500 site_url_not_configured` sans
rien écrire, et le script d'amorçage refuse de démarrer. Une retombée
silencieuse réintroduirait le défaut ci-dessus dans tout environnement mal
configuré, invisiblement, pour chaque personne invitée.

`<SITE_URL>/auth/callback` doit aussi figurer dans
`[auth] additional_redirect_urls`, sans quoi GoTrue refuse la redirection.

## Comptes de développement

Neuf comptes, tous avec le mot de passe `password123`. Ils sont posés par
`supabase/seed.sql` et servent aussi à la suite pgTAP.

| Adresse | Rôle | Portée |
|---|---|---|
| `admin@allin.test` | Administrateur | tout |
| `inactiveadmin@allin.test` | Administrateur désactivé | aucune |
| `agent1@allin.test` | Agent | Acme et Beta |
| `agent2@allin.test` | Agent | Ceres |
| `clienta1@allin.test` | Client | Acme |
| `clienta2@allin.test` | Client | Acme |
| `clientb1@allin.test` | Client | Beta |
| `inactive@allin.test` | Client désactivé | aucune |
| `orphan@allin.test` | Aucun profil (aucune invitation) | aucune |

`inactiveadmin@allin.test` n'est pas un doublon de `inactive@allin.test` :
c'est le seul compte qui prouve que la désactivation retire aussi ses
pouvoirs à un administrateur, et pas seulement ses données à un client.

## Commandes

Les commandes `supabase` et les scripts d'administration se lancent à la
racine, les commandes du front dans `web/`.

| Commande | Effet |
|---|---|
| `npm run db:start` / `npm run db:stop` | Démarre ou arrête la pile Supabase locale |
| `npm run db:reset` | Rejoue migrations et fixtures depuis zéro |
| `npm run db:test` | Suite pgTAP du cloisonnement |
| `npm run db:types` | Régénère `web/src/lib/database.types.ts` depuis le schéma |
| `npm run fn:serve` | Sert les Edge Functions avec rechargement à chaud |
| `npm run fn:check` | Vérifie les types des Edge Functions (`deno check`) |
| `npm run admin:bootstrap` | Amorce le premier administrateur (variables ci-dessus) |
| `npm run dev` (dans `web/`) | Lance le front |
| `npm run test` (dans `web/`) | Tests Vitest (contrôle d'accès des Edge Functions, store de session) |
| `npm run typecheck` (dans `web/`) | Vérification de types du front et des tests |
| `npm run build` (dans `web/`) | Construit le front |

### Sur les deux portes de vérification de types

`npm run typecheck` lance `vue-tsc -b`, qui construit la solution
`web/tsconfig.json` et donc ses trois projets : `src/**`, `vite.config.ts` et
`tests/**`.

**N'utilisez jamais `vue-tsc --noEmit` à sa place.** `web/tsconfig.json` est
un fichier de solution (`"files": []` + références) : sans `-b`, cette
commande ne type-vérifie aucun fichier et sort en 0 quoi qu'il arrive. Elle a
servi de porte pendant une partie de ce lot, et n'a rien vu — y compris une
construction du front cassée. C'est pourquoi `npm run build` fait aussi
partie de la recette : une porte qui ne compile pas le projet ne dit pas si
le front est livrable.

`npm run fn:check` est la troisième porte, et elle couvre ce que les deux
autres n'atteignent pas : les Edge Functions tournent sous Deno, hors de
toute solution TypeScript du front. C'est tout le code d'autorisation du
produit. Au moment où elle a été ajoutée, elle a immédiatement relevé neuf
erreurs de types qui n'avaient jamais été vues.

## Sécurité

Le cloisonnement repose entièrement sur les politiques RLS de PostgreSQL.
Les gardes de route du front sont un confort de navigation, pas une
barrière. La clé `anon` est publique par conception ; la clé
`service_role` ne doit jamais quitter les Edge Functions et les scripts
d'administration.

**L'entrée dans le produit se fait uniquement sur invitation préalable.**
L'inscription libre est fermée par `[auth] enable_signup = false` dans
`supabase/config.toml` — le drapeau global, pas celui de `[auth.email]`, qui
refuserait aussi la connexion des comptes existants. Aucune ligne
`auth.users` ne peut donc naître en dehors de l'API admin, qui est la seule
voie qu'empruntent l'Edge Function `invite-user` et le script d'amorçage.

C'est ce qui rend le modèle d'arrivée sûr : `public.handle_new_user()` traite
un `invited_at` non nul comme la preuve d'une arrivée légitime, pour tous les
rôles. **Cette équivalence ne tient que tant que l'inscription reste
fermée.** Si `enable_signup` repassait à `true` — ce dont aura besoin le lot
OAuth — n'importe qui pourrait créer un compte sur une adresse invitée et se
voir attribuer son profil. Le commentaire d'avertissement porté par
`public.handle_new_user()`
(`supabase/migrations/20260921070000_invitation_only_arrival.sql`) est à
relire avant toute réouverture, ainsi que celui de l'Edge Function
`invite-user`, dont la branche « compte existant sans profil » repose sur la
même hypothèse.

## Hors périmètre

**L'authentification OAuth des utilisateurs internes est reportée à un lot
ultérieur.** C'est une décision produit, pas une contrainte technique. Elle a
été prise en cours de lot 1 : la conception d'origine faisait arriver les
agents et les administrateurs par Google ou GitHub.

Aujourd'hui, tout le monde arrive de la même façon — clients, agents et
administrateurs : un administrateur invite une adresse, la personne reçoit un
lien, définit un mot de passe et se connecte. Aucun fournisseur externe
n'est activé dans `supabase/config.toml` : le seul bloc `[auth.external.*]`
qui s'y trouve est le gabarit `apple` livré par la CLI, à `enabled = false`.

Les écarts entre la conception et ce qui est livré sont consignés, datés, en
tête du document de conception.

Conception détaillée : `docs/superpowers/specs/2026-09-20-socle-multi-tenant-design.md`.
