import type { Metadata } from "next";
import { Suspense } from "react";
import { MenuNotice, MenuShell } from "@/components/public-menu/menu-shell";
import { getPublicMenu } from "@/lib/menu";
import { paymentsConfigured, simulatorEnabled } from "@/lib/payments/service";
import type { PublicIntent } from "@/lib/payments/types";
import { createPublicClient } from "@/lib/supabase/public";
import { connection } from "next/server";
import { PaymentClient } from "./payment-client";

export const metadata: Metadata = { title: "Pagamento", robots: { index: false } };

export default function PayPage({ params }: PageProps<"/pagar/[token]">) {
  return (
    <Suspense fallback={<MenuNotice title="Carregando pagamento…">Só um instante.</MenuNotice>}>
      <PayLoader params={params} />
    </Suspense>
  );
}

async function PayLoader({ params }: { params: PageProps<"/pagar/[token]">["params"] }) {
  await connection();
  const { token } = await params;
  if (!/^[0-9a-f]{32}$/.test(token)) return <MenuNotice title="Link de pagamento inválido">Confira o link recebido.</MenuNotice>;

  const { data } = await createPublicClient().rpc("get_payment_intent", { p_token: token });
  const intent = data as PublicIntent | null;
  if (!intent) return <MenuNotice title="Pagamento não encontrado">Confira o link recebido.</MenuNotice>;

  const menu = await getPublicMenu(intent.organization.slug);
  if (!menu) return <MenuNotice title="Estabelecimento indisponível">Tente novamente mais tarde.</MenuNotice>;

  return (
    <MenuShell menu={menu}>
      <PaymentClient
        token={token}
        initial={intent}
        logoPath={menu.branding.logo_path}
        configured={paymentsConfigured()}
        simulator={simulatorEnabled()}
        publicKey={process.env.NEXT_PUBLIC_PAGARME_PUBLIC_KEY ?? ""}
      />
    </MenuShell>
  );
}
