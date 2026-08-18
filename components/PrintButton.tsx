"use client";

export default function PrintButton({ filename }: { filename?: string }) {
  function handlePrint() {
    if (filename && typeof document !== "undefined") {
      const prev = document.title;
      document.title = filename;
      window.print();
      document.title = prev;
    } else {
      window.print();
    }
  }

  return (
    <button
      type="button"
      onClick={handlePrint}
      className="rounded-md border border-slate-300 bg-white px-4 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 print:hidden"
    >
      Download PDF
    </button>
  );
}
