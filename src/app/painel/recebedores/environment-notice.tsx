/** Em qual ambiente do Pagar.me o servidor está (teste, produção ou simulador). */
export function EnvironmentNotice({ environment, configured }: { environment: "test" | "live" | "simulator" | null; configured: boolean }) {
  if (!environment)
    return (
      <p className="mb-4 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
        O servidor não tem a chave do Pagar.me (PAGARME_SECRET_KEY). Não dá para consultar nem cadastrar recebedores.
      </p>
    );
  return (
    <div className="mb-4 flex flex-col gap-2">
      {environment === "live" && (
        <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          <strong>Produção:</strong> recebedores e pagamentos são reais.
        </p>
      )}
      {environment === "test" && <p className="rounded-lg bg-info-soft px-3 py-2 text-sm text-info">Ambiente de teste do Pagar.me (sk_test_): nada é real.</p>}
      {environment === "simulator" && (
        <p className="rounded-lg bg-info-soft px-3 py-2 text-sm text-info">
          Modo simulador: o recebedor nasce pedindo documentos e gerar o link de KYC simula a aprovação.
        </p>
      )}
      {!configured && (
        <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
          Falta a SUPABASE_SECRET_KEY no servidor: os pagamentos não são confirmados até ela ser configurada.
        </p>
      )}
    </div>
  );
}
