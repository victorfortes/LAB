import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  // O gerador (casca de login + motor original) é servido como site estático em /gerador/ (public/gerador, gerado por
  // scripts/build.mjs). A raiz do projeto apenas encaminha para lá.
  beforeLoad: () => {
    throw redirect({ href: "/gerador/index.html" });
  },
  head: () => ({
    meta: [
      { title: "Gerador de Relatórios NGA" },
      {
        name: "description",
        content:
          "Gerador de Relatórios Jurídicos NGA, acesso restrito ao escritório.",
      },
      { property: "og:title", content: "Gerador de Relatórios NGA" },
      {
        property: "og:description",
        content:
          "Gerador de Relatórios Jurídicos NGA, acesso restrito ao escritório.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Gerador de Relatórios NGA
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Abrindo o sistema…{" "}
          <a className="underline" href="/gerador/index.html">
            Se não abrir, clique aqui.
          </a>
        </p>
      </div>
    </div>
  );
}
