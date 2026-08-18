import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getKid, getReport } from "@/lib/db";
import { getSessionUser, isAdmin } from "@/lib/auth";
import { Markdown } from "@/lib/markdown";
import PrintButton from "@/components/PrintButton";
import ReportChat from "@/components/ReportChat";

export const metadata = { title: "Report" };

const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME || "Checkmate Coach";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "chess.njxai.com";

function formatDate(sqliteDate: string): string {
  const parsed = new Date(sqliteDate.replace(" ", "T") + "Z");
  if (Number.isNaN(parsed.getTime())) return sqliteDate;
  return parsed.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function ReportPage({ params }: { params: { id: string } }) {
  const user = getSessionUser();
  if (!user) redirect("/login");

  const report = getReport(Number(params.id));
  if (!report) notFound();
  const kid = getKid(report.kid_id);
  if (!isAdmin(user) && kid && kid.user_id != null && kid.user_id !== user.id) {
    notFound();
  }
  const kidName = kid?.name ?? "Player";

  let markdown = report.summary_text;
  try {
    const payload = JSON.parse(report.json_payload) as { report_markdown?: string };
    if (payload.report_markdown) markdown = payload.report_markdown;
  } catch {
    // fall back to summary_text
  }

  const dateLine = formatDate(report.created_at);
  const filename = `${kidName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-report`;

  return (
    <div className="report-shell">
      <div className="report-toolbar print:hidden">
        <Link
          href={`/progress?kid=${report.kid_id}`}
          className="text-sm text-slate-500 underline hover:text-slate-700"
        >
          ← Back to your account
        </Link>
        <PrintButton filename={filename} />
      </div>

      <div className="report-doc">
        <div className="report-brand-header">
          <span className="report-brand-wordmark">
            <span className="report-brand-glyph">♞</span> {SITE_NAME}
          </span>
          <span className="report-brand-url">{SITE_URL}</span>
        </div>
        <hr className="report-brand-divider" />

        <article className="report-body">
          <p className="report-date">{dateLine}</p>
          <Markdown source={markdown} />
        </article>

        <hr className="report-brand-divider report-brand-divider--footer" />
        <div className="report-brand-footer">
          <span>
            ♞ {SITE_NAME} · {SITE_URL}
          </span>
          <span className="report-brand-tagline">Engine-checked chess analysis.</span>
        </div>
      </div>

      <div className="mt-6 print:hidden">
        <ReportChat reportId={report.id} kidName={kidName} />
      </div>
    </div>
  );
}
