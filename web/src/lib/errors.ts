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
  arrival_route_mismatch:
    "Un compte agent ou administrateur ne peut être créé que pour une personne connectée via le fournisseur d'authentification de l'entreprise, et non via un compte e-mail et mot de passe.",
  cannot_modify_self: "Vous ne pouvez pas modifier votre propre rôle ni vous désactiver.",
  no_pending_invitation: "Aucune invitation en attente pour cette personne.",
  profile_not_found: "Ce profil est introuvable.",
  invalid_user_id: "L'identifiant utilisateur est invalide.",
  invalid_invitation_id: "L'identifiant de l'invitation est invalide.",
  forbidden: "Accès refusé.",
  unauthorized: "Votre session a expiré, reconnectez-vous.",
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
