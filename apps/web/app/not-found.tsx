import Link from "next/link";
import { EmptyState } from "@bnbera/ui";

export default function NotFound() {
  return (
    <div className="page-shell page-shell--tight">
      <EmptyState
        title="That marketplace route is not in the read model"
        action={<Link className="button button--primary button--small" href="/marketplace">Browse marketplace</Link>}
      >
        Nothing at this URL was found. Browse the available categories or return to the public marketplace.
      </EmptyState>
    </div>
  );
}
