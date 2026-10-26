interface Props {
  page: number;
  totalPages: number;
  total: number;
  onPage: (page: number) => void;
}

export function Pager({ page, totalPages, total, onPage }: Props) {
  return (
    <nav className="pager" aria-label="Pagination">
      <button type="button" className="btn btn--ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </button>
      <span>
        Page {page} of {totalPages} · {total} {total === 1 ? 'record' : 'records'}
      </span>
      <button type="button" className="btn btn--ghost" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
        Next
      </button>
    </nav>
  );
}
