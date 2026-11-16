"use client";

import { AlertTriangle, Info } from "lucide-react";
import { useT, useTp } from "@/lib/locale";
import { useContentCampaign } from "@/lib/content-scope";
import { ui } from "@/lib/ui";

// Why an option list is short, said where the option is missing (workshop
// import audit F06): the asker's own Homebrew this table does not offer, or
// a list the server did not send, which stands on the books' own meanwhile.
// The rule behind the first is src/lib/content/scope.ts: at a table, the
// shelves of whoever runs it count, and a player's entry counts once one of
// them keeps a copy.
export function TableScopeNote({
  noun,
  unadmitted,
  failed = false,
  onRetry,
}: {
  // What the list holds, in the plural ("subclasses", "species").
  noun: string;
  unadmitted: string[];
  failed?: boolean;
  onRetry?: () => void;
}) {
  const atTable = Boolean(useContentCampaign());
  const t = useT();
  const tp = useTp();
  if (!failed && !unadmitted.length) {
    return null;
  }
  return (
    <div className="mt-1 space-y-1 text-xs">
      {failed ? (
        <p role="alert" className="flex flex-wrap items-center gap-1.5 text-amber-300/90">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
          <span>
            {t("Could not load {scope} {noun} from the server, so only the books' own are listed.", {
              scope: atTable ? t("this table's") : t("your", { context: "builder.scope.yours" }),
              noun,
            })}
          </span>
          {onRetry ? (
            <button type="button" onClick={onRetry} className={`${ui.btnSmall} min-h-10`}>
              {t("Try again", { context: "builder.finish.tryAgain" })}
            </button>
          ) : null}
        </p>
      ) : null}
      {unadmitted.length ? (
        <p className="flex items-start gap-1.5 text-stone-400" data-testid="table-scope-unadmitted">
          <Info className="mt-0.5 size-3.5 shrink-0 text-sky-300/70" aria-hidden="true" />
          <span>
            {tp("Your own {list} is not offered at this table. Homebrew counts at a table when whoever runs it (the owner, the GM or the assistant GM) keeps it: send them a Workshop bundle with your Homebrew ticked, and it is offered here once they bring it in. In your own library it is offered as it is.", "Your own {list} are not offered at this table. Homebrew counts at a table when whoever runs it (the owner, the GM or the assistant GM) keeps it: send them a Workshop bundle with your Homebrew ticked, and it is offered here once they bring it in. In your own library it is offered as it is.", { count: unadmitted.length, list: unadmitted.join(", ") })}
          </span>
        </p>
      ) : null}
    </div>
  );
}
