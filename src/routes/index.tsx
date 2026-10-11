import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Gerador de Relatórios NGA" },
      {
        name: "description",
        content:
          "Gerador de Relatórios NGA — aplicação em preparação para migração do código-fonte original.",
      },
      { property: "og:title", content: "Gerador de Relatórios NGA" },
      {
        property: "og:description",
        content:
          "Gerador de Relatórios NGA — aplicação em preparação para migração do código-fonte original.",
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
          Estrutura inicial preparada. A migração do código-fonte original será
          realizada em etapa posterior.
        </p>
      </div>
    </div>
  );
}
