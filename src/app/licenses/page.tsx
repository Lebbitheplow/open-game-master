import Link from "next/link";
import { PIXEL_ICONS } from "@/lib/ui";
import { PageSection, PageShell } from "@/components/PageShell";
import { listDocuments } from "@/lib/content";
import { contentPackInstalled, contentPackStale } from "@/lib/content/db";
import { listWorldPackSummaries } from "@/lib/worlds";
import { installedTracks } from "@/lib/ambience/library";
import { cueById } from "@/lib/ambience/catalog";
import { addonCredits } from "@/lib/addons/offered";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Licenses | Open Game Master",
};

// Attribution for the imported Open5e dataset (a mix of CC-BY and OGL
// documents) plus the bundled SRD data. Required by the content licenses.
export default function LicensesPage() {
  const documents = listDocuments();
  const installed = contentPackInstalled();
  const stale = contentPackStale();
  const worldPacks = listWorldPackSummaries();
  const ambience = installedTracks();
  const addons = addonCredits();

  return (
    <PageShell
      icon={PIXEL_ICONS.support}
      glyph="ui-licenses"
      title="Licenses and attribution"
      blurb="Where the bundled rules, imported content and sounds come from."
      actions={
        <Link href="/" className="text-sm text-amber-200 hover:text-amber-100">
          Back to Open Game Master
        </Link>
      }
    >
      <PageSection bodyClassName="space-y-3 text-sm leading-6 text-stone-300">
        <p>
          Open Game Master bundles game content from the System Reference Document 5.1
          (SRD 5.1) by Wizards of the Coast LLC, available under the Creative Commons
          Attribution 4.0 International License (CC-BY-4.0).
        </p>
        <p>
          The <Link href="/rulebook" className="text-amber-200 hover:text-amber-100">rulebook</Link> is the
          full text of the SRD 5.1, set from Old Man Umby&rsquo;s reForged markdown conversion of it
          (github.com/oldmanumby/dnd.srd.5.1). This work includes material taken from the System
          Reference Document 5.1 (&ldquo;SRD 5.1&rdquo;) by Wizards of the Coast LLC and available at
          https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under
          the Creative Commons Attribution 4.0 International License available at
          https://creativecommons.org/licenses/by/4.0/legalcode.
        </p>
        <p>
          A reader whose browser asks for French reads the rulebook in Wizards of the Coast&rsquo;s official
          French translation, the <span lang="fr">Document de Référence du Système 5.1</span>, under the same
          license.{" "}
          <span lang="fr">
            Ce travail comprend la documentation tirée du Document de Référence du Système 5.1 (« SRD 5.1 »)
            par Wizards of the Coast LLC et disponible à l&rsquo;adresse
            https://dnd.wizards.com/fr/resources/systems-reference-document. Le SRD 5.1 est distribué en vertu
            de la licence Creative Commons Attribution 4.0 International disponible à l&rsquo;adresse
            https://creativecommons.org/licenses/by/4.0/legalcode.fr.
          </span>
        </p>
        <p>
          Expanded character options, spells, items, and monsters are imported from the{" "}
          <span className="text-stone-100">Open5e</span> dataset (open5e.com), which
          aggregates open-licensed tabletop content. Each source document and its license
          is listed below.
        </p>
        {!installed ? (
          <p className="reveal rounded border border-stone-700 bg-stone-900 p-3 text-stone-400">
            The Open5e content pack is not installed on this server. Run
            <span className="font-code"> node scripts/import-open5e.mjs</span> to download
            it; until then the app uses only the bundled SRD 5.1 data.
          </p>
        ) : null}
        {stale ? (
          <p className="reveal rounded border border-stone-700 bg-stone-900 p-3 text-stone-400">
            This server&rsquo;s content pack was built by an older release. Run
            <span className="font-code"> npm run setup</span> to replace it with the one this release plays.
          </p>
        ) : null}
      </PageSection>

      {documents.length ? (
        <PageSection heading="Imported source documents">
          <ul className="mt-4 space-y-3">
            {documents.map((document) => (
              <li
                key={document.slug}
                className="rounded-lg border border-stone-800 bg-stone-900/60 p-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-stone-100">{document.title}</span>
                  <span className="text-xs text-amber-200">{document.license}</span>
                </div>
                {document.author ? (
                  <p className="reveal mt-1 text-xs text-stone-400">by {document.author}</p>
                ) : null}
                {document.url ? (
                  <a
                    href={document.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-block break-all text-xs text-stone-500 hover:text-stone-300"
                  >
                    {document.url}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </PageSection>
      ) : null}

      {worldPacks.length ? (
        <PageSection heading="Campaign plugins">
          <p className="text-sm leading-6 text-stone-400">
            World packs rename existing SRD races, classes, spells, items and monsters to fit a
            setting. No rule and no stat block is changed.
          </p>
          <p className="text-sm leading-6 text-stone-400">
            Community campaign packs were installed on this server by its operator. They are{" "}
            <span className="text-stone-200">not distributed with Open Game Master</span>, are
            not covered by its MIT license, and are the work of their own authors. Where a pack
            references an existing setting it is an unofficial fan work with no affiliation with
            or endorsement from that setting&apos;s rights holders. Each pack names its own
            attribution wherever it appears in the app.
          </p>
        </PageSection>
      ) : null}

      {ambience.length ? (
        <PageSection heading="Sound library">
          <p className="text-sm leading-6 text-stone-400">
            Each ambience and music file on this server is credited below as it arrived: made
            here with a music model, carried in the release&apos;s sound pack, supplied by the
            operator, or fetched from a public archive. Archive files are{" "}
            <span className="text-stone-200">not distributed with Open Game Master</span> and
            are credited as their archive recorded them.
          </p>
          <ul className="mt-4 space-y-2">
            {ambience.map((track) => (
              <li
                key={track.file}
                className="rounded-lg border border-stone-800 bg-stone-900/60 p-3 text-sm"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-stone-100">
                    {cueById(track.cueId)?.label ?? track.cueId}
                    <span className="ml-2 text-xs text-stone-500">{track.title}</span>
                  </span>
                  <span className="text-xs text-amber-200">{track.license}</span>
                </div>
                <p className="mt-1 text-xs text-stone-400">by {track.author}</p>
                {track.source ? (
                  <a
                    href={track.source}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-block break-all text-xs text-stone-500 hover:text-stone-300"
                  >
                    {track.source}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </PageSection>
      ) : null}

      {addons.length ? (
        <PageSection heading="Addons">
          <p className="text-sm leading-6 text-stone-400">
            Addons switched on here add to what this server does. Each is its creator&apos;s own project, kept in
            their own repository: <span className="text-stone-200">not distributed with Open Game Master</span> and
            not covered by its MIT license.
          </p>
          <ul className="mt-4 space-y-2">
            {addons.map((addon) => (
              <li key={addon.id} className="rounded-lg border border-stone-800 bg-stone-900/60 p-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-stone-100">
                    {addon.name}
                    <span className="ml-2 text-xs text-stone-500">v{addon.version}</span>
                  </span>
                  <span className="text-xs text-amber-200">{addon.license}</span>
                </div>
                <p className="mt-1 text-xs text-stone-400">
                  by{" "}
                  {addon.profile ? (
                    <a href={addon.profile} target="_blank" rel="noreferrer" className="text-stone-300 hover:text-amber-200">
                      {addon.author}
                    </a>
                  ) : (
                    addon.author
                  )}
                </p>
                {addon.description ? <p className="mt-1 text-xs text-stone-500">{addon.description}</p> : null}
                {[addon.url, ...addon.also.map((repo) => `https://github.com/${repo}`)].filter(Boolean).map((url) => (
                  <a
                    key={url}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 mr-3 inline-block break-all text-xs text-stone-500 hover:text-stone-300"
                  >
                    {url}
                  </a>
                ))}
              </li>
            ))}
          </ul>
        </PageSection>
      ) : null}

      <p className="px-1 text-xs text-stone-500">
        Open Game Master itself is MIT licensed. Homebrew content belongs to the user who
        created it, and installed campaign plugins belong to their authors.
      </p>
    </PageShell>
  );
}
