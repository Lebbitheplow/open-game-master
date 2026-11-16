import { cn } from "@/lib/cn";

// "from Isometric Tabletop by Laurent Sparks": who made what an addon adds,
// wherever it is offered (the workshop importer, the map generator, the
// board's View switch), with the creator's name linking to their GitHub
// repository so the people who use their work can find it. A host older
// than the credit fields sends no author, and this shows the addon's name
// alone.

export function addonByText(owner: { addonName: string; addonAuthor?: string }): string {
  return owner.addonAuthor ? `${owner.addonName} by ${owner.addonAuthor}` : owner.addonName;
}

export function AddonByline({
  owner,
  prefix = "· ",
  className,
  linkClassName,
}: {
  owner: { addonName: string; addonAuthor?: string; addonUrl?: string };
  prefix?: string;
  className?: string;
  linkClassName?: string;
}) {
  return (
    <span className={cn("text-xs text-stone-500", className)}>
      {prefix}
      {owner.addonName}
      {owner.addonAuthor ? (
        <>
          {" by "}
          {owner.addonUrl ? (
            <a
              href={owner.addonUrl}
              target="_blank"
              rel="noreferrer"
              title={`Where ${owner.addonAuthor} keeps ${owner.addonName}`}
              className={cn("rounded-sm text-amber-200/80 underline-offset-2 hover:text-amber-200 hover:underline focus-visible:outline-2 focus-visible:outline-amber-300", linkClassName)}
            >
              {owner.addonAuthor}
            </a>
          ) : (
            owner.addonAuthor
          )}
        </>
      ) : null}
    </span>
  );
}
