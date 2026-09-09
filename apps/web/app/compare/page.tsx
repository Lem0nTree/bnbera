import { redirect } from "next/navigation";

/** Retired product route: old bookmarks return to discovery without a shortlist. */
export default function RetiredComparePage() {
  redirect("/marketplace");
}
