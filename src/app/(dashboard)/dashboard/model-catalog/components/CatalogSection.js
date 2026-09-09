"use client";

import { useMemo, useState } from "react";
import PropTypes from "prop-types";
import { Card } from "@/shared/components";
import Pagination from "@/shared/components/Pagination";
import CatalogTable, { matchesCatalogRow } from "./CatalogTable";

const PAGE_SIZE_OPTIONS = [5, 10, 20];

export default function CatalogSection({ title, description, icon, actions, rows, emptyText, onEdit, onDelete }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const filteredRows = useMemo(() => rows.filter((row) => matchesCatalogRow(row, search, "all")), [rows, search]);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <section>
      <Card padding="sm" className="min-w-0">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="material-symbols-outlined mt-0.5 text-[20px] text-primary">{icon}</span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold text-text-main">{title}</h2>
                <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-text-muted">{filteredRows.length}</span>
              </div>
              <p className="mt-0.5 text-xs text-text-muted">{description}</p>
            </div>
          </div>
          {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
        </div>
        <div className="mb-3">
          <label className="relative block">
            <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-text-muted">search</span>
            <input
              type="search"
              value={search}
              onChange={(event) => { setSearch(event.target.value); setPage(1); }}
              placeholder={`Search ${title.toLowerCase()}...`}
              aria-label={`Search ${title}`}
              className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:border-primary sm:max-w-sm"
            />
          </label>
        </div>
        <CatalogTable rows={pageRows} emptyText={search ? `No ${title.toLowerCase()} entries match the search.` : emptyText} onEdit={onEdit} onDelete={onDelete} />
        <Pagination currentPage={currentPage} pageSize={pageSize} totalItems={filteredRows.length} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} pageSizeOptions={PAGE_SIZE_OPTIONS} className="pb-0" />
      </Card>
    </section>
  );
}

CatalogSection.propTypes = {
  title: PropTypes.string.isRequired,
  description: PropTypes.string.isRequired,
  icon: PropTypes.string.isRequired,
  actions: PropTypes.node,
  rows: PropTypes.arrayOf(PropTypes.object).isRequired,
  emptyText: PropTypes.string.isRequired,
  onEdit: PropTypes.func,
  onDelete: PropTypes.func,
};
