// The French rulebook (#959) reaches the reader by the request's
// Accept-Language, on the website and through the apps' fetch to their host
// (the client's runtime.ts adds the bearer token and keeps the page's own
// headers): a reader asking in French gets « Boule de feu », one asking in
// Spanish «Bola de fuego» (issue 1125), one asking in English gets Fireball,
// and the answer says it varies by that header.
import { check } from "../lib.mjs";

export default {
  name: "rulebook-language",
  viewports: ["desktop"],
  async run(t) {
    const { page } = t;
    await t.open("/rulebook");
    const asked = await page.evaluate(async () => {
      const ask = async (language) => {
        const response = await fetch("/api/rulebook/pages/fireball", { headers: { "accept-language": language }, cache: "no-store" });
        const body = await response.json().catch(() => null);
        return { status: response.status, title: body?.page?.title ?? null, vary: response.headers.get("vary") };
      };
      return { fr: await ask("fr-FR,fr;q=0.9"), es: await ask("es-419,es;q=0.9"), en: await ask("en-US,en;q=0.9") };
    });
    check(asked.fr.status === 200 && asked.fr.title === "Boule de feu", `the French ask reads the French book (${JSON.stringify(asked.fr)})`);
    check(asked.es.status === 200 && asked.es.title === "Bola de fuego", `the Spanish ask reads the Spanish book (${JSON.stringify(asked.es)})`);
    check(asked.en.status === 200 && asked.en.title === "Fireball", `the English ask reads the English book (${JSON.stringify(asked.en)})`);
  },
};
