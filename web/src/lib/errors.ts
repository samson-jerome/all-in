const MESSAGES: Record<string, string> = {
  "42501": "Vous n'avez pas les droits nécessaires pour cette opération.",
  "23505": "Cette valeur existe déjà.",
  "23514": "Les données saisies ne respectent pas les règles de cohérence.",
  "23503": "L'élément référencé n'existe pas.",
  invalid_email: "L'adresse e-mail est invalide.",
  invalid_role: "Le rôle demandé est inconnu.",
  invalid_org_id: "L'organisation indiquée est invalide.",
  org_required_for_client: "Un client doit être rattaché à une organisation.",
  org_forbidden_for_internal: "Un agent ou un administrateur ne se rattache pas à une organisation.",
  user_already_attached: "Cette personne a déjà un compte rattaché.",
  invitation_already_pending: "Une invitation est déjà en attente pour cette adresse.",
  cannot_modify_self: "Vous ne pouvez pas modifier votre propre rôle ni vous désactiver.",
  invitation_not_found: "Cette invitation est introuvable.",
  profile_not_found: "Ce profil est introuvable.",
  invalid_user_id: "L'identifiant utilisateur est invalide.",
  invalid_invitation_id: "L'identifiant de l'invitation est invalide.",
  forbidden: "Accès refusé.",
  unauthorized: "Votre session a expiré, reconnectez-vous.",
  // Configuration fault, not user error: deliberately not folded into the
  // generic message, which would leave an administrator retrying an
  // invitation that cannot work until SITE_URL is set on the environment.
  site_url_not_configured:
    "L'URL du site est absente ou mal formée sur cet environnement : l'invitation n'a pas été envoyée.",
  invalid_is_active: "L'état d'activation demandé est invalide.",

  // The most likely failure in production, and the one that most deserves an
  // actionable message: this is what a misconfigured SMTP server or a reached
  // rate limit produces. The invitation is correctly rolled back by the
  // function, so retrying is safe and is genuinely the right move after a
  // rate limit -- which the generic message would never have suggested. Same
  // treatment as site_url_not_configured above, for the same reason.
  invite_email_failed:
    "Le courriel d'invitation n'a pas pu être envoyé : l'invitation a été annulée, rien n'a été créé. "
    + "C'est en général le serveur d'envoi qui est en cause, ou sa limite de débit — réessayez dans "
    + "quelques minutes, puis vérifiez la configuration SMTP de l'environnement si cela persiste.",

  // Server-side failures. They say which step failed, because an
  // administrator who reports "it failed on creating the profile" gets helped
  // faster than one who reports "an error occurred" -- and none of them names
  // a table, a column or a reason a caller could learn anything from.
  invitation_failed: "L'invitation n'a pas pu être enregistrée.",
  invitation_record_failed:
    "Le compte a bien été rattaché, mais l'invitation n'a pas pu être enregistrée.",
  profile_creation_failed: "Le profil n'a pas pu être créé.",
  lookup_failed: "La recherche du compte a échoué.",
  read_failed: "La lecture des données a échoué.",
  update_failed: "L'enregistrement des modifications a échoué.",
  session_revoke_failed:
    "Le compte a été désactivé, mais ses sessions actives n'ont pas pu être fermées.",
  portfolio_cleanup_failed: "Le portefeuille d'organisations n'a pas pu être vidé.",
  revoke_failed:
    "L'accès a été retiré, mais l'invitation n'a pas pu être marquée comme révoquée.",

  // Refused by GoTrue on the password screen, which is the product's only
  // entry point: both used to read "Une erreur est survenue." there, leaving
  // the person with no idea what to type next.
  weak_password:
    "Ce mot de passe est trop faible : utilisez au moins 8 caractères.",
  same_password: "Le nouveau mot de passe doit être différent de l'ancien.",
};

/**
 * A denied read returns no rows rather than an error, so "invisible" and
 * "missing" look the same on purpose — saying which would leak the existence
 * of data the caller may not see.
 */
export function describeError(error: { code?: string; message: string } | null): string {
  if (!error) return "";
  return MESSAGES[error.code ?? ""] ?? MESSAGES[error.message] ?? "Une erreur est survenue.";
}
