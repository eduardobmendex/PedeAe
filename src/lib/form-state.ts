/** Estado devolvido pelas Server Actions usadas com useActionState. */
export type FormState = { error?: string; success?: string; data?: Record<string, string> } | undefined;
