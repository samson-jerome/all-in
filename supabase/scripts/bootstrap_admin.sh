#!/usr/bin/env bash
#
# Amorçage du premier administrateur.
#
# Personne ne peut inviter le premier administrateur : l'invitation est posée
# par un administrateur, et il n'y en a aucun. Ce script fait les deux moitiés
# du travail :
#
#   1. il pose l'invitation `pending` en base (bootstrap_admin.sql) ;
#   2. il crée le compte par l'API admin de GoTrue
#      (POST /auth/v1/invite, clé service_role).
#
# L'ordre n'est pas négociable, et c'est le même que celui de l'Edge Function
# invite-user : l'appel à /auth/v1/invite crée la ligne dans auth.users, ce
# qui déclenche public.handle_new_user(), qui cherche l'invitation. Invitation
# posée après, c'est un compte sans profil.
#
# Pourquoi l'API admin et pas un simple INSERT SQL dans auth.users :
#   - l'inscription libre est fermée ([auth] enable_signup = false), donc
#     POST /auth/v1/signup répond 422 ; l'API admin, elle, s'authentifie avec
#     la clé service_role et n'est pas soumise à ce verrou ;
#   - écrire à la main dans auth.users dépend des colonnes internes d'une
#     version précise de GoTrue (cf. supabase/seed.sql, qui doit renseigner
#     confirmation_token, recovery_token, email_change_token_new et
#     email_change pour que la 2.196.0 accepte la ligne). Un script destiné à
#     tourner sur n'importe quel environnement ne doit pas porter cette dette.
#
# Le script est idempotent : rejoué, il ne crée rien et le dit.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SQL_FILE="$SCRIPT_DIR/bootstrap_admin.sql"

# Les variables déjà présentes dans l'environnement l'emportent ; le .env de
# la racine n'est qu'un moyen commode de les fournir (cf. .env.example).
if [ -f "$REPO_ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$REPO_ROOT/.env"
  set +a
fi

missing=()
for var in BOOTSTRAP_ADMIN_EMAIL DATABASE_URL SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY SITE_URL; do
  if [ -z "${!var:-}" ]; then
    missing+=("$var")
  fi
done

if [ ${#missing[@]} -gt 0 ]; then
  echo "Variables manquantes : ${missing[*]}" >&2
  echo "" >&2
  echo "Renseignez-les dans $REPO_ROOT/.env (voir .env.example) ou exportez-les." >&2
  echo "En local, 'npx supabase status' affiche DB_URL, API_URL et SERVICE_ROLE_KEY ;" >&2
  echo "SITE_URL est l'URL du front, la même que [auth] site_url dans supabase/config.toml." >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql est introuvable. Installez le client PostgreSQL (paquet postgresql-client)." >&2
  exit 1
fi

# DATABASE_URL est une URI `postgresql://utilisateur:motdepasse@hôte/base`.
# Passée telle quelle en argument à psql, elle est lisible dans `ps` — donc le
# mot de passe de la base — par n'importe quel utilisateur local, pendant toute
# la durée de l'appel. C'est exactement la menace contre laquelle les deux
# en-têtes portant la clé service_role passent par `--config -` plus bas :
# même fichier, même danger, traitement inverse.
#
# Le mot de passe est donc retiré de l'URI et déplacé dans PGPASSWORD, que
# libpq consulte quand la chaîne de connexion n'en porte pas. L'environnement
# d'un processus n'est lisible que par son propre utilisateur et par root,
# là où /proc/<pid>/cmdline l'est par tout le monde.
#
# Seul le mot de passe est extrait, et rien d'autre n'est décomposé : l'hôte,
# le port, la base et d'éventuels paramètres (`?sslmode=require`, courant sur
# un environnement distant) continuent d'être analysés par libpq, qui sait le
# faire, plutôt que par un découpage maison qui s'y casserait.
#
# Si DATABASE_URL n'est pas une URI à mot de passe — une chaîne `key=value`,
# un nom de base, ou une URI sans mot de passe — rien ne correspond et la
# valeur passe inchangée, comme avant.
PSQL_TARGET="$DATABASE_URL"
if [[ "$DATABASE_URL" =~ ^(postgres(ql)?://)([^:/?#@]*):([^@/?#]*)@(.*)$ ]]; then
  # libpq décode les %XX d'une URI ; PGPASSWORD, non. Le mot de passe est donc
  # décodé ici, sans quoi un mot de passe contenant un caractère encodé
  # arriverait différent de ce qu'il était dans l'URI. Les antislashs sont
  # doublés d'abord, `printf '%b'` les interprétant lui aussi.
  raw_password="${BASH_REMATCH[4]//\\/\\\\}"
  PGPASSWORD="$(printf '%b' "${raw_password//%/\\x}")"
  export PGPASSWORD
  unset raw_password
  PSQL_TARGET="${BASH_REMATCH[1]}${BASH_REMATCH[3]}@${BASH_REMATCH[5]}"
fi

# Normalisée ici comme elle l'est en base (contrainte email = lower(trim(email))),
# pour que la lecture finale du rôle interroge bien la même adresse.
EMAIL="${BOOTSTRAP_ADMIN_EMAIL#"${BOOTSTRAP_ADMIN_EMAIL%%[![:space:]]*}"}"
EMAIL="${EMAIL%"${EMAIL##*[![:space:]]}"}"
EMAIL="$(printf '%s' "$EMAIL" | tr '[:upper:]' '[:lower:]')"

# Même forme que normalizeEmail() dans supabase/functions/_shared/auth.ts :
# les deux moitiés du produit acceptent exactement les mêmes adresses.
#
# Ce contrôle ne dit rien du contenu de l'adresse au-delà de sa forme
# générale. Il accepte l'apostrophe, le guillemet et l'antislash, tous légaux
# dans une partie locale — mesuré, pas supposé. Il ne rend donc sûre aucune
# interpolation, et plus aucune n'en dépend : le SQL passe par :'email', que
# psql cite lui-même, et le corps JSON est échappé explicitement plus bas.
# Une version antérieure de ce commentaire affirmait le contraire, et trois
# interpolations brutes s'en autorisaient ; o'brien@allin.test mourait sur un
# « syntax error at or near "brien" ».
if ! printf '%s' "$EMAIL" | grep -Eq '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'; then
  echo "BOOTSTRAP_ADMIN_EMAIL n'est pas une adresse e-mail valide : $EMAIL" >&2
  exit 1
fi

# Le lien d'invitation doit atterrir sur l'écran qui réclame un mot de passe,
# et non à la racine du front. C'est la même règle que celle appliquée par
# l'Edge Function invite-user (cf. inviteRedirectTo() dans
# supabase/functions/_shared/auth.ts) : sans `redirect_to` explicite, GoTrue
# renvoie sur son propre `site_url`, où AuthCallbackView n'est pas montée. La
# personne se retrouve connectée sans mot de passe défini, et enfermée dehors
# dès l'expiration de cette première session.
#
# Pas de valeur par défaut, pour la même raison que côté Edge Function : une
# retombée silencieuse sur `site_url` réintroduirait exactement ce défaut.
#
# Le contrôle de forme ci-dessous exclut espaces, guillemets, `?`, `#` et `&`,
# ce qui garantit que l'URL s'interpole sans encodage dans la chaîne de
# requête plus bas.
if ! printf '%s' "$SITE_URL" | grep -Eq '^https?://[^[:space:]"?#&]+$'; then
  echo "SITE_URL doit être une URL http(s) sans paramètres : $SITE_URL" >&2
  exit 1
fi
REDIRECT_TO="${SITE_URL%/}/auth/callback"

echo "Amorçage de l'administrateur $EMAIL"
echo "  retour     : $REDIRECT_TO"

# --- 1. L'invitation ---------------------------------------------------------
mail_sent=non
invitation_id=""
http_body_file=""

# Le filet, posé avant la moindre écriture. La règle tient en une phrase :
# une ligne que *ce script* vient d'insérer ne survit que si l'e-mail
# d'invitation est réellement parti. Sinon elle n'a plus aucun consommateur —
# le trigger public.handle_new_user() ne se déclenche qu'à la création du
# compte — et elle nuit activement : l'index unique sur les invitations
# `pending` ferait échouer en 409 la tentative suivante, y compris celle,
# légitime, passée par l'écran d'administration.
#
# C'est exactement ce que fait l'Edge Function invite-user après un
# inviteUserByEmail en échec (« Leave no ghost row that would silently attach
# a future signup »), et par le même moyen : une suppression par identifiant,
# donc de cette ligne-là et d'aucune autre.
#
# La condition `-n "$invitation_id"` n'est pas une précaution de style : si
# l'invitation `pending` préexistait — posée par quelqu'un d'autre, ou par un
# amorçage précédent — l'insertion de bootstrap_admin.sql ne s'est pas faite,
# `returning id` n'a rien rendu, et ce script n'a rien à retirer.
#
# Le trap couvre toutes les sorties, y compris celles que `set -e` provoque
# sans passer par un `exit` explicite. Mesuré : bash restitue le code de
# sortie d'origine une fois le trap terminé, même si une commande y échoue.
cleanup() {
  [ -z "$http_body_file" ] || rm -f "$http_body_file"

  [ "$mail_sent" = non ] || return 0
  [ -n "$invitation_id" ] || return 0

  if psql "$PSQL_TARGET" \
      --quiet --tuples-only --no-align \
      --set=ON_ERROR_STOP=1 \
      --set=id="$invitation_id" \
      --file - >/dev/null 2>&1 <<'SQL'
delete from public.invitations
 where id = :'id'::uuid
   and status = 'pending';
SQL
  then
    echo "  invitation : retirée, l'e-mail n'étant pas parti" >&2
  else
    # Même information que le `orphaned_invitation_id` d'invite-user : si le
    # retrait échoue, l'opérateur doit savoir quelle ligne nettoyer à la main.
    echo "  invitation : retrait impossible, ligne $invitation_id laissée en attente" >&2
  fi
}
trap cleanup EXIT

# ON_ERROR_STOP : sans lui, psql signale l'erreur et sort quand même en 0.
invitation_id="$(
  psql "$PSQL_TARGET" \
    --quiet --tuples-only --no-align \
    --set=ON_ERROR_STOP=1 \
    --set=email="$EMAIL" \
    --file "$SQL_FILE"
)"

# Les deux `not exists` du SQL couvrent deux situations distinctes : une
# invitation déjà en attente, ou un compte déjà rattaché à un profil. Ni l'une
# ni l'autre n'appelle une insertion, et le message ne prétend pas trancher.
if [ -n "$invitation_id" ]; then
  echo "  invitation : posée"
else
  echo "  invitation : rien à poser (déjà en attente, ou compte déjà rattaché)"
fi

# Relevé avant l'appel : GoTrue répond 200 aussi bien pour un compte qu'il
# vient de créer que pour un compte invité dont l'invitation n'a pas encore
# été acceptée, auquel cas il renvoie simplement l'e-mail (mesuré, voir le
# case ci-dessous). Sans cette lecture, le script ne saurait pas dire lequel
# des deux il vient de faire.
#
# La requête passe par --file - (l'entrée standard) et non par --command :
# psql n'applique pas la substitution de variables --set à une requête passée
# par --command (mesuré : « syntax error at or near ":" »), alors qu'elle
# s'applique à un script, stdin compris. C'est ce qui permet d'écrire
# :'email' ici aussi, et de n'interpoler l'adresse nulle part à la main.
account_existed="$(
  psql "$PSQL_TARGET" \
    --quiet --tuples-only --no-align \
    --set=ON_ERROR_STOP=1 \
    --set=email="$EMAIL" \
    --file - <<'SQL'
select exists (
  select 1 from auth.users
   where lower(trim(email)) = lower(trim(:'email'))
);
SQL
)"

# --- 2. Le compte ------------------------------------------------------------
# La clé service_role ne doit jamais être affichée : ni ici, ni dans une trace
# d'erreur de curl. --silent --show-error limite curl à son message.
http_body_file="$(mktemp)"

# Le contrôle de forme plus haut accepte le guillemet et l'antislash : le
# corps JSON doit donc être construit, pas interpolé. L'adresse ne peut en
# revanche contenir ni espace ni saut de ligne, ce qui suffit pour le reste.
email_json="$(printf '%s' "$EMAIL" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"

# Les deux en-têtes qui portent la clé passent par --config - plutôt que par
# --header : un argument de ligne de commande est lisible dans `ps` par
# n'importe quel utilisateur local pendant toute la durée de l'appel, alors
# que l'entrée standard ne l'est pas. Le reste des options reste en argv,
# n'ayant rien de secret. Un jeton service_role est un JWT (base64url et
# points) : il ne contient ni guillemet ni antislash, donc rien à échapper
# pour le format de configuration de curl.
http_status="$(
  curl --silent --show-error \
    --output "$http_body_file" \
    --write-out '%{http_code}' \
    --request POST "$SUPABASE_URL/auth/v1/invite?redirect_to=$REDIRECT_TO" \
    --header 'Content-Type: application/json' \
    --data "{\"email\":\"$email_json\"}" \
    --config - <<CURLCFG
header = "apikey: $SUPABASE_SERVICE_ROLE_KEY"
header = "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
CURLCFG
)"
http_body="$(cat "$http_body_file")"

# Les trois réponses ci-dessous ont été mesurées sur la pile locale, et non
# supposées. GoTrue ne distingue pas les deux premières par son code HTTP.
case "$http_status" in
  200|201)
    if [ "$account_existed" = "t" ]; then
      # Compte déjà créé par un amorçage précédent, invitation pas encore
      # acceptée. Mesuré : HTTP 200, corps = l'utilisateur existant, même id
      # qu'au premier appel, avec un invited_at rafraîchi. GoTrue renvoie
      # l'e-mail au lieu de refuser ; c'est exactement ce qu'on veut d'un
      # amorçage rejoué parce que le premier lien a été perdu.
      echo "  compte     : déjà créé, invitation pas encore acceptée — e-mail renvoyé"
      mail_sent=oui
    else
      echo "  compte     : créé, e-mail d'invitation envoyé"
      mail_sent=oui
    fi
    ;;
  422)
    # Compte déjà créé ET déjà accepté (mot de passe défini). Mesuré :
    #   HTTP 422
    #   {"code":422,"error_code":"email_exists",
    #    "msg":"A user with this email address has already been registered"}
    # C'est le cas « déjà amorcé » : un 422 portant email_exists est un
    # succès. Tout autre 422 (adresse invalide, par exemple) reste une erreur.
    if printf '%s' "$http_body" | grep -q 'email_exists'; then
      echo "  compte     : déjà existant et déjà accepté, rien à faire"
    else
      echo "Échec de l'appel à /auth/v1/invite (HTTP $http_status) : $http_body" >&2
      exit 1
    fi
    ;;
  *)
    echo "Échec de l'appel à /auth/v1/invite (HTTP $http_status) : $http_body" >&2
    exit 1
    ;;
esac

# --- 3. Le résultat, lu en base ----------------------------------------------
# L'opérateur doit voir le rôle réellement posé, pas la promesse qu'il l'a été.
role="$(
  psql "$PSQL_TARGET" \
    --quiet --tuples-only --no-align \
    --set=ON_ERROR_STOP=1 \
    --set=email="$EMAIL" \
    --file - <<'SQL'
select p.role
  from public.profiles p
  join auth.users u on u.id = p.id
 where lower(trim(u.email)) = lower(trim(:'email'));
SQL
)"

if [ "$role" = "admin" ]; then
  echo "  profil     : rôle 'admin' confirmé en base"
  if [ "$mail_sent" = "oui" ]; then
    echo "Amorçage terminé. L'administrateur définit son mot de passe depuis le lien reçu."
  else
    echo "Amorçage terminé. Rien n'a changé : cet environnement était déjà amorcé."
  fi
  exit 0
fi

if [ -z "$role" ]; then
  echo "Aucun profil n'est rattaché à $EMAIL." >&2
  if [ "$mail_sent" = "non" ]; then
    # GoTrue a répondu 422 email_exists : un compte existe déjà pour cette
    # adresse et il est déjà accepté, mais il n'a pas de profil. Comme
    # l'invitation a été refusée, invited_at n'a pas bougé, donc le trigger
    # ne s'est pas déclenché — ce n'est pas lui qu'il faut incriminer.
    #
    # L'invitation que l'étape 1 aurait posée est retirée par cleanup() : le
    # message peut donc renvoyer vers invite-user sans réserve, la voie est
    # libre. Une version antérieure signalait ici une ligne restée en attente,
    # qui était précisément celle qui aurait bloqué ce conseil en 409.
    echo "Un compte existe déjà pour cette adresse et il a déjà été accepté, mais il" >&2
    echo "ne porte aucun profil. GoTrue a donc refusé l'invitation (422 email_exists)" >&2
    echo "sans toucher à invited_at, et le trigger public.handle_new_user() n'avait" >&2
    echo "aucune raison de se déclencher." >&2
    echo "" >&2
    echo "C'est exactement le cas que l'Edge Function invite-user sait traiter, en" >&2
    echo "rattachant le profil directement : invitez cette adresse depuis l'écran" >&2
    echo "d'administration, ou supprimez le compte pour réamorcer depuis zéro." >&2
  else
    echo "L'invitation a bien été envoyée, mais le trigger public.handle_new_user()" >&2
    echo "ne l'a pas consommée." >&2
  fi
else
  echo "Le profil de $EMAIL porte le rôle '$role' et non 'admin'." >&2
fi
exit 1
