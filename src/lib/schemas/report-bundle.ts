import { z } from "zod";

// What ReportProblemDialog.tsx asks for, at a table and in Admin alike: one
// yes or no per part. A part the seat may not include is dropped by
// chosenParts (src/lib/report-bundle.ts), never by what the request says.
export const reportBundleBodySchema = z.object({
  parts: z.record(z.string(), z.boolean()).optional(),
});
